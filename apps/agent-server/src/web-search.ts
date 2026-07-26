/**
 * Web research, backed by Exa.
 *
 * The tool schema is always published so the model's contract stays stable
 * across deployments; the tool only becomes *callable* when `EXA_API_KEY` is
 * set. That way turning research on later is a configuration change, not a
 * protocol change — and a deployment without the key advertises nothing it
 * cannot honour.
 */
export interface WebSearchResult {
  snippet?: string
  title: string
  url: string
}

export const webSearchEnabled = (): boolean => Boolean(process.env.EXA_API_KEY?.trim())

export const searchWeb = async (
  query: string,
  signal?: AbortSignal,
): Promise<WebSearchResult[]> => {
  const apiKey = process.env.EXA_API_KEY?.trim()
  if (!apiKey) throw new Error('Web search is not configured on this deployment')
  const normalized = query.trim().slice(0, 400)
  if (!normalized) return []
  const response = await fetch('https://api.exa.ai/search', {
    body: JSON.stringify({
      contents: { text: { maxCharacters: 600 } },
      numResults: 6,
      query: normalized,
    }),
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    method: 'POST',
    signal,
  })
  if (!response.ok) throw new Error(`Web search failed (${response.status})`)
  const payload = await response.json() as {
    results?: Array<{ text?: unknown; title?: unknown; url?: unknown }>
  }
  const results: WebSearchResult[] = []
  for (const result of payload.results ?? []) {
    if (typeof result.url !== 'string') continue
    results.push({
      ...(typeof result.text === 'string' ? { snippet: result.text.slice(0, 600) } : {}),
      title: typeof result.title === 'string' ? result.title : result.url,
      url: result.url,
    })
  }
  return results
}
