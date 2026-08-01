import { useSyncExternalStore } from 'react'

/**
 * Which model the next turn runs on, and how hard it should think, app-wide.
 *
 * All that survives of a provider configuration that also carried a provider id and
 * an API key. There is one provider now, and its credential is the machine's own
 * Claude login rather than anything the renderer holds.
 */
export interface AgentModelSelection {
  /** Undefined leaves the SDK's own default rather than asserting a depth. */
  effort?: string
  model?: string
}

let selection: AgentModelSelection = {}
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
  setModel(model: string) {
    const next = model.trim()
    if (!next || next === selection.model) return
    // A depth chosen for one model may not exist on another, so it is dropped
    // rather than carried over and rejected when the turn starts.
    set({ model: next })
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

export const useAgentModelSelection = (): AgentModelSelection => (
  useSyncExternalStore(agentModelStore.subscribe, agentModelStore.getSnapshot, agentModelStore.getSnapshot)
)
