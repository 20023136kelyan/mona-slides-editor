import { useSyncExternalStore } from 'react'
import type { AgentModelDescriptor, AgentProviderId } from '@mona/agent-protocol'

import { monaBridge } from '@/lib/mona-bridge'

export interface AgentModel extends AgentModelDescriptor {
  /**
   * Reasoning depths this model accepts, in the order to offer them. Absent means
   * no such control exists; empty means the model refuses one, which is not the
   * same thing.
   */
  effortLevels?: readonly string[]
  providerId: AgentProviderId
}

/**
 * What every agent surface shows before the host answers, and if it never does.
 *
 * The real catalogs belong to the signed-in provider plans and are discovered by
 * their native harnesses. This is the floor: a failed read leaves a usable picker
 * rather than an empty one, and `default` is what Claude resolves for its plan.
 */
const DECLARED: readonly AgentModel[] = [{
  id: 'default',
  name: 'Claude',
  providerId: 'anthropic',
}]

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
  inflight ??= monaBridge().models()
    .then(catalog => {
      if (!catalog.length) return
      models = catalog
      listeners.forEach(listener => listener())
    })
    .catch(() => {
      // Allow a later attempt; the declared list carries us until then.
      inflight = null
    })
  return inflight
}

export const refreshAgentModels = (): Promise<void> => {
  inflight = null
  return loadAgentModels()
}

export const useAgentModels = (): readonly AgentModel[] => (
  useSyncExternalStore(subscribe, () => models, () => DECLARED)
)

/** Depths to offer for a model, or none when it takes no depth at all. */
export const effortLevelsFor = (model: AgentModel | undefined): readonly string[] => (
  model?.effortLevels ?? []
)
