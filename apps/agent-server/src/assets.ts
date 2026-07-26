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
