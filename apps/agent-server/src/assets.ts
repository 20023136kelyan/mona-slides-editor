import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import type { ServerResponse } from 'node:http'
import { imageSize } from 'image-size'

import { decodeSignedValue, encodeSignedValue } from './security.js'

const MAX_IMAGE_BYTES = 12 * 1024 * 1024
const MAX_IMAGE_DIMENSION = 20_000
const WIKIMEDIA_HOST = 'upload.wikimedia.org'
const MIME_EXTENSION = new Map([
  ['image/gif', '.gif'],
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
])
const EXTENSION_MIME = new Map([...MIME_EXTENSION].map(([mime, extension]) => [extension, mime]))

interface SignedSearchResult {
  alt: string
  attribution?: string
  mime: string
  sourceUrl: string
}

export interface PublicImageSearchResult {
  alt: string
  attribution?: string
  id: string
  previewUrl: string
}

const stripHtml = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const stripped = value
    .replaceAll(/<[^>]*>/g, ' ')
    .replaceAll(/&(?:nbsp|#160);/gi, ' ')
    .replaceAll(/&amp;/gi, '&')
    .replaceAll(/\s+/g, ' ')
    .trim()
  return stripped ? stripped.slice(0, 500) : undefined
}

const requireWikimediaUrl = (value: string): URL => {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.hostname !== WIKIMEDIA_HOST) {
    throw new Error('Only Wikimedia-hosted image assets can be imported')
  }
  return url
}

export class ManagedImageAssets {
  readonly #directory: string
  readonly #signingKey: Buffer

  constructor(directory: string, signingKey: Buffer) {
    this.#directory = directory
    this.#signingKey = signingKey
  }

  async search(query: string, signal?: AbortSignal): Promise<PublicImageSearchResult[]> {
    const normalized = query.trim().slice(0, 240)
    if (!normalized) return []
    const url = new URL('https://commons.wikimedia.org/w/api.php')
    url.search = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      generator: 'search',
      gsrnamespace: '6',
      gsrlimit: '20',
      gsrsearch: `${normalized} filetype:bitmap`,
      iiprop: 'url|mime|size|extmetadata',
      iiurlwidth: '1600',
      origin: '*',
      prop: 'imageinfo',
    }).toString()
    const response = await fetch(url, {
      headers: { 'User-Agent': 'MonaSlides/0.1 (open-source presentation editor)' },
      signal,
    })
    if (!response.ok) throw new Error(`Image search failed (${response.status})`)
    const payload = await response.json() as {
      query?: {
        pages?: Array<{
          imageinfo?: Array<{
            extmetadata?: Record<string, { value?: unknown }>
            mime?: unknown
            thumburl?: unknown
            url?: unknown
          }>
          pageid?: unknown
          title?: unknown
        }>
      }
    }
    const results: PublicImageSearchResult[] = []
    for (const page of payload.query?.pages ?? []) {
      const info = page.imageinfo?.[0]
      if (
        !info
        || typeof page.title !== 'string'
        || typeof info.url !== 'string'
        || typeof info.thumburl !== 'string'
        || typeof info.mime !== 'string'
        || !MIME_EXTENSION.has(info.mime)
      ) continue
      try {
        requireWikimediaUrl(info.url)
        requireWikimediaUrl(info.thumburl)
      }
      catch {
        continue
      }
      const title = page.title.replace(/^File:/i, '').replace(/\.[^.]+$/, '').replaceAll('_', ' ').trim()
      const artist = stripHtml(info.extmetadata?.Artist?.value)
      const license = stripHtml(info.extmetadata?.LicenseShortName?.value)
      const attribution = [artist, license].filter(Boolean).join(' · ') || undefined
      const signed: SignedSearchResult = {
        alt: title || normalized,
        ...(attribution ? { attribution } : {}),
        mime: info.mime,
        // Import the API-generated presentation-resolution derivative rather
        // than an arbitrarily huge camera original.
        sourceUrl: info.thumburl,
      }
      results.push({
        alt: signed.alt,
        ...(attribution ? { attribution } : {}),
        id: encodeSignedValue(JSON.stringify(signed), this.#signingKey),
        previewUrl: info.thumburl,
      })
    }
    return results
  }

  async import(value: unknown, signal?: AbortSignal): Promise<{ alt: string; id: string; src: string }> {
    if (!value || typeof value !== 'object') throw new Error('Invalid managed image result')
    const id = (value as { id?: unknown }).id
    if (typeof id !== 'string' || id.length > 4_000) throw new Error('Invalid managed image result')
    const decoded = decodeSignedValue(id, this.#signingKey)
    if (!decoded) throw new Error('Managed image result signature is invalid')
    const signed = JSON.parse(decoded) as Partial<SignedSearchResult>
    if (
      typeof signed.alt !== 'string'
      || typeof signed.mime !== 'string'
      || typeof signed.sourceUrl !== 'string'
      || !MIME_EXTENSION.has(signed.mime)
    ) {
      throw new Error('Managed image result is invalid')
    }
    requireWikimediaUrl(signed.sourceUrl)
    const response = await fetch(signed.sourceUrl, {
      headers: { 'User-Agent': 'MonaSlides/0.1 (open-source presentation editor)' },
      signal,
    })
    if (!response.ok) throw new Error(`Image import failed (${response.status})`)
    const contentLength = Number(response.headers.get('content-length') ?? '0')
    if (contentLength > MAX_IMAGE_BYTES) throw new Error('Selected image is too large')
    const data = Buffer.from(await response.arrayBuffer())
    if (!data.byteLength || data.byteLength > MAX_IMAGE_BYTES) throw new Error('Selected image is too large or empty')
    const responseMime = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
    if (!responseMime || !MIME_EXTENSION.has(responseMime)) throw new Error('Selected image type is unsupported')
    const dimensions = imageSize(data)
    if (
      !dimensions.width
      || !dimensions.height
      || dimensions.width > MAX_IMAGE_DIMENSION
      || dimensions.height > MAX_IMAGE_DIMENSION
    ) {
      throw new Error('Selected image dimensions are invalid')
    }
    const extension = MIME_EXTENSION.get(responseMime)
    if (!extension) throw new Error('Selected image type is unsupported')
    const assetId = `${createHash('sha256').update(data).digest('hex')}${extension}`
    await mkdir(this.#directory, { recursive: true, mode: 0o700 })
    await writeFile(resolve(this.#directory, assetId), data, { flag: 'wx', mode: 0o600 }).catch(error => {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
    })
    return {
      alt: signed.alt.slice(0, 500),
      id: assetId,
      src: `/api/agent/assets/images/${assetId}`,
    }
  }

  async serve(assetId: string, response: ServerResponse): Promise<boolean> {
    if (!/^[a-f\d]{64}\.(?:gif|jpe?g|png|webp)$/i.test(assetId)) return false
    const extension = extname(assetId).toLowerCase()
    const mime = EXTENSION_MIME.get(extension)
    if (!mime) return false
    let data: Buffer
    try {
      data = await readFile(resolve(this.#directory, assetId))
    }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
      throw error
    }
    response.statusCode = 200
    response.setHeader('Cache-Control', 'private, max-age=31536000, immutable')
    response.setHeader('Content-Length', String(data.byteLength))
    response.setHeader('Content-Type', mime)
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.end(data)
    return true
  }
}
