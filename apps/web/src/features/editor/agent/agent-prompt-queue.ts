import { useSyncExternalStore } from 'react'

/**
 * A prompt another editor surface has handed to the agent dock.
 *
 * The dock is lazy and normally unmounted, so a DOM event is not enough: the
 * request has to survive the state change that opens it. This tiny external
 * store is renderer-local, just like the agent conversation it feeds.
 */
export interface QueuedAgentPrompt {
  id: number
  text: string
}

let nextId = 0
let queued: readonly QueuedAgentPrompt[] = []
const listeners = new Set<() => void>()

const emit = () => {
  for (const listener of listeners) listener()
}

export const enqueueAgentPrompt = (text: string): QueuedAgentPrompt => {
  const prompt = { id: ++nextId, text: text.trim() }
  if (!prompt.text) throw new Error('An agent prompt cannot be empty.')
  queued = [...queued, prompt]
  emit()
  return prompt
}

export const consumeAgentPrompt = (id: number): boolean => {
  const next = queued.filter(prompt => prompt.id !== id)
  if (next.length === queued.length) return false
  queued = next
  emit()
  return true
}

export const agentPromptQueue = {
  getSnapshot: () => queued,
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

export const useQueuedAgentPrompt = (): QueuedAgentPrompt | undefined => (
  useSyncExternalStore(
    agentPromptQueue.subscribe,
    () => agentPromptQueue.getSnapshot()[0],
    () => undefined,
  )
)
