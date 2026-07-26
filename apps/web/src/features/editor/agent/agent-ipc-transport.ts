import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai'

import { runClientTool } from '@/features/editor/agent/agent-tools-client'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { monaBridge } from '@/lib/mona-bridge'

/**
 * The agent conversation, carried over IPC.
 *
 * Everything above this is unchanged: `useChat` still receives the same chunk
 * vocabulary, so the renderer, smooth text and tool rows do not know the transport
 * moved. What went with the WebSocket is the part that only existed because the
 * editor was a web page — a URL derived from `window.location`, JSON framing, a
 * frame-size cap, and a connection that could drop mid-turn.
 *
 * That last one is worth naming: a socket could close between chunks, so the old
 * transport had to detect a stream that ended without a `finish` and report it as an
 * interruption. IPC to your own main process has no such state.
 */
export class AgentIpcTransport implements ChatTransport<UIMessage> {
  readonly #effort: () => string | undefined
  readonly #model: () => string
  readonly #runtime: EditorRuntime
  /** Detaches the tool listener when the dock unmounts. */
  #stopTools?: () => void

  constructor({ effort, model, runtime }: {
    effort: () => string | undefined
    model: () => string
    runtime: EditorRuntime
  }) {
    this.#effort = effort
    this.#model = model
    this.#runtime = runtime
    this.#stopTools = monaBridge().agent.onToolRequest(request => void this.#fulfil(request))
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
    // Steering: a prompt sent mid-turn is queued onto the same conversation in the
    // main process rather than opening a second one.
    abortSignal?.addEventListener('abort', () => bridge.agent.interrupt())

    return new ReadableStream<UIMessageChunk>({
      start: controller => {
        const stop = bridge.agent.onChunk(value => {
          const chunk = value as UIMessageChunk
          controller.enqueue(chunk)
          if (chunk.type !== 'finish') return
          stop()
          controller.close()
        })
        bridge.agent.send({ effort: this.#effort(), model: this.#model(), text })
      },
    })
  }

  /** Nothing is replayable: a turn belongs to the window that started it. */
  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null
  }

  /**
   * Runs a tool the agent asked for, against the live deck.
   *
   * A failure is reported rather than thrown: the agent loop is blocked on this
   * answer, and it recovers from a tool that failed far better than from one that
   * never replied.
   */
  async #fulfil(request: { id: string; input: unknown; name: string }): Promise<void> {
    const bridge = monaBridge()
    try {
      const output = await runClientTool(request.name as never, request.input as never, this.#runtime)
      bridge.agent.respondTool(request.id, { output })
    }
    catch (error) {
      bridge.agent.respondTool(request.id, {
        errorText: error instanceof Error ? error.message : 'The tool failed.',
      })
    }
  }

  close(): void {
    this.#stopTools?.()
    this.#stopTools = undefined
  }
}

/** The text of the newest user message - what this turn is actually asking. */
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
