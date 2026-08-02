import { randomUUID } from 'node:crypto'
import type { UIMessageChunk } from 'ai'

import {
  agentContextAfter,
  type AgentContextMessage,
  type AgentProviderId,
  type AgentProviderSessionBinding,
} from '@mona/agent-protocol'

import type { ProviderSession } from './provider-session.js'

export interface ProviderConversationPrompt {
  context: AgentContextMessage[]
  effort?: string
  modelId: string
  providerId: AgentProviderId
  text: string
  userMessageId: string
}

export interface ProviderSessionFactoryOptions {
  binding?: AgentProviderSessionBinding
  effort?: string
  modelId: string
  onSessionId: (sessionId: string) => void
  providerId: AgentProviderId
}

interface ConversationTurn {
  assistantMessageId: string
  content: string
  interrupted: boolean
  providerId: AgentProviderId
  sawError: boolean
  userMessageId: string
}

/**
 * Routes one canonical conversation through independent provider-native threads.
 * A provider choice is sampled between turns and remains pinned while generating.
 */
export class ProviderConversation {
  readonly #bindings = new Map<AgentProviderId, AgentProviderSessionBinding>()
  readonly #createSession: (
    options: ProviderSessionFactoryOptions,
  ) => Promise<ProviderSession>
  readonly #cursors = new Map<AgentProviderId, string>()
  readonly #emit: (chunk: UIMessageChunk) => void
  readonly #onAssistant?: (message: {
    content: string
    id: string
    status: 'complete' | 'error' | 'interrupted'
  }) => Promise<void>
  readonly #onBinding?: (
    providerId: AgentProviderId,
    binding: AgentProviderSessionBinding,
  ) => Promise<void>
  readonly #sessions = new Map<AgentProviderId, ProviderSession>()
  #active?: ConversationTurn
  #closed = false
  #promptTail = Promise.resolve()

  constructor(options: {
    createSession: (
      options: ProviderSessionFactoryOptions,
    ) => Promise<ProviderSession>
    emit: (chunk: UIMessageChunk) => void
    onAssistant?: (message: {
      content: string
      id: string
      status: 'complete' | 'error' | 'interrupted'
    }) => Promise<void>
    onBinding?: (
      providerId: AgentProviderId,
      binding: AgentProviderSessionBinding,
    ) => Promise<void>
  }) {
    this.#createSession = options.createSession
    this.#emit = options.emit
    this.#onAssistant = options.onAssistant
    this.#onBinding = options.onBinding
  }

  hydrate(bindings: Partial<Record<AgentProviderId, AgentProviderSessionBinding>> | undefined): void {
    for (const providerId of ['anthropic', 'openai'] as const) {
      const binding = bindings?.[providerId]
      if (!binding || this.#bindings.has(providerId)) continue
      this.#bindings.set(providerId, binding)
      if (binding.synchronizedThroughMessageId) {
        this.#cursors.set(providerId, binding.synchronizedThroughMessageId)
      }
    }
  }

  prompt(
    prompt: ProviderConversationPrompt,
    transformText: (text: string) => string = text => text,
  ): void {
    const operation = async () => {
      try {
        await this.#prompt(prompt, transformText)
      }
      catch (error) {
        const turn = this.#active
        if (!turn) {
          this.#emit({ messageId: randomUUID(), type: 'start' })
        }
        else turn.sawError = true
        this.#emit({
          errorText: error instanceof Error ? error.message : 'The agent could not start.',
          type: 'error',
        })
        this.#emit({ type: 'finish' })
        if (turn) await this.#finish(turn)
      }
    }
    this.#promptTail = this.#promptTail.then(operation, operation)
  }

  async interrupt(): Promise<void> {
    if (!this.#active) return
    this.#active.interrupted = true
    await this.#sessions.get(this.#active.providerId)?.interrupt()
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    for (const session of this.#sessions.values()) session.close()
    this.#sessions.clear()
  }

  async #prompt(
    prompt: ProviderConversationPrompt,
    transformText: (text: string) => string,
  ): Promise<void> {
    if (this.#closed) return
    const providerId = this.#active?.providerId ?? prompt.providerId
    if (!this.#active) {
      // Only one provider process stays mounted. A switch resumes the provider's
      // native thread in a fresh document workspace, so it cannot act on the
      // stale snapshot it held before the other provider edited the document.
      for (const [mountedProvider, mountedSession] of this.#sessions) {
        if (mountedProvider === providerId) continue
        this.#sessions.delete(mountedProvider)
        mountedSession.close()
      }
    }
    let session = this.#sessions.get(providerId)
    const requestedModel = this.#active ? session?.modelId ?? prompt.modelId : prompt.modelId
    if (session && !this.#active && session.modelId !== requestedModel) {
      session.close()
      this.#sessions.delete(providerId)
      this.#bindings.delete(providerId)
      this.#cursors.delete(providerId)
      session = undefined
    }
    if (!session) session = await this.#startSession(providerId, requestedModel, prompt.effort)

    const userIndex = prompt.context.findIndex(message => message.id === prompt.userMessageId)
    const prior = userIndex < 0 ? prompt.context : prompt.context.slice(0, userIndex)
    const handoff = this.#active
      ? []
      : agentContextAfter(prior, this.#cursors.get(providerId))
    const assistantMessageId = this.#active?.assistantMessageId ?? randomUUID()
    if (!this.#active) {
      this.#active = {
        assistantMessageId,
        content: '',
        interrupted: false,
        providerId,
        sawError: false,
        userMessageId: prompt.userMessageId,
      }
    }
    session.send({
      assistantMessageId,
      handoff,
      text: transformText(prompt.text),
      userMessageId: prompt.userMessageId,
    })
  }

  async #startSession(
    providerId: AgentProviderId,
    modelId: string,
    effort?: string,
  ): Promise<ProviderSession> {
    const candidate = this.#bindings.get(providerId)
    const binding = candidate?.modelId === modelId ? candidate : undefined
    if (!binding) {
      this.#bindings.delete(providerId)
      this.#cursors.delete(providerId)
    }
    const session = await this.#createSession({
      ...(binding ? { binding } : {}),
      ...(effort ? { effort } : {}),
      modelId,
      onSessionId: sessionId => {
        const cursor = this.#cursors.get(providerId)
        const current: AgentProviderSessionBinding = {
          modelId,
          sessionId,
          ...(cursor ? { synchronizedThroughMessageId: cursor } : {}),
        }
        this.#bindings.set(providerId, current)
        void this.#onBinding?.(providerId, current).catch(() => undefined)
      },
      providerId,
    })
    this.#sessions.set(providerId, session)
    void this.#pump(providerId, session)
    return session
  }

  async #pump(providerId: AgentProviderId, session: ProviderSession): Promise<void> {
    try {
      for await (const chunk of session.run()) {
        if (this.#sessions.get(providerId) !== session) return
        const turn = this.#active
        if (turn?.providerId === providerId) {
          if (chunk.type === 'text-delta') turn.content += chunk.delta
          if (chunk.type === 'error') turn.sawError = true
        }
        this.#emit(chunk)
        if (chunk.type === 'finish' && turn?.providerId === providerId) {
          await this.#finish(turn)
        }
      }
    }
    catch (error) {
      if (this.#sessions.get(providerId) !== session) return
      this.#emit({
        errorText: error instanceof Error ? error.message : 'The agent failed.',
        type: 'error',
      })
      this.#emit({ type: 'finish' })
      if (this.#active?.providerId === providerId) {
        this.#active.sawError = true
        await this.#finish(this.#active)
      }
    }
    finally {
      if (this.#sessions.get(providerId) === session) {
        this.#sessions.delete(providerId)
        session.close()
      }
    }
  }

  async #finish(turn: ConversationTurn): Promise<void> {
    if (this.#active !== turn) return
    this.#active = undefined
    const content = turn.content.trim()
    const cursor = content ? turn.assistantMessageId : turn.userMessageId
    this.#cursors.set(turn.providerId, cursor)
    const binding = this.#bindings.get(turn.providerId)
    if (binding) {
      const updated = { ...binding, synchronizedThroughMessageId: cursor }
      this.#bindings.set(turn.providerId, updated)
      await this.#onBinding?.(turn.providerId, updated).catch(() => undefined)
    }
    if (content) {
      await this.#onAssistant?.({
        content,
        id: turn.assistantMessageId,
        status: turn.sawError
          ? 'error'
          : turn.interrupted ? 'interrupted' : 'complete',
      }).catch(() => undefined)
    }
  }
}
