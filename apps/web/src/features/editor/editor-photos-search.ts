export type PhotoOrientation = 'all' | 'landscape' | 'portrait' | 'square'

export interface PhotoSearchItem {
  height: number
  id: number | string
  src: string
  width: number
}

export interface PhotoSearchResult {
  data: PhotoSearchItem[]
  total: number
}

export type PhotoCategoryId =
  | 'business'
  | 'nature'
  | 'people'
  | 'technology'
  | 'trending'

export interface PhotoCategory {
  id: PhotoCategoryId
  query: string
}

export interface PhotoChip {
  id: string
  query: string
}

/** Curated discovery rows for the Photos home — each maps to a real Pexels query. */
export const PHOTO_CATEGORIES: readonly PhotoCategory[] = [
  { id: 'trending', query: 'trending' },
  { id: 'nature', query: 'nature' },
  { id: 'business', query: 'business' },
  { id: 'people', query: 'people' },
  { id: 'technology', query: 'technology' },
]

/** Quick-search chips shown under the Photos search field. */
export const PHOTO_CHIPS: readonly PhotoChip[] = [
  { id: 'white-background', query: 'white background' },
  { id: 'coffee', query: 'coffee' },
  { id: 'football', query: 'football' },
  { id: 'workspace', query: 'workspace' },
  { id: 'city', query: 'city' },
  { id: 'abstract', query: 'abstract' },
]

export const searchOnlinePhotos = async (
  query: string,
  options: {
    orientation?: PhotoOrientation
    page?: number
    perPage?: number
    signal?: AbortSignal
  } = {},
): Promise<PhotoSearchResult> => {
  const response = await fetch('/api/tools/img_search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query,
      page: options.page ?? 1,
      per_page: options.perPage ?? 30,
      orientation: options.orientation ?? 'all',
    }),
    signal: options.signal,
  })
  if (!response.ok) throw new Error(`Image search failed: ${response.status}`)
  const payload = await response.json() as { data?: PhotoSearchItem[]; total?: number }
  return {
    data: payload.data || [],
    total: payload.total || 0,
  }
}
