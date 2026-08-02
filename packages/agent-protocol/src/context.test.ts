import { describe, expect, it } from 'vitest'

import {
  agentContextAfter,
  agentContextToResponsesItems,
  buildAgentContextHandoff,
  type AgentContextMessage,
} from './context'

const history: AgentContextMessage[] = [
  { content: 'Build a title slide.', id: 'user-1', role: 'user' },
  { content: 'I built it.', id: 'assistant-1', role: 'assistant' },
  { content: 'Make the title shorter.', id: 'user-2', role: 'user' },
]

describe('provider-neutral agent context', () => {
  it('returns only messages after a provider cursor', () => {
    expect(agentContextAfter(history, 'assistant-1')).toEqual([history[2]])
    expect(agentContextAfter(history, 'missing')).toEqual(history)
  })

  it('builds a delimited Claude handoff without changing message text', () => {
    const handoff = buildAgentContextHandoff(history.slice(1))
    expect(handoff).toContain('<mona_context_handoff version="1">')
    expect(handoff).toContain('I built it.')
    expect(handoff).toContain('Make the title shorter.')
  })

  it('maps roles to valid Responses API history items for Codex', () => {
    expect(agentContextToResponsesItems(history.slice(0, 2))).toEqual([
      {
        content: [{ text: 'Build a title slide.', type: 'input_text' }],
        role: 'user',
        type: 'message',
      },
      {
        content: [{ text: 'I built it.', type: 'output_text' }],
        role: 'assistant',
        type: 'message',
      },
    ])
  })
})
