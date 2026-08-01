/**
 * The deck, as files an agent can read, grep and edit.
 *
 * The old tool surface handed the model one JSON blob through `inspect` and took
 * edits back as a sandboxed program. That made the document something the model
 * could only see through a keyhole: a 23-slide deck arrived as a single 193 MB
 * result, and every change had to be expressed in an invented command vocabulary.
 *
 * A workspace inverts it. One file per slide, assets unbundled beside them, and
 * the ordinary tools - Read, Edit, Grep, Glob, Bash - do the work. This is how
 * PPTX itself is laid out, and how Claude already knows how to edit a deck.
 */

/**
 * An asset as the snapshot describes it - what it is, not what it contains.
 *
 * Bytes are fetched one at a time instead of travelling with the snapshot. One
 * real deck's images came to 342 MB of base64 in a single frame against a 100 MiB
 * socket limit, which closed the connection before the agent had started. Even a
 * deck whose assets are stored properly runs to ~193 MB; this is not a legacy
 * problem, it is a per-frame one.
 */
export interface SnapshotAsset {
  byteLength?: number
  mediaType: string
}

/** An asset's bytes, fetched on their own. */
export interface AssetBytes {
  base64: string
  mediaType: string
}

/**
 * Slides stay structurally typed on purpose.
 *
 * The server has no business knowing the element vocabulary - it moves JSON to
 * disk and back. Typing it as `Slide` would couple the agent host to every model
 * change in `presentation-core` for no gain, and the walk below is generic anyway.
 */
export interface SnapshotSlide {
  id: string
  title?: string
  [field: string]: unknown
}

export interface SnapshotPowerPointSharedLayers {
  packages: Array<{
    layouts: Array<Record<string, unknown>>
    masters: Array<Record<string, unknown>>
    packageId: string
  }>
  schemaVersion: 1
}

export interface DeckSnapshot {
  /** Keyed by the URL the model holds, `blob:…` or a `data:` URL. */
  assets: Record<string, SnapshotAsset>
  slideIndex?: number
  slides: SnapshotSlide[]
  /** Explicitly editable master/layout records, kept out of per-slide JSON. */
  powerPointSharedLayers?: SnapshotPowerPointSharedLayers
  theme?: unknown
  title?: string
  viewportRatio?: number
  viewportSize?: number
}

export interface WorkspaceFile {
  /** Text for JSON, bytes for an asset. */
  data: string | Uint8Array
  /** Workspace-relative, always forward-slashed. */
  path: string
}

/** An asset the workspace needs, and where its bytes come from. */
export interface PlannedAsset {
  /** Workspace-relative, as the slides reference it. */
  path: string
  /** The URL the browser knows it by. */
  url: string
}

export interface WorkspacePlan {
  /** Workspace asset path to the URL the browser knows it by. */
  assetSources: Map<string, string>
  /** Fetched and written separately, one frame each. */
  assets: PlannedAsset[]
  /** Deck JSON only - small enough to build in memory. */
  files: WorkspaceFile[]
}

const EXTENSIONS: Record<string, string> = {
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
}

/** `src` says nothing to a reader; `image-1.png` says what it is. */
const ASSET_STEMS: Record<string, string> = {
  pattern: 'pattern',
  poster: 'poster',
  preview: 'preview',
  src: 'image',
}

/**
 * Whether a string value is an asset reference rather than ordinary text.
 *
 * Matched by the shape of the value, never by the name of the field holding it.
 * The same rule already earns its keep in the browser: `collectBlobUrls` finds
 * assets in fields nobody thought to list, which is why a 30 MB `pattern` fill
 * was captured without anyone having named `pattern` anywhere.
 */
const isAssetReference = (value: string): boolean => (
  value.startsWith('blob:')
  || value.startsWith('data:')
  || value.startsWith('mona://asset/')
  || value.startsWith('pptx-asset://')
)

/** Wide enough that lexical order is slide order, in Glob results and in `ls`. */
const slideFileName = (index: number, total: number): string => {
  const width = Math.max(2, String(total).length)
  return `slides/${String(index + 1).padStart(width, '0')}.json`
}

/**
 * Lays the deck out as files, replacing every asset URL with the path of the
 * file holding its bytes.
 *
 * Assets are unbundled rather than stripped. A `managed://` placeholder - the
 * previous approach - blocked the model from seeing an asset at all and turned
 * writing back into a merge. A path is strictly more capability: the model can
 * `Read` the image, move it between slides, or delete it, and the reference is
 * still just a string it can edit.
 */
export const planWorkspace = (snapshot: DeckSnapshot): WorkspacePlan => {
  const assetSources = new Map<string, string>()
  const assets: PlannedAsset[] = []
  const files: WorkspaceFile[] = []
  // Keyed by URL, so an asset used on three slides is written once. Deliberate:
  // one imported deck carried the same 6 MB fill twice.
  const pathByUrl = new Map<string, string>()
  const counters = new Map<string, number>()

  const assetPath = (url: string, field: string): string => {
    const existing = pathByUrl.get(url)
    if (existing) return existing
    const asset = snapshot.assets[url]
    const sanitized = field.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()
    const stem = ASSET_STEMS[field] ?? (sanitized || 'asset')
    const next = (counters.get(stem) ?? 0) + 1
    counters.set(stem, next)
    const extension = EXTENSIONS[asset?.mediaType ?? ''] ?? 'bin'
    const path = `assets/${stem}-${next}.${extension}`
    pathByUrl.set(url, path)
    assetSources.set(path, url)
    // An asset the snapshot did not describe keeps its reference and simply has no
    // file. Better a dangling path the model can see than a silent deletion.
    if (asset) assets.push({ path: `deck/${path}`, url })
    return path
  }

  /**
   * Rewrites asset URLs to paths, in place on a structural copy.
   *
   * `field` is threaded through only to name the file well - the decision to
   * treat a value as an asset is the value's shape alone.
   */
  const rewrite = (node: unknown, field: string): unknown => {
    if (typeof node === 'string') return isAssetReference(node) ? assetPath(node, field) : node
    if (Array.isArray(node)) return node.map(item => rewrite(item, field))
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(node)) out[key] = rewrite(value, key)
      return out
    }
    return node
  }

  const total = snapshot.slides.length
  const index = snapshot.slides.map((slide, position) => {
    const path = slideFileName(position, total)
    files.push({
      data: `${JSON.stringify(rewrite(slide, 'slide'), null, 2)}\n`,
      path: `deck/${path}`,
    })
    return slide.title ? { file: path, id: slide.id, title: slide.title } : { file: path, id: slide.id }
  })

  if (snapshot.powerPointSharedLayers !== undefined) {
    files.push({
      data: `${JSON.stringify(rewrite(snapshot.powerPointSharedLayers, 'shared-layer'), null, 2)}\n`,
      path: 'deck/powerpoint/shared-layers.json',
    })
  }

  files.push({
    // Slide order is this array's order, so reordering the deck is an edit to
    // this file rather than a command only we know how to spell.
    data: `${JSON.stringify({
      slideIndex: snapshot.slideIndex ?? 0,
      slides: index,
      ...(snapshot.powerPointSharedLayers !== undefined
        ? { powerPointSharedLayers: 'powerpoint/shared-layers.json' }
        : {}),
      theme: snapshot.theme ?? {},
      title: snapshot.title ?? '',
      viewport: { ratio: snapshot.viewportRatio ?? 0.5625, size: snapshot.viewportSize ?? 1000 },
    }, null, 2)}\n`,
    path: 'deck/deck.json',
  })

  return { assetSources, assets, files }
}

/** What the agent left behind, read back as a deck. */
export interface WorkspaceReadback {
  /** Asset paths referenced by the deck that we never wrote - the agent added them. */
  addedAssets: string[]
  slideIndex: number
  slides: SnapshotSlide[]
  powerPointSharedLayers?: SnapshotPowerPointSharedLayers
  theme: unknown
  title: string
}

interface DeckIndexEntry {
  file?: string
  id?: string
}

/**
 * Reads the workspace back into a deck.
 *
 * Asset paths become the URLs they came from, so an untouched fill round-trips to
 * the same blob rather than being re-uploaded. A path we never wrote is reported
 * instead of resolved: that is the agent having added an image, and the caller has
 * to ingest the bytes before the deck can reference it.
 */
export const readWorkspace = (
  { assetSources, readJson }: {
    assetSources: Map<string, string>
    /** Returns parsed JSON for a workspace-relative path, or undefined if absent. */
    readJson: (path: string) => unknown
  },
): WorkspaceReadback => {
  const deck = (readJson('deck/deck.json') ?? {}) as {
    powerPointSharedLayers?: string
    slideIndex?: number
    slides?: DeckIndexEntry[]
    theme?: unknown
    title?: string
  }
  const addedAssets = new Set<string>()

  const restore = (node: unknown): unknown => {
    if (typeof node === 'string') {
      if (!node.startsWith('assets/')) return node
      const url = assetSources.get(node)
      if (url) return url
      addedAssets.add(node)
      return node
    }
    if (Array.isArray(node)) return node.map(restore)
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(node)) out[key] = restore(value)
      return out
    }
    return node
  }

  const slides: SnapshotSlide[] = []
  for (const entry of deck.slides ?? []) {
    if (!entry?.file) continue
    const parsed = restore(readJson(`deck/${entry.file}`))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
    const slide = parsed as SnapshotSlide
    // `deck.json` is the index, so its id wins: renaming a slide there is how a
    // reorder is expressed, and the slide file need not have been touched.
    slides.push({ ...slide, id: entry.id ?? slide.id })
  }

  return {
    addedAssets: [...addedAssets],
    slideIndex: deck.slideIndex ?? 0,
    slides,
    ...(typeof deck.powerPointSharedLayers === 'string'
      ? { powerPointSharedLayers: restore(readJson(`deck/${deck.powerPointSharedLayers}`)) as SnapshotPowerPointSharedLayers }
      : {}),
    theme: deck.theme ?? {},
    title: deck.title ?? '',
  }
}
