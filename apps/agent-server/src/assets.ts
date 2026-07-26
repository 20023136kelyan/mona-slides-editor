import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import type { ServerResponse } from 'node:http'
import { imageSize } from 'image-size'

import { decodeSignedValue, encodeSignedValue } from './security.js'

const MAX_IMAGE_BYTES = 12 * 1024 * 1024
const MAX_IMAGE_DIMENSION = 20_000
const IMAGE_ASSET_HOSTS = new Set(['images.pexels.com'])
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

// Imports are fetched server-side, so the host allowlist is what stops the
// agent being talked into fetching an arbitrary URL.
const requireAllowedImageUrl = (value: string): URL => {
  const url = new URL(value)
  if (url.protocol !== 'https:' || !IMAGE_ASSET_HOSTS.has(url.hostname)) {
    throw new Error('This image host is not allowed')
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
    // The same library the Photos panel shows. One source means the agent's
    // picks and the user's picks are drawn from - and can inform - the same
    // catalog, instead of the agent browsing somewhere the user never sees.
    const apiKey = process.env.PEXELS_API_KEY?.trim()
    if (!apiKey) return []
    const url = new URL('https://api.pexels.com/v1/search')
    url.search = new URLSearchParams({
      per_page: '20',
      query: normalized,
    }).toString()
    const response = await fetch(url, { headers: { Authorization: apiKey }, signal })
    if (!response.ok) throw new Error(`Image search failed (${response.status})`)
    const payload = await response.json() as {
      photos?: Array<{
        alt?: unknown
        id?: unknown
        photographer?: unknown
        src?: { large2x?: unknown; medium?: unknown; original?: unknown }
      }>
    }
    const results: PublicImageSearchResult[] = []
    for (const photo of payload.photos ?? []) {
      const full = photo.src?.large2x ?? photo.src?.original
      const thumbnail = photo.src?.medium ?? full
      if (typeof full !== 'string' || typeof thumbnail !== 'string') continue
      // The id is a signed {alt, mime, sourceUrl}: import re-derives the URL
      // from it rather than trusting one supplied by the caller, so the agent
      // cannot point the importer at an arbitrary address.
      const alt = typeof photo.alt === 'string' && photo.alt.trim() ? photo.alt : normalized
      const signed: SignedSearchResult = { alt, mime: 'image/jpeg', sourceUrl: full }
      results.push({
        alt,
        attribution: typeof photo.photographer === 'string' ? `${photo.photographer} / Pexels` : 'Pexels',
        id: encodeSignedValue(JSON.stringify(signed), this.#signingKey),
        previewUrl: thumbnail,
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
    requireAllowedImageUrl(signed.sourceUrl)
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

export interface BrowseQuery {
  orientation?: string
  page?: number
  perPage?: number
  query?: string
}

/**
 * Panel-facing media search.
 *
 * Distinct from `ManagedImageAssets.search`, which the agent uses: that one
 * returns signed ids because imports are fetched server-side. The panels insert
 * a URL straight into the deck, so they get plain source URLs. Both hit the
 * same Pexels library, so a picture the agent finds is one the user could have.
 */
export const browsePexelsImages = async (body: BrowseQuery, signal?: AbortSignal) => {
  const apiKey = process.env.PEXELS_API_KEY?.trim()
  if (!apiKey) return { data: [], total: 0 }
  const params = new URLSearchParams({
    page: String(Math.max(1, Number(body.page) || 1)),
    per_page: String(Math.min(80, Math.max(1, Number(body.perPage) || 30))),
    query: (body.query || 'nature').trim() || 'nature',
  })
  if (body.orientation && body.orientation !== 'all') params.set('orientation', body.orientation)
  const response = await fetch(`https://api.pexels.com/v1/search?${params}`, {
    headers: { Authorization: apiKey },
    signal,
  })
  if (!response.ok) throw new Error(`Image search failed (${response.status})`)
  const payload = await response.json() as {
    photos?: Array<{ height: number; id: number; src?: { large?: string; medium?: string; original?: string }; width: number }>
    total_results?: number
  }
  return {
    data: (payload.photos ?? [])
      .map(photo => ({
        height: photo.height,
        id: photo.id,
        src: photo.src?.large || photo.src?.medium || photo.src?.original || '',
        width: photo.width,
      }))
      .filter(photo => photo.src),
    total: payload.total_results ?? 0,
  }
}

/** Videos are linked, never imported, so a clip never lands in the document. */
export const browsePexelsVideos = async (body: BrowseQuery, signal?: AbortSignal) => {
  const apiKey = process.env.PEXELS_API_KEY?.trim()
  if (!apiKey) return { videos: [] }
  const params = new URLSearchParams({
    per_page: String(Math.min(80, Math.max(1, Number(body.perPage) || 24))),
    query: (body.query || 'abstract').trim() || 'abstract',
  })
  const response = await fetch(`https://api.pexels.com/videos/search?${params}`, {
    headers: { Authorization: apiKey },
    signal,
  })
  if (!response.ok) throw new Error(`Video search failed (${response.status})`)
  const payload = await response.json() as {
    videos?: Array<{
      duration?: number
      id?: number
      image?: string
      user?: { name?: string }
      video_files?: Array<{ height?: number; link?: string; quality?: string; width?: number }>
    }>
  }
  const videos = (payload.videos ?? []).flatMap(video => {
    // Prefer HD at or below 1080p: the 4K original is a punishing link at slide size.
    const files = (video.video_files ?? []).filter(file => typeof file.link === 'string')
    const chosen = files.find(file => file.quality === 'hd' && (file.height ?? 0) <= 1080) ?? files[0]
    if (!chosen?.link) return []
    return [{
      alt: video.user?.name ? `Video by ${video.user.name}` : 'Pexels video',
      attribution: video.user?.name ? `${video.user.name} / Pexels` : 'Pexels',
      duration: video.duration ?? 0,
      height: chosen.height ?? 0,
      id: String(video.id ?? chosen.link),
      poster: video.image ?? '',
      src: chosen.link,
      width: chosen.width ?? 0,
    }]
  })
  return { videos }
}
