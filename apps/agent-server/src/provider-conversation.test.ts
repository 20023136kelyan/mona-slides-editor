import type { UIMessageChunk } from 'ai'
import { describe, expect, it } from 'vitest'

import type { AgentProviderId } from '@mona/agent-protocol'

import { ProviderConversation } from './provider-conversation.js'
import type { ProviderSession, ProviderSessionPrompt } from './provider-session.js'

class TestSession implements ProviderSession {
  readonly modelId: string
  readonly providerId: AgentProviderId
  readonly prompts: ProviderSessionPrompt[] = []
  readonly #chunks: UIMessageChunk[] = []
  #closed = false
  #wake?: () => void

  constructor(providerId: AgentProviderId, modelId: string) {
    this.providerId = providerId
    this.modelId = modelId
  }

  send(prompt: ProviderSessionPrompt): void {
    this.prompts.push(prompt)
  }

  complete(text: string): void {
    const id = `${this.providerId}-message`
    this.#chunks.push(
      { id, type: 'text-start' },
      { delta: text, id, type: 'text-delta' },
      { id, type: 'text-end' },
      { type: 'finish' },
    )
    this.#wake?.()
    this.#wake = undefined
  }

  async *run(): AsyncGenerator<UIMessageChunk> {
    while (!this.#closed) {
      const chunk = this.#chunks.shift()
      if (chunk) {
        yield chunk
        continue
      }
      await new Promise<void>(resolve => { this.#wake = resolve })
    }
  }

  async interrupt(): Promise<void> {}

  close(): void {
    this.#closed = true
    this.#wake?.()
  }
}

const tick = async () => {
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('provider conversation routing', () => {
  it('returns a complete UI error when a provider cannot start', async () => {
    const chunks: UIMessageChunk[] = []
    const conversation = new ProviderConversation({
      createSession: async () => {
        throw new Error('Codex is not installed.')
      },
      emit: chunk => chunks.push(chunk),
    })

    conversation.prompt({
      context: [{ content: 'Hello', id: 'u1', role: 'user' }],
      modelId: 'codex',
      providerId: 'openai',
      text: 'Hello',
      userMessageId: 'u1',
    })
    await tick()

    expect(chunks.map(chunk => chunk.type)).toEqual(['start', 'error', 'finish'])
    expect(chunks[1]).toMatchObject({ errorText: 'Codex is not installed.' })
    conversation.close()
  })

  it('hands only missed canonical messages to a provider when switching back', async () => {
    const sessions = new Map<AgentProviderId, TestSession>()
    const conversation = new ProviderConversation({
      createSession: async options => {
        const session = new TestSession(options.providerId, options.modelId)
        sessions.set(options.providerId, session)
        options.onSessionId(`${options.providerId}-session`)
        return session
      },
      emit: () => undefined,
    })

    conversation.prompt({
      context: [{ content: 'First', id: 'u1', role: 'user' }],
      modelId: 'claude',
      providerId: 'anthropic',
      text: 'First',
      userMessageId: 'u1',
    })
    await tick()
    const anthropicAssistantId = sessions.get('anthropic')?.prompts[0]?.assistantMessageId
    expect(anthropicAssistantId).toBeTruthy()
    sessions.get('anthropic')?.complete('Claude answer')
    await tick()

    conversation.prompt({
      context: [
        { content: 'First', id: 'u1', role: 'user' },
        { content: 'Claude answer', id: anthropicAssistantId!, role: 'assistant' },
        { content: 'Second', id: 'u2', role: 'user' },
      ],
      modelId: 'codex',
      providerId: 'openai',
      text: 'Second',
      userMessageId: 'u2',
    })
    await tick()
    expect(sessions.get('openai')?.prompts[0]?.handoff).toEqual([
      { content: 'First', id: 'u1', role: 'user' },
      { content: 'Claude answer', id: anthropicAssistantId!, role: 'assistant' },
    ])
    const openaiAssistantId = sessions.get('openai')?.prompts[0]?.assistantMessageId
    expect(openaiAssistantId).toBeTruthy()
    sessions.get('openai')?.complete('Codex answer')
    await tick()

    conversation.prompt({
      context: [
        { content: 'First', id: 'u1', role: 'user' },
        { content: 'Claude answer', id: anthropicAssistantId!, role: 'assistant' },
        { content: 'Second', id: 'u2', role: 'user' },
        { content: 'Codex answer', id: openaiAssistantId!, role: 'assistant' },
        { content: 'Third', id: 'u3', role: 'user' },
      ],
      modelId: 'claude',
      providerId: 'anthropic',
      text: 'Third',
      userMessageId: 'u3',
    })
    await tick()
    expect(sessions.get('anthropic')?.prompts[0]?.handoff).toEqual([
      { content: 'Second', id: 'u2', role: 'user' },
      { content: 'Codex answer', id: openaiAssistantId!, role: 'assistant' },
    ])
    conversation.close()
  })

  it('pins a running generation even when the picker changes', async () => {
    const sessions = new Map<AgentProviderId, TestSession>()
    const conversation = new ProviderConversation({
      createSession: async options => {
        const session = new TestSession(options.providerId, options.modelId)
        sessions.set(options.providerId, session)
        return session
      },
      emit: () => undefined,
    })

    conversation.prompt({
      context: [{ content: 'First', id: 'u1', role: 'user' }],
      modelId: 'claude',
      providerId: 'anthropic',
      text: 'First',
      userMessageId: 'u1',
    })
    await tick()
    conversation.prompt({
      context: [
        { content: 'First', id: 'u1', role: 'user' },
        { content: 'Steer', id: 'u2', role: 'user' },
      ],
      modelId: 'codex',
      providerId: 'openai',
      text: 'Steer',
      userMessageId: 'u2',
    })
    await tick()
    expect(sessions.has('openai')).toBe(false)
    expect(sessions.get('anthropic')?.prompts.map(prompt => prompt.text)).toEqual([
      'First',
      'Steer',
    ])
    conversation.close()
  })
})
