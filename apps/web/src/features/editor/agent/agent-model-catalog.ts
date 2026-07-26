import { useSyncExternalStore } from 'react'

import { monaBridge } from '@/lib/mona-bridge'

export interface AgentModel {
  /**
   * Reasoning depths this model accepts, in the order to offer them. Absent means
   * no such control exists; empty means the model refuses one, which is not the
   * same thing.
   */
  effortLevels?: readonly string[]
  id: string
  name: string
}

/**
 * What to show before the host answers, and if it never does.
 *
 * The real catalog belongs to the signed-in plan, so it can only come from the
 * Agent SDK. This is the floor: a failed read leaves a usable picker rather than an
 * empty one, and `default` is what the SDK resolves for the plan.
 */
const DECLARED: readonly AgentModel[] = [{ id: 'default', name: 'Claude' }]

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

export const useAgentModels = (): readonly AgentModel[] => (
  useSyncExternalStore(subscribe, () => models, () => DECLARED)
)

/** Depths to offer for a model, or none when it takes no depth at all. */
export const effortLevelsFor = (model: AgentModel | undefined): readonly string[] => (
  model?.effortLevels ?? []
)
