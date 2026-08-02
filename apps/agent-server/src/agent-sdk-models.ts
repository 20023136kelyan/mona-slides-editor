import { query, type EffortLevel, type ModelInfo, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'

import { monaAgentEnv } from './agent-sdk-env.js'

/**
 * A model as the picker needs it.
 *
 * `effortLevels` is empty for a model that takes no reasoning depth - Haiku, at
 * the time of writing - so the control can disable itself rather than sending a
 * level the model will reject.
 */
export interface AgentSdkModel {
  effortLevels: EffortLevel[]
  id: string
  name: string
}

/**
 * The catalog is a property of the signed-in plan, not of our source.
 *
 * We used to hardcode it, which drifted: the list named a model the SDK does not
 * offer and omitted the ones it does. Asking costs a subprocess, so the answer is
 * cached - a plan's model list changes on the order of weeks.
 */
const CACHE_MS = 10 * 60_000
let cached: { at: number; models: AgentSdkModel[] } | undefined

/** A prompt that never yields: `supportedModels` is a control request, so the
 * session has to be open, but no turn should run. */
const idlePrompt = async function* (): AsyncGenerator<SDKUserMessage> {
  await new Promise(resolve => setTimeout(resolve, 30_000))
}

export const toAgentSdkModel = (info: ModelInfo): AgentSdkModel => ({
  effortLevels: info.supportsEffort ? [...(info.supportedEffortLevels ?? [])] : [],
  id: info.value,
  name: info.displayName,
})

export const readAnthropicModels = async (
  now = Date.now(),
  executablePath?: string,
): Promise<AgentSdkModel[]> => {
  if (cached && now - cached.at < CACHE_MS) return cached.models
  const running = query({
    options: {
      env: monaAgentEnv(),
      ...(executablePath ? { pathToClaudeCodeExecutable: executablePath } : {}),
      // Nothing should load: this session exists only to be asked a question.
      settingSources: [],
      tools: [],
    },
    prompt: idlePrompt(),
  })
  try {
    const models = (await running.supportedModels()).map(toAgentSdkModel)
    cached = { at: now, models }
    return models
  }
  catch {
    // An unreachable catalog must not empty the picker; the caller keeps its
    // own fallback and we simply report nothing new.
    return cached?.models ?? []
  }
  finally {
    await running.interrupt().catch(() => undefined)
  }
}

export const forgetAnthropicModels = (): void => {
  cached = undefined
}
