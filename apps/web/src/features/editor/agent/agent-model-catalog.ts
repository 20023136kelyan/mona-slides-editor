import { useSyncExternalStore } from 'react'
import { MONA_AGENT_MODELS } from '@mona/agent-protocol'

import type { AgentProviderId } from '@/features/editor/agent/agent-types'

export interface AgentModel {
  badge?: 'max'
  /**
   * Reasoning depths this model accepts, in the order to offer them. Absent
   * means the provider exposes no such control; empty means the model refuses
   * one, which is not the same thing.
   */
  effortLevels?: readonly string[]
  id: string
  name: string
  providerId: AgentProviderId
}

/**
 * What to show before the server answers, and if it never does.
 *
 * Anthropic's real catalog belongs to the signed-in plan, so it can only come
 * from the server. Everything else is declared, and this list is also the floor:
 * a failed fetch leaves a usable picker rather than an empty one.
 */
const DECLARED: readonly AgentModel[] = [...MONA_AGENT_MODELS]

let models: readonly AgentModel[] = DECLARED
let inflight: Promise<void> | null = null
const listeners = new Set<() => void>()

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  // Kicked off on first subscription rather than at module load, so nothing is
  // fetched for a page that never opens the dock.
  void loadAgentModels()
  return () => listeners.delete(listener)
}

export const loadAgentModels = (): Promise<void> => {
  inflight ??= fetch('/api/agent/models', { credentials: 'include' })
    .then(async response => {
      if (!response.ok) throw new Error('Could not load the model catalog')
      const payload = await response.json() as { models?: AgentModel[] }
      if (payload.models?.length) {
        models = payload.models
        listeners.forEach(listener => listener())
      }
    })
    .catch(() => {
      // Allow a later attempt; the declared list carries us until then.
      inflight = null
    })
  return inflight
}

export const useAgentModels = (): readonly AgentModel[] => (
  useSyncExternalStore(subscribe, () => models, () => DECLARED)
)

/** Depths to offer for a model, or none when it takes no depth at all. */
export const effortLevelsFor = (model: AgentModel | undefined): readonly string[] => (
  model?.effortLevels ?? []
)
