import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'

import {
  planWorkspace,
  readWorkspace,
  type AssetBytes,
  type DeckSnapshot,
  type WorkspaceReadback,
} from './agent-workspace.js'

/**
 * Bytes for one asset, by the URL the browser knows it by.
 *
 * Injected rather than reached for, because the only place these live is the
 * editor tab - and one at a time, because all of a deck's images together do not
 * fit in a socket frame.
 */
export type FetchAsset = (url: string) => Promise<AssetBytes | undefined>

/** Guessed from the extension the agent chose; it never sends a media type. */
const MEDIA_TYPES: Record<string, string> = {
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  mp4: 'video/mp4',
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp',
}

/**
 * The deck on disk, for the length of one conversation.
 *
 * The directory is a copy, not the user's file - Mona's decks live in the browser
 * store, and this is the form the agent can work in. Everything about not
 * clobbering the user's work therefore rests on the revision check at `apply`
 * time, which is why the revision is held here and never written into the
 * workspace where the agent could edit it.
 *
 * It sits under the OS temp directory for a second reason: `settingSources: []`
 * keeps this machine's settings out of the session, but project settings are
 * discovered by walking *up* from `cwd` - measured, not assumed. A temp directory
 * has no `.claude` ancestor, so there is nothing above it to inherit.
 */
export class AgentWorkspace {
  /** What the agent sees as its `cwd`. */
  readonly root: string
  /** Workspace asset path to the URL the browser knows it by. */
  #assetSources: Map<string, string>
  /** The document revision this copy was taken at. */
  #revision: string

  private constructor({ assetSources, revision, root }: {
    assetSources: Map<string, string>
    revision: string
    root: string
  }) {
    this.#assetSources = assetSources
    this.#revision = revision
    this.root = root
  }

  static async create({ fetchAsset, revision, snapshot }: {
    fetchAsset: FetchAsset
    revision: string
    snapshot: DeckSnapshot
  }): Promise<AgentWorkspace> {
    const root = await mkdtemp(join(tmpdir(), 'mona-deck-'))
    const workspace = new AgentWorkspace({ assetSources: new Map(), revision, root })
    await workspace.take({ fetchAsset, revision, snapshot })
    return workspace
  }

  /**
   * Writes the deck out, replacing whatever was there.
   *
   * Re-takeable in place because the subprocess's `cwd` is fixed once it starts:
   * when the user edits the deck mid-run, the workspace has to become the new deck
   * at the same path. `deck/` is removed first so a slide the user deleted does not
   * survive as a file the agent can still read.
   */
  async take({ fetchAsset, revision, snapshot }: {
    fetchAsset: FetchAsset
    revision: string
    snapshot: DeckSnapshot
  }): Promise<void> {
    await rm(join(this.root, 'deck'), { force: true, recursive: true })
    const { assetSources, assets, files } = planWorkspace(snapshot)
    // Sequential on purpose: a 23-slide deck is ~70 files, and the concurrency
    // would only trade a few milliseconds for a partially written workspace on
    // the first failure.
    for (const file of files) {
      const target = join(this.root, file.path)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, file.data)
    }
    // One round trip each, and written as they arrive so the process never holds
    // the whole deck's images at once.
    for (const asset of assets) {
      const bytes = await fetchAsset(asset.url).catch(() => undefined)
      // A failed asset leaves a reference with no file, which the agent can see
      // and report. Losing one image must not cost the whole workspace.
      if (!bytes) continue
      const target = join(this.root, asset.path)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, Buffer.from(bytes.base64, 'base64'))
    }
    this.#assetSources = assetSources
    this.#revision = revision
  }

  get revision(): string {
    return this.#revision
  }

  /**
   * Reads the deck back out of the workspace.
   *
   * A slide file the agent left unparseable is reported rather than guessed at:
   * committing half-written JSON would put a malformed deck in front of the
   * renderer, which is the one failure this boundary exists to prevent.
   */
  async read(): Promise<{ invalid: string[] } & WorkspaceReadback> {
    const invalid: string[] = []
    const cache = new Map<string, unknown>()

    // `readWorkspace` is synchronous by design - it is pure JSON walking - so the
    // files it will ask for are loaded first. It only ever reads deck.json and
    // the slide files that deck.json names.
    const load = async (path: string): Promise<void> => {
      if (cache.has(path)) return
      try {
        cache.set(path, JSON.parse(await readFile(join(this.root, path), 'utf8')))
      }
      catch (error) {
        cache.set(path, undefined)
        // A missing file is the agent having deleted a slide, which is legitimate.
        if ((error as { code?: string }).code !== 'ENOENT') invalid.push(path)
      }
    }

    await load('deck/deck.json')
    const index = cache.get('deck/deck.json') as {
      powerPointSharedLayers?: string
      slides?: { file?: string }[]
    } | undefined
    for (const entry of index?.slides ?? []) {
      if (entry?.file) await load(`deck/${entry.file}`)
    }
    if (index?.powerPointSharedLayers) {
      const path = 'deck/powerpoint/shared-layers.json'
      if (index.powerPointSharedLayers !== 'powerpoint/shared-layers.json') {
        invalid.push('deck/deck.json')
      }
      await load(path)
      if (cache.get(path) === undefined && !invalid.includes(path)) invalid.push(path)
    }

    return {
      ...readWorkspace({ assetSources: this.#assetSources, readJson: path => cache.get(path) }),
      invalid,
    }
  }

  /**
   * Bytes for an asset the agent created, ready for the browser to ingest.
   *
   * The path comes from deck JSON the agent wrote, so it is resolved and checked
   * to be inside the workspace: a reference of `assets/../../../.ssh/id_rsa`
   * would otherwise read whatever the server process can read.
   */
  async addedAsset(path: string): Promise<AssetBytes | undefined> {
    const deckRoot = resolve(this.root, 'deck')
    const target = resolve(deckRoot, path)
    if (target !== deckRoot && !target.startsWith(deckRoot + sep)) return undefined
    try {
      const bytes = await readFile(target)
      const extension = relative(deckRoot, target).split('.').pop()?.toLowerCase() ?? ''
      return {
        base64: bytes.toString('base64'),
        mediaType: MEDIA_TYPES[extension] ?? 'application/octet-stream',
      }
    }
    catch {
      return undefined
    }
  }

  async dispose(): Promise<void> {
    await rm(this.root, { force: true, recursive: true })
  }
}
