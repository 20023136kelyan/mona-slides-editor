import {
  createModels,
  type Models,
} from '@earendil-works/pi-ai'
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic'
import { googleProvider } from '@earendil-works/pi-ai/providers/google'
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex'
import { MONA_AGENT_MODELS, getMonaAgentModel } from '@mona/agent-protocol'

import { SessionCredentialStore, type CredentialVault } from './credential-vault.js'

export type ExternalProviderId = 'anthropic-claude' | 'google-ai-studio' | 'openai-chatgpt'

const PROVIDER_CONFIGURATION: Record<ExternalProviderId, {
  defaultModelId: string
  piProviderId: 'anthropic' | 'google' | 'openai-codex'
  planLabel: string
}> = {
  'anthropic-claude': {
    defaultModelId: 'claude-sonnet-5',
    piProviderId: 'anthropic',
    planLabel: 'Claude Pro / Max',
  },
  'google-ai-studio': {
    defaultModelId: 'gemini-3.6-flash',
    piProviderId: 'google',
    planLabel: 'Google AI Studio',
  },
  'openai-chatgpt': {
    defaultModelId: 'gpt-5.6-sol',
    piProviderId: 'openai-codex',
    planLabel: 'ChatGPT Plus / Pro',
  },
}

export const isExternalProviderId = (value: string): value is ExternalProviderId => (
  value === 'anthropic-claude' || value === 'google-ai-studio' || value === 'openai-chatgpt'
)

export const getProviderConfiguration = (providerId: ExternalProviderId) => (
  PROVIDER_CONFIGURATION[providerId]
)

export const createSessionModels = (vault: CredentialVault, sessionId: string): Models => {
  const models = createModels({
    credentials: new SessionCredentialStore(vault, sessionId),
    authContext: {
      env: async () => undefined,
      fileExists: async () => false,
    },
  })
  models.setProvider(openaiCodexProvider())
  models.setProvider(anthropicProvider())
  models.setProvider(googleProvider())
  return models
}


export const resolveExternalModelId = (
  providerId: ExternalProviderId,
  requestedModelId?: string,
): string => {
  const configuration = getProviderConfiguration(providerId)
  const modelId = requestedModelId ?? configuration.defaultModelId
  const model = getMonaAgentModel(providerId, modelId)
  if (!model || !MONA_AGENT_MODELS.some(candidate => candidate.id === model.id)) {
    throw new Error(`Model ${modelId} is not available for ${providerId}`)
  }
  return model.id
}


/**
 * The server half of pi's proxy protocol.
 *
 * `streamProxy` runs the agent loop in the browser and posts each model call
 * here; we own the credentials, resolve the model against our own catalog, and
 * stream pi's own events back. `partial` is stripped from every event because
 * the client reconstructs it locally - that is the protocol, and it keeps a
 * per-token frame small instead of re-sending the whole message each delta.
 */
export const streamProviderProxy = async (
  models: Models,
  value: unknown,
  write: (line: string) => void,
  signal?: AbortSignal,
): Promise<void> => {
  if (!value || typeof value !== 'object') throw new Error('Invalid proxy stream request')
  const request = value as { context?: unknown; model?: { id?: unknown; provider?: unknown }; options?: unknown }
  const providerId = typeof request.model?.provider === 'string' ? request.model.provider : ''
  const modelId = typeof request.model?.id === 'string' ? request.model.id : ''
  // Re-resolved here rather than trusted from the client: the browser sends
  // which model it wants, never the credentials or endpoint it reaches.
  const model = models.getModel(providerId, modelId)
  if (!model) throw new Error(`Configured model ${modelId || '(unknown)'} is unavailable`)
  if (!request.context || typeof request.context !== 'object') throw new Error('A proxy stream needs a context')

  const stream = models.stream(model, request.context as never, {
    ...(request.options && typeof request.options === 'object' ? request.options : {}),
    signal,
  } as never)
  for await (const event of stream) {
    const { partial: _partial, ...frame } = event as Record<string, unknown> & { partial?: unknown }
    write(`data: ${JSON.stringify(frame)}\n`)
  }
}
