import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai'
import type { AgentProviderId } from '@mona/agent-protocol'

import {
  agentContextFromUiMessages,
  newestUserMessage,
} from '@/features/agent/agent-context'
import { monaBridge } from '@/lib/mona-bridge'

export class ProjectAgentIpcTransport implements ChatTransport<UIMessage> {
  #effort?: string
  #model: string
  #providerId: AgentProviderId
  readonly #projectId: string

  constructor({
    effort,
    model,
    providerId,
    projectId,
  }: {
    effort?: string
    model: string
    providerId: AgentProviderId
    projectId: string
  }) {
    this.#effort = effort
    this.#model = model
    this.#providerId = providerId
    this.#projectId = projectId
  }

  updateSelection(selection: {
    effort?: string
    model: string
    providerId: AgentProviderId
  }): void {
    this.#effort = selection.effort
    this.#model = selection.model
    this.#providerId = selection.providerId
  }

  async sendMessages({
    abortSignal,
    messages,
  }: {
    abortSignal: AbortSignal | undefined
    messages: UIMessage[]
  }): Promise<ReadableStream<UIMessageChunk>> {
    const user = newestUserMessage(messages)
    if (!user) throw new Error('There is nothing to send.')
    const bridge = monaBridge()
    abortSignal?.addEventListener(
      'abort',
      () => bridge.projectAgent.interrupt(this.#projectId),
      { once: true },
    )

    return new ReadableStream<UIMessageChunk>({
      start: controller => {
        const stop = bridge.projectAgent.onChunk(event => {
          if (event.projectId !== this.#projectId) return
          const chunk = event.chunk as UIMessageChunk
          controller.enqueue(chunk)
          if (chunk.type !== 'finish') return
          stop()
          controller.close()
        })
        bridge.projectAgent.send({
          context: agentContextFromUiMessages(messages),
          effort: this.#effort,
          model: this.#model,
          projectId: this.#projectId,
          providerId: this.#providerId,
          text: user.text,
          userMessageId: user.id,
        })
      },
    })
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null
  }
}
