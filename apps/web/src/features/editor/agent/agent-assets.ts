import type {
  AgentAssetSearchResult,
  AgentAssetService,
  AgentManagedAsset,
} from '@/features/editor/agent/agent-types'

const jsonRequest = async <Value>(
  input: RequestInfo | URL,
  init: RequestInit,
): Promise<Value> => {
  const response = await fetch(input, init)
  if (!response.ok) {
    const message = await response.text().catch(() => '')
    throw new Error(message || `Managed asset request failed (${response.status})`)
  }
  return response.json() as Promise<Value>
}

const validSearchResult = (value: unknown): value is AgentAssetSearchResult => {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.id === 'string'
    && typeof record.alt === 'string'
    && typeof record.previewUrl === 'string'
}

export const createManagedAgentAssetService = (): AgentAssetService => ({
  searchImages: async (query, signal) => {
    const payload = await jsonRequest<{ results?: unknown[] }>(
      `/api/agent/assets/images/search?q=${encodeURIComponent(query)}`,
      { credentials: 'include', signal },
    )
    return (payload.results ?? []).filter(validSearchResult).slice(0, 20)
  },
  importImage: async (result, signal) => {
    if (!validSearchResult(result)) throw new Error('The selected image result is invalid')
    const asset = await jsonRequest<AgentManagedAsset>('/api/agent/assets/images/import', {
      body: JSON.stringify({ result }),
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      signal,
    })
    if (
      typeof asset?.id !== 'string'
      || typeof asset.alt !== 'string'
      || typeof asset.src !== 'string'
      || !asset.src.startsWith('/api/agent/assets/')
    ) {
      throw new Error('Managed asset service returned an invalid asset')
    }
    return asset
  },
})

