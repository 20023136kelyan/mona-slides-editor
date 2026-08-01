import type { PowerPointIngestedAsset } from './types'

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

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const BASE64_VALUES = new Map([...BASE64_ALPHABET].map((character, index) => [character, index]))

/**
 * Content-addressed name shared by desktop ingestion and the renderer.
 *
 * This is an identity inside one presentation, not a security primitive. The
 * two independent 32-bit FNV lanes plus byte length keep repeated media
 * idempotent without making synchronous conversion wait on WebCrypto.
 */
export const plannedPowerPointAssetName = (
  bytes: Uint8Array,
  mediaType: string,
): string => {
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

const decodeBase64 = (payload: string): Uint8Array => {
  const compact = payload.replace(/\s+/g, '')
  if (!compact || compact.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(compact)) {
    throw new Error('Invalid base64 payload')
  }
  const padding = compact.endsWith('==') ? 2 : compact.endsWith('=') ? 1 : 0
  const output = new Uint8Array(compact.length / 4 * 3 - padding)
  let offset = 0
  for (let index = 0; index < compact.length; index += 4) {
    const a = BASE64_VALUES.get(compact[index] ?? '')
    const b = BASE64_VALUES.get(compact[index + 1] ?? '')
    const c = compact[index + 2] === '=' ? 0 : BASE64_VALUES.get(compact[index + 2] ?? '')
    const d = compact[index + 3] === '=' ? 0 : BASE64_VALUES.get(compact[index + 3] ?? '')
    if (a === undefined || b === undefined || c === undefined || d === undefined) {
      throw new Error('Invalid base64 payload')
    }
    const value = (a << 18) | (b << 12) | (c << 6) | d
    if (offset < output.length) output[offset++] = (value >>> 16) & 0xff
    if (offset < output.length) output[offset++] = (value >>> 8) & 0xff
    if (offset < output.length) output[offset++] = value & 0xff
  }
  return output
}

export interface PowerPointAssetCollector {
  resolve: (source: string) => string
  take: () => PowerPointIngestedAsset[]
}

export const createPowerPointAssetCollector = (
  assetUrl: (asset: { mediaType: string; name: string }) => string = ({ name }) => (
    `pptx-asset://${encodeURIComponent(name)}`
  ),
): PowerPointAssetCollector => {
  const assets = new Map<string, PowerPointIngestedAsset>()
  return {
    resolve(source) {
      const match = /^data:([^;,]*);base64,(.*)$/s.exec(source)
      if (!match) return source
      try {
        const mediaType = match[1] || 'application/octet-stream'
        const bytes = decodeBase64(match[2] ?? '')
        const name = plannedPowerPointAssetName(bytes, mediaType)
        const url = assetUrl({ mediaType, name })
        assets.set(name, { bytes, mediaType, name, url })
        return url
      }
      catch {
        // A malformed payload is retained verbatim and reported by the normal
        // import capability report instead of being silently erased.
        return source
      }
    },
    take() {
      const result = [...assets.values()].map(asset => ({
        ...asset,
        bytes: asset.bytes.slice(),
      }))
      assets.clear()
      return result
    },
  }
}
