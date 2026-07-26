import { createReadStream } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join, normalize, sep } from 'node:path'
import { Readable } from 'node:stream'
import { app, ipcMain } from 'electron'

/**
 * The deck, on disk.
 *
 * `deck.json` beside an `assets/` directory — the layout `agent-workspace.ts`
 * already writes for the agent, so the two are now the same shape rather than one
 * being a translation of the other.
 *
 * This replaces a model that kept binary in IndexedDB keyed by `blob:` URLs. That
 * arrangement had a failure with no recovery: an object URL is only a handle, so
 * every save had to fetch the bytes back through it, and any fetch that failed left
 * the deck referencing bytes that existed nowhere. The images came back blank on the
 * next launch and no amount of re-saving could fix it. A path does not have that
 * property — the reference *is* the location.
 */

/** One deck for now; a library of them is the same directory, repeated. */
const DECK_ID = 'working'

const decksRoot = () => join(app.getPath('userData'), 'decks')
const deckRoot = () => join(decksRoot(), DECK_ID)
const assetsRoot = () => join(deckRoot(), 'assets')
const deckFile = () => join(deckRoot(), 'deck.json')

/**
 * Assets are addressed by name, never by path.
 *
 * The name reaches here from deck JSON, which the agent can write, so a value like
 * `../../../.ssh/id_rsa` must not resolve. Taking the basename makes traversal
 * impossible rather than merely checked for.
 */
const assetPath = (name: string): string | undefined => {
  const safe = basename(normalize(name))
  if (!safe || safe.startsWith('.')) return undefined
  const target = join(assetsRoot(), safe)
  return target.startsWith(assetsRoot() + sep) ? target : undefined
}

const MIME = new Map(Object.entries({
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
}))

/**
 * Serves `mona://asset/<name>` straight off disk.
 *
 * Registered alongside the renderer's own handler, which is why both share a scheme
 * and differ by host. Range requests are not implemented, so long video seeks will
 * be poor — worth knowing before someone puts an hour of footage on a slide.
 */
export const handleAssetRequest = async (request: Request): Promise<Response | undefined> => {
  const { hostname, pathname } = new URL(request.url)
  if (hostname !== 'asset') return undefined
  const target = assetPath(decodeURIComponent(pathname.replace(/^\//, '')))
  if (!target || !await stat(target).then(entry => entry.isFile()).catch(() => false)) {
    return new Response('Not found', { status: 404 })
  }
  return new Response(Readable.toWeb(createReadStream(target)) as ReadableStream, {
    headers: { 'content-type': MIME.get(extname(target)) ?? 'application/octet-stream' },
  })
}

interface StoredDeck {
  presentation: unknown
  savedAt: number
  version: number
}

const readDeck = async (): Promise<StoredDeck | null> => {
  try {
    return JSON.parse(await readFile(deckFile(), 'utf8')) as StoredDeck
  }
  catch {
    // Absent or unreadable are the same answer: there is no deck to restore.
    return null
  }
}

/**
 * Written to a sibling first, then renamed.
 *
 * `rename` is atomic within a directory, so a crash mid-write leaves the previous
 * deck intact rather than a truncated one. The old IndexedDB path got this from the
 * transaction; on a filesystem it has to be asked for.
 */
const writeDeck = async (presentation: unknown): Promise<number> => {
  await mkdir(deckRoot(), { recursive: true })
  const savedAt = Date.now()
  const pending = `${deckFile()}.pending`
  await writeFile(pending, JSON.stringify({ presentation, savedAt, version: 5 }))
  await rename(pending, deckFile())
  return savedAt
}

/**
 * Writes an asset and returns the URL the deck will refer to it by.
 *
 * The bytes land before the reference exists anywhere, which is the whole point:
 * there is no window in which the deck names something unwritten.
 */
const writeAsset = async (name: string, bytes: ArrayBuffer): Promise<string> => {
  const target = assetPath(name)
  if (!target) throw new Error(`Refusing to write an asset named ${name}`)
  await mkdir(assetsRoot(), { recursive: true })
  await writeFile(target, Buffer.from(bytes))
  return `mona://asset/${encodeURIComponent(basename(target))}`
}

/**
 * Deletes assets the deck no longer names.
 *
 * Called after a successful save, so the surviving set is known. Failure is
 * survivable — an orphan costs disk, where deleting one still referenced costs a
 * picture — so this never throws.
 */
const collectGarbage = async (keep: readonly string[]): Promise<void> => {
  const wanted = new Set(keep.map(name => basename(normalize(name))))
  const present = await readdir(assetsRoot()).catch(() => [] as string[])
  await Promise.all(present
    .filter(name => !wanted.has(name))
    .map(name => rm(join(assetsRoot(), name), { force: true }).catch(() => undefined)))
}

export const registerDeckIpc = (): void => {
  ipcMain.handle('mona:deck:read', () => readDeck())
  ipcMain.handle('mona:deck:write', (_event, presentation: unknown) => writeDeck(presentation))
  ipcMain.handle('mona:deck:write-asset', (_event, name: string, bytes: ArrayBuffer) => writeAsset(name, bytes))
  ipcMain.handle('mona:deck:collect-garbage', (_event, keep: string[]) => collectGarbage(keep ?? []))
  ipcMain.handle('mona:deck:clear', () => rm(deckRoot(), { force: true, recursive: true }))
  // Where the agent's workspace should copy assets from, so it can read them off
  // disk instead of asking the renderer for base64 one at a time.
  ipcMain.handle('mona:deck:assets-directory', () => assetsRoot())
}
