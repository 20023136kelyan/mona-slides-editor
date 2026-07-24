import { readFile } from 'node:fs/promises'
import { fileURLToPath, URL } from 'node:url'
import type { Plugin } from 'vite'

type MockImage = {
  height: number
  id: number
  src: string
  width: number
}

type SearchBody = {
  orientation?: 'all' | 'landscape' | 'portrait' | 'square'
  page?: number
  per_page?: number
  query?: string
}

const hashString = (value: string) => {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index)
    hash |= 0
  }
  return Math.abs(hash)
}

const matchesOrientation = (
  item: MockImage,
  orientation: SearchBody['orientation'],
) => {
  if (!orientation || orientation === 'all') return true
  const ratio = item.width / item.height
  if (orientation === 'landscape') return ratio > 1.15
  if (orientation === 'portrait') return ratio < 0.87
  return ratio >= 0.87 && ratio <= 1.15
}

const searchMockCatalog = async (body: SearchBody) => {
  const catalogPath = fileURLToPath(new URL('../../../../public/mocks/imgs.json', import.meta.url))
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8')) as MockImage[]
  const query = (body.query || 'nature').trim().toLowerCase() || 'nature'
  const page = Math.max(1, Number(body.page) || 1)
  const perPage = Math.min(80, Math.max(1, Number(body.per_page) || 30))
  const orientation = body.orientation || 'all'
  const start = hashString(query) % Math.max(1, catalog.length)
  const rotated = [...catalog.slice(start), ...catalog.slice(0, start)]
  const filtered = rotated.filter(item => matchesOrientation(item, orientation))
  const offset = (page - 1) * perPage
  return {
    data: filtered.slice(offset, offset + perPage),
    total: filtered.length,
  }
}

const searchPexels = async (body: SearchBody, apiKey: string) => {
  const query = (body.query || 'nature').trim() || 'nature'
  const page = Math.max(1, Number(body.page) || 1)
  const perPage = Math.min(80, Math.max(1, Number(body.per_page) || 30))
  const params = new URLSearchParams({
    query,
    page: String(page),
    per_page: String(perPage),
  })
  if (body.orientation && body.orientation !== 'all') params.set('orientation', body.orientation)

  const response = await fetch(`https://api.pexels.com/v1/search?${params}`, {
    headers: { Authorization: apiKey },
  })
  if (!response.ok) throw new Error(`Pexels search failed: ${response.status}`)
  const payload = await response.json() as {
    photos?: Array<{
      height: number
      id: number
      src?: { large?: string; medium?: string; original?: string }
      width: number
    }>
    total_results?: number
  }
  return {
    data: (payload.photos || []).map(photo => ({
      height: photo.height,
      id: photo.id,
      src: photo.src?.large || photo.src?.medium || photo.src?.original || '',
      width: photo.width,
    })).filter(photo => photo.src),
    total: payload.total_results || 0,
  }
}

const readJsonBody = async (request: import('node:http').IncomingMessage) => {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  if (!chunks.length) return {} as SearchBody
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as SearchBody
}

const DEFAULT_PEXELS_API_KEY = 'dd2UzCWw6MEkd2Oj0xBkQ90kal6mtQWBi1ZzTpxPAFxwQep0bvoi9RUt'

export function monaImageSearchApi(): Plugin {
  return {
    name: 'mona-image-search-api',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (request.method !== 'POST' || request.url !== '/api/tools/img_search') {
          next()
          return
        }
        try {
          const body = await readJsonBody(request)
          const apiKey = process.env.PEXELS_API_KEY?.trim() || DEFAULT_PEXELS_API_KEY
          let result
          try {
            result = await searchPexels(body, apiKey)
          }
          catch {
            result = await searchMockCatalog(body)
          }
          response.statusCode = 200
          response.setHeader('content-type', 'application/json')
          response.end(JSON.stringify(result))
        }
        catch (error) {
          response.statusCode = 500
          response.setHeader('content-type', 'application/json')
          response.end(JSON.stringify({
            error: error instanceof Error ? error.message : 'Image search failed',
          }))
        }
      })
    },
  }
}
