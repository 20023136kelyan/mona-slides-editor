import { afterEach, describe, expect, test } from 'vitest'

import {
  agentPromptQueue,
  consumeAgentPrompt,
  enqueueAgentPrompt,
} from '@/features/editor/agent/agent-prompt-queue'
import { buildTextRewritePrompt } from '@/features/editor/agent/agent-text-prompt'

afterEach(() => {
  for (const prompt of agentPromptQueue.getSnapshot()) consumeAgentPrompt(prompt.id)
})

describe('buildTextRewritePrompt', () => {
  test('pins the rewrite to one native element and preserves its presentation properties', () => {
    const prompt = buildTextRewritePrompt({
      currentText: 'Quarterly "results"',
      elementId: 'element-7',
      instruction: 'Condense and clarify',
      slideId: 'slide-2',
    })

    expect(prompt).toContain('Slide id: slide-2')
    expect(prompt).toContain('Element id: element-7')
    expect(prompt).toContain('Current visible text: "Quarterly \\"results\\""')
    expect(prompt).toContain('Change only that element’s wording')
    expect(prompt).toContain('Keep the result editable')
    expect(prompt).toContain('call apply')
  })
})

describe('agentPromptQueue', () => {
  test('retains prompts until the lazy dock consumes them and preserves FIFO order', () => {
    const first = enqueueAgentPrompt('Polish element one')
    const second = enqueueAgentPrompt('Condense element two')

    expect(agentPromptQueue.getSnapshot()).toEqual([first, second])
    expect(consumeAgentPrompt(first.id)).toBe(true)
    expect(agentPromptQueue.getSnapshot()).toEqual([second])
    expect(consumeAgentPrompt(first.id)).toBe(false)
    expect(agentPromptQueue.getSnapshot()).toEqual([second])
  })
})
