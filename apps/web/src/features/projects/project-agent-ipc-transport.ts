import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai'

import { monaBridge } from '@/lib/mona-bridge'

export class ProjectAgentIpcTransport implements ChatTransport<UIMessage> {
  readonly #effort: () => string | undefined
  readonly #model: () => string
  readonly #projectId: string

  constructor({
    effort,
    model,
    projectId,
  }: {
    effort: () => string | undefined
    model: () => string
    projectId: string
  }) {
    this.#effort = effort
    this.#model = model
    this.#projectId = projectId
  }

  async sendMessages({
    abortSignal,
    messages,
  }: {
    abortSignal: AbortSignal | undefined
    messages: UIMessage[]
  }): Promise<ReadableStream<UIMessageChunk>> {
    const text = lastUserText(messages)
    if (!text) throw new Error('There is nothing to send.')
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
          effort: this.#effort(),
          model: this.#model(),
          projectId: this.#projectId,
          text,
        })
      },
    })
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null
  }
}

const lastUserText = (messages: UIMessage[]): string => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'user') continue
    return message.parts
      .filter(part => part.type === 'text')
      .map(part => (part as { text: string }).text)
      .join('\n')
      .trim()
  }
  return ''
}
