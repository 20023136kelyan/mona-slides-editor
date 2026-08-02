import type { AgentModelDescriptor } from '@mona/agent-protocol'

import { CodexAppServerClient } from './codex-app-server.js'

interface CodexModel {
  displayName?: string
  hidden?: boolean
  id?: string
  model?: string
  supportedReasoningEfforts?: Array<{ reasoningEffort?: string }>
}

interface ModelListResponse {
  data?: CodexModel[]
  nextCursor?: string | null
}

const CACHE_MS = 10 * 60_000
let cached: { at: number; models: AgentModelDescriptor[] } | undefined

export const readCodexModels = async (
  executablePath: string,
  now = Date.now(),
): Promise<AgentModelDescriptor[]> => {
  if (cached && now - cached.at < CACHE_MS) return cached.models
  const client = await CodexAppServerClient.connect({ executablePath })
  try {
    const models: AgentModelDescriptor[] = []
    let cursor: string | null = null
    do {
      const response: ModelListResponse = await client.request<ModelListResponse>('model/list', {
        ...(cursor ? { cursor } : {}),
        includeHidden: false,
        limit: 100,
      })
      for (const model of response.data ?? []) {
        const id = model.model ?? model.id
        if (!id || model.hidden) continue
        models.push({
          effortLevels: (model.supportedReasoningEfforts ?? [])
            .map((option: { reasoningEffort?: string }) => option.reasoningEffort)
            .filter((effort: string | undefined): effort is string => Boolean(effort)),
          id,
          name: model.displayName ?? id,
          providerId: 'openai',
        })
      }
      cursor = response.nextCursor ?? null
    } while (cursor)
    cached = { at: now, models }
    return models
  }
  catch {
    return cached?.models ?? []
  }
  finally {
    client.close()
  }
}

export const forgetCodexModels = (): void => {
  cached = undefined
}
