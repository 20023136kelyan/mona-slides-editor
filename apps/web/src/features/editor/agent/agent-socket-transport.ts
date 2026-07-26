import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai'

import { runClientTool } from '@/features/editor/agent/agent-tools-client'
import type { EditorRuntime } from '@/features/editor/editor-runtime'

const SOCKET_PATH = '/api/agent/chat/ws'

/** Sent by the server. */
interface ServerFrame {
  chunk?: UIMessageChunk
  id?: string
  input?: unknown
  name?: string
  type?: string
}

const socketUrl = (): string => {
  const { host, protocol } = window.location
  return `${protocol === 'https:' ? 'wss:' : 'ws:'}//${host}${SOCKET_PATH}`
}

/**
 * The agent conversation, carried over a socket instead of a POST.
 *
 * The Agent SDK owns the loop on the server, which means our tool handlers run
 * there while the deck lives here - so the connection has to stay open in both
 * directions for a turn: chunks come down, and tool results go back up.
 *
 * Everything above this is unchanged. `useChat` still receives the same chunk
 * vocabulary it always did, so the renderer, smooth text and tool rows do not
 * know the harness moved.
 */
export class AgentSocketTransport implements ChatTransport<UIMessage> {
  readonly #effort: () => string | undefined
  readonly #model: () => string
  readonly #runtime: EditorRuntime
  #socket?: WebSocket

  constructor({ effort, model, runtime }: {
    effort: () => string | undefined
    model: () => string
    runtime: EditorRuntime
  }) {
    this.#effort = effort
    this.#model = model
    this.#runtime = runtime
  }

  async sendMessages({
    abortSignal,
    messages,
  }: {
    abortSignal: AbortSignal | undefined
    messages: UIMessage[]
  }): Promise<ReadableStream<UIMessageChunk>> {
    const socket = await this.#connect()
    const prompt = lastUserText(messages)
    if (!prompt) throw new Error('There is nothing to send.')

    // Steering: a prompt sent mid-turn is queued onto the same conversation on
    // the server rather than opening a second one.
    abortSignal?.addEventListener('abort', () => send(socket, { type: 'interrupt' }))

    return new ReadableStream<UIMessageChunk>({
      start: controller => {
        // A turn ends with a finish chunk. Anything else that ends the stream is
        // an interruption the reader needs told about.
        let finished = false
        const onMessage = (event: MessageEvent) => {
          const frame = parseFrame(event.data)
          if (!frame) return
          if (frame.type === 'tool-request') {
            void this.#fulfil(socket, frame)
            return
          }
          if (frame.type !== 'chunk' || !frame.chunk) return
          controller.enqueue(frame.chunk)
          if (frame.chunk.type === 'finish') {
            finished = true
            socket.removeEventListener('message', onMessage)
            controller.close()
          }
        }
        socket.addEventListener('message', onMessage)
        socket.addEventListener('close', () => {
          socket.removeEventListener('message', onMessage)
          // close() after close() throws; the stream may already be done.
          try {
            if (!finished) {
              // Closing cleanly here reported a dropped connection as a
              // completed turn: the reply simply stopped, with nothing to
              // explain it. In development the agent server restarts on every
              // change, so this was the common case rather than the rare one.
              controller.enqueue({
                errorText: 'The connection to the agent dropped before it finished.',
                type: 'error',
              })
            }
            controller.close()
          }
          catch {
            // Already closed by a finish chunk.
          }
        }, { once: true })
        send(socket, {
          effort: this.#effort(),
          model: this.#model(),
          text: prompt,
          type: 'prompt',
        })
      },
    })
  }

  /** Nothing is replayable yet: a dropped socket ends the turn. */
  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null
  }

  /**
   * Runs a tool the server asked for, against the live deck.
   *
   * A failure is reported rather than thrown: the agent loop on the server is
   * blocked on this answer, and it can recover from a tool that failed far
   * better than from one that never replied.
   */
  async #fulfil(socket: WebSocket, frame: ServerFrame): Promise<void> {
    if (typeof frame.id !== 'string' || typeof frame.name !== 'string') return
    try {
      const output = await runClientTool(frame.name as never, frame.input as never, this.#runtime)
      send(socket, { id: frame.id, output, type: 'tool-result' })
    }
    catch (error) {
      send(socket, {
        errorText: error instanceof Error ? error.message : 'The tool failed.',
        id: frame.id,
        type: 'tool-result',
      })
    }
  }

  async #connect(): Promise<WebSocket> {
    const existing = this.#socket
    if (existing && existing.readyState === WebSocket.OPEN) return existing
    const socket = new WebSocket(socketUrl())
    this.#socket = socket
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true })
      socket.addEventListener('error', () => reject(new Error('Could not reach the agent.')), { once: true })
    })
    return socket
  }

  close(): void {
    this.#socket?.close()
    this.#socket = undefined
  }
}

const send = (socket: WebSocket, frame: Record<string, unknown>): void => {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame))
}

const parseFrame = (data: unknown): ServerFrame | undefined => {
  try {
    const parsed = JSON.parse(String(data)) as unknown
    return parsed && typeof parsed === 'object' ? parsed as ServerFrame : undefined
  }
  catch {
    return undefined
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
