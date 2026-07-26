import { describe, expect, it } from 'vitest'

import { effortLevelsFor, type AgentModel } from '@/features/editor/agent/agent-model-catalog'

const model = (overrides: Partial<AgentModel>): AgentModel => ({
  id: 'sonnet',
  name: 'Sonnet',
  ...overrides,
})

describe('reasoning depth per model', () => {
  it('offers the levels the model reports', () => {
    expect(effortLevelsFor(model({ effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] })))
      .toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
  })

  it('offers none for a model that reports none', () => {
    // Haiku reports supportsEffort false, so the catalog carries an empty list.
    // Sending it a level would be rejected, so the control must not appear.
    expect(effortLevelsFor(model({ effortLevels: [], id: 'haiku', name: 'Haiku' }))).toEqual([])
  })

  it('offers none for an entry that carries no effort field at all', () => {
    // The declared fallback, shown before the plan's catalog arrives. Absent is
    // not the same as empty, but neither offers a control.
    expect(effortLevelsFor(model({ id: 'default', name: 'Claude' }))).toEqual([])
  })

  it('offers none when there is no model yet', () => {
    expect(effortLevelsFor(undefined)).toEqual([])
  })
})
