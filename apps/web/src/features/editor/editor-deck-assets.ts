import { monaBridge } from '@/lib/mona-bridge'

/**
 * Binary that belongs to the deck, stored as files.
 *
 * A deck refers to its images by URL, and that URL used to be an object URL — a
 * handle into this document's memory, with the bytes kept separately in IndexedDB
 * under the same handle as a key. Two things had to stay in step for a picture to
 * survive a restart, and when they did not there was no way back: the deck named
 * bytes that existed nowhere, the image was blank, and re-saving could not mend it
 * because the handle it would have re-read was already dead.
 *
 * `mona://asset/<name>` has no such gap. The reference *is* the location, so a deck
 * that names an asset either finds it or the file is genuinely gone.
 */

const ASSET_PREFIX = 'mona://asset/'

/** Whether a value is one of ours, as opposed to a remote or inline reference. */
export const isDeckAssetUrl = (value: string): boolean => value.startsWith(ASSET_PREFIX)

/** The filename a deck asset URL points at. */
export const deckAssetName = (url: string): string => (
  decodeURIComponent(url.slice(ASSET_PREFIX.length))
)

const EXTENSIONS: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
}

/**
 * Names are content-addressed, and computed without async.
 *
 * The same picture placed on four slides is one file — behaviour the old scheme
 * only got by accident when a URL happened to be reused, which is why one imported
 * deck carried the same 6 MB fill twice. It also makes writing idempotent: an
 * import that runs twice overwrites identical bytes rather than accumulating.
 *
 * FNV-1a rather than SHA-256 because the importer decides names inside a
 * synchronous conversion, and `crypto.subtle` is async. This is a content address,
 * not a security boundary: a collision would show the wrong picture, not admit an
 * attacker, and at 128 bits over one deck's images that is not a real risk.
 */
export const plannedAssetName = (bytes: Uint8Array, mediaType: string): string => {
  let a = 0x811c9dc5
  let b = 0x01000193
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index]!
    a = Math.imul(a ^ byte, 0x01000193)
    b = Math.imul(b ^ byte, 0x811c9dc5)
  }
  const stamp = `${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`
  return `${stamp}-${bytes.length.toString(16)}.${EXTENSIONS[mediaType] ?? 'bin'}`
}

/** Writes bytes under a name already decided, and returns the deck's URL for it. */
export const storeDeckAssetBytes = (name: string, bytes: ArrayBuffer): Promise<string> => (
  monaBridge().deck.writeAsset(name, bytes)
)

/** Stores a blob whose name has not been decided yet — a paste, an upload. */
export const storeDeckAsset = async (source: Blob): Promise<string> => {
  const bytes = new Uint8Array(await source.arrayBuffer())
  return storeDeckAssetBytes(plannedAssetName(bytes, source.type), bytes.buffer as ArrayBuffer)
}

/**
 * Every deck asset the model refers to, found by the shape of the value.
 *
 * Matched on value rather than field name, the rule that earned its keep before: a
 * 30 MB shape `pattern` was captured without anyone having listed `pattern`
 * anywhere, and an allowlist of field names is exactly how 191 MB of fills went
 * unnoticed for as long as they did.
 */
export const collectDeckAssetNames = (value: unknown, found = new Set<string>()): Set<string> => {
  if (typeof value === 'string') {
    if (isDeckAssetUrl(value)) found.add(deckAssetName(value))
  }
  else if (Array.isArray(value)) {
    for (const entry of value) collectDeckAssetNames(entry, found)
  }
  else if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) collectDeckAssetNames(entry, found)
  }
  return found
}
