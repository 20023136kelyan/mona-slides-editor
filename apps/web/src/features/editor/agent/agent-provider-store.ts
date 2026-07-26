import { useSyncExternalStore } from 'react'

import type { AgentProviderConfiguration, AgentProviderId } from '@/features/editor/agent/agent-types'

const DEFAULT_CONFIGURATION: AgentProviderConfiguration = {
  providerId: 'openai-chatgpt',
  model: 'gpt-5.6-sol',
}

let configuration = DEFAULT_CONFIGURATION
const listeners = new Set<() => void>()

const notify = () => listeners.forEach(listener => listener())

export const agentProviderStore = {
  clearApiKey() {
    if (!configuration.apiKey) return
    configuration = { ...configuration, apiKey: undefined }
    notify()
  },
  getSnapshot: (): AgentProviderConfiguration => configuration,
  setApiKey(apiKey: string) {
    configuration = { ...configuration, apiKey: apiKey.trim() || undefined }
    notify()
  },
  setModel(model: string) {
    configuration = { ...configuration, model: model.trim() || undefined }
    notify()
  },
  setProvider(providerId: AgentProviderId) {
    configuration = {
      ...configuration,
      providerId,
      ...(providerId === 'google-ai-studio' ? {} : { apiKey: undefined }),
    }
    notify()
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

export const useAgentProviderConfiguration = () => (
  useSyncExternalStore(agentProviderStore.subscribe, agentProviderStore.getSnapshot, agentProviderStore.getSnapshot)
)
