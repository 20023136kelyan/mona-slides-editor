import { useSyncExternalStore } from 'react'

import type { AgentProviderId } from '@mona/agent-protocol'

import type { AgentModel } from './agent-model-catalog'

/** The model used when the next provider turn starts. */
export interface AgentModelSelection {
  effort?: string
  model?: string
  providerId: AgentProviderId
}

let selection: AgentModelSelection = { providerId: 'anthropic' }
const listeners = new Set<() => void>()

const set = (next: AgentModelSelection) => {
  selection = next
  listeners.forEach(listener => listener())
}

export const agentModelStore = {
  getSnapshot: (): AgentModelSelection => selection,
  setEffort(effort: string | undefined) {
    if (effort === selection.effort) return
    set({ ...selection, effort })
  },
  setModel(model: Pick<AgentModel, 'id' | 'providerId'>) {
    const id = model.id.trim()
    if (!id || (id === selection.model && model.providerId === selection.providerId)) return
    set({ model: id, providerId: model.providerId })
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

export const useAgentModelSelection = (): AgentModelSelection => (
  useSyncExternalStore(agentModelStore.subscribe, agentModelStore.getSnapshot, agentModelStore.getSnapshot)
)
