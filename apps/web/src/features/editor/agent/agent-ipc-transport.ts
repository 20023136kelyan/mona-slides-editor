import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai'
import type { AgentProviderId } from '@mona/agent-protocol'

import {
  agentContextFromUiMessages,
  newestUserMessage,
} from '@/features/agent/agent-context'
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
  #effort?: string
  #model: string
  #providerId: AgentProviderId
  readonly #runtime: EditorRuntime
  /** Detaches the tool listener when the dock unmounts. */
  #stopTools?: () => void

  constructor({ effort, model, providerId, runtime }: {
    effort?: string
    model: string
    providerId: AgentProviderId
    runtime: EditorRuntime
  }) {
    this.#effort = effort
    this.#model = model
    this.#providerId = providerId
    this.#runtime = runtime
  }

  /**
   * Mount the renderer-side tool bridge.
   *
   * Kept out of the constructor because React development mode deliberately
   * replays effect setup/cleanup. `open` is idempotent, so the second setup
   * correctly reattaches after the replay cleanup instead of leaving the agent
   * waiting forever on a tool result.
   */
  open(): void {
    this.#stopTools ??= monaBridge().agent.onToolRequest(request => void this.#fulfil(request))
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
    this.open()
    const user = newestUserMessage(messages)
    if (!user) throw new Error('There is nothing to send.')

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
        bridge.agent.send({
          context: agentContextFromUiMessages(messages),
          effort: this.#effort,
          model: this.#model,
          providerId: this.#providerId,
          text: user.text,
          userMessageId: user.id,
        })
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
