import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { UIMessageChunk } from 'ai'

/**
 * Agent SDK messages, rendered as the chunks the editor already knows.
 *
 * The dock's renderer is built on the AI SDK's UI message parts, and it works.
 * Rather than teach it a second vocabulary, this translates: the SDK's partial
 * events carry raw Anthropic stream deltas, which map onto text, reasoning and
 * tool chunks almost one for one.
 *
 * Pure on purpose - one message in, the chunks it becomes out - so the mapping
 * is testable without a model, a subprocess or a socket.
 */

/** Anthropic's streaming events, as much of their shape as we consume. */
interface RawStreamEvent {
  content_block?: {
    id?: string
    name?: string
    type?: string
  }
  delta?: {
    partial_json?: string
    stop_reason?: string | null
    text?: string
    thinking?: string
    type?: string
  }
  index?: number
  type?: string
}

/** What a content block at a given index turned out to be. */
type BlockKind = 'reasoning' | 'text' | 'tool'

/**
 * Anthropic identifies a block by its index within one message; the UI stream
 * identifies text and reasoning parts by an id. This holds the translation
 * between them for the life of a turn, because a delta only carries the index.
 */
export class AgentStreamTranslator {
  readonly #kinds = new Map<number, BlockKind>()
  readonly #partIds = new Map<number, string>()
  readonly #toolNames = new Map<string, string>()
  #sawPartials = false
  #started = false
  #toolCallIds = new Map<number, string>()

  /** Begin one visible assistant reply with the renderer's durable identity. */
  startTurn(messageId?: string): UIMessageChunk {
    this.#resetTurn()
    this.#started = true
    return { ...(messageId ? { messageId } : {}), type: 'start' }
  }

  /** The chunks one SDK message becomes. */
  translate(message: SDKMessage): UIMessageChunk[] {
    const chunks: UIMessageChunk[] = []
    if (!this.#started) {
      this.#started = true
      chunks.push({ type: 'start' })
    }
    switch (message.type) {
      case 'stream_event':
        this.#sawPartials = true
        chunks.push(...this.#streamEvent(message.event as RawStreamEvent, message.uuid))
        break
      case 'assistant':
        chunks.push(...this.#completeAssistant(message))
        break
      case 'user':
        chunks.push(...this.#toolResults(message))
        break
      case 'result':
        chunks.push(...this.#result(message))
        break
      default:
        break
    }
    return chunks
  }

  #streamEvent(event: RawStreamEvent, uuid: string): UIMessageChunk[] {
    const index = event.index ?? 0
    switch (event.type) {
      case 'content_block_start': {
        const blockType = event.content_block?.type
        if (blockType === 'tool_use') {
          const toolCallId = event.content_block?.id ?? `${uuid}-${index}`
          const toolName = stripMonaPrefix(event.content_block?.name ?? 'tool')
          this.#kinds.set(index, 'tool')
          this.#toolCallIds.set(index, toolCallId)
          this.#toolNames.set(toolCallId, toolName)
          return [{ toolCallId, toolName, type: 'tool-input-start' }]
        }
        const kind: BlockKind = blockType === 'thinking' ? 'reasoning' : 'text'
        const id = `${uuid}-${index}`
        this.#kinds.set(index, kind)
        this.#partIds.set(index, id)
        return [{ id, type: kind === 'reasoning' ? 'reasoning-start' : 'text-start' }]
      }

      case 'content_block_delta': {
        const kind = this.#kinds.get(index)
        if (kind === 'tool') {
          const toolCallId = this.#toolCallIds.get(index)
          const partial = event.delta?.partial_json
          if (!toolCallId || partial === undefined) return []
          return [{ inputTextDelta: partial, toolCallId, type: 'tool-input-delta' }]
        }
        const id = this.#partIds.get(index)
        if (!id) return []
        if (kind === 'reasoning') {
          const thinking = event.delta?.thinking
          return thinking ? [{ delta: thinking, id, type: 'reasoning-delta' }] : []
        }
        const text = event.delta?.text
        return text ? [{ delta: text, id, type: 'text-delta' }] : []
      }

      case 'content_block_stop': {
        const kind = this.#kinds.get(index)
        // A tool call is not finished by its input ending - it ends when the
        // result arrives, which is a separate message entirely.
        if (kind === 'tool') return []
        const id = this.#partIds.get(index)
        if (!id) return []
        this.#partIds.delete(index)
        this.#kinds.delete(index)
        return [{ id, type: kind === 'reasoning' ? 'reasoning-end' : 'text-end' }]
      }

      default:
        return []
    }
  }

  /**
   * A finished assistant message, rendered when nothing streamed.
   *
   * Partial events are requested but not guaranteed - a turn can complete
   * without emitting any, and then the only copy of the text is here. Skipped
   * once partials have been seen, because this message is their duplicate.
   */
  #completeAssistant(message: Extract<SDKMessage, { type: 'assistant' }>): UIMessageChunk[] {
    if (this.#sawPartials) return []
    const content = (message.message as { content?: unknown })?.content
    if (!Array.isArray(content)) return []
    const chunks: UIMessageChunk[] = []
    content.forEach((block, index) => {
      const part = block as {
        id?: string
        input?: unknown
        name?: string
        text?: string
        thinking?: string
        type?: string
      }
      const id = `${message.uuid}-${index}`
      if (part.type === 'text' && part.text) {
        chunks.push(
          { id, type: 'text-start' },
          { delta: part.text, id, type: 'text-delta' },
          { id, type: 'text-end' },
        )
        return
      }
      if (part.type === 'thinking' && part.thinking) {
        chunks.push(
          { id, type: 'reasoning-start' },
          { delta: part.thinking, id, type: 'reasoning-delta' },
          { id, type: 'reasoning-end' },
        )
        return
      }
      if (part.type === 'tool_use' && part.id) {
        const toolName = stripMonaPrefix(part.name ?? 'tool')
        this.#toolNames.set(part.id, toolName)
        chunks.push({
          input: part.input ?? {},
          toolCallId: part.id,
          toolName,
          type: 'tool-input-available',
        })
      }
    })
    return chunks
  }

  /**
   * Tool results arrive as a synthetic user message holding `tool_result`
   * blocks, which is how the SDK reports what a tool returned.
   */
  #toolResults(message: Extract<SDKMessage, { type: 'user' }>): UIMessageChunk[] {
    const content = (message.message as { content?: unknown })?.content
    if (!Array.isArray(content)) return []
    const chunks: UIMessageChunk[] = []
    for (const block of content) {
      const part = block as {
        content?: unknown
        is_error?: boolean
        tool_use_id?: string
        type?: string
      }
      if (part.type !== 'tool_result' || !part.tool_use_id) continue
      if (part.is_error) {
        chunks.push({
          errorText: readErrorText(part.content),
          toolCallId: part.tool_use_id,
          type: 'tool-output-error',
        })
        continue
      }
      chunks.push({
        // The renderer only needs to know the call succeeded; the model has
        // already been given the real content, images included.
        output: summariseOutput(part.content),
        toolCallId: part.tool_use_id,
        type: 'tool-output-available',
      })
    }
    return chunks
  }

  /**
   * `subtype` alone is not enough to know a turn succeeded.
   *
   * An expired login comes back as `subtype: 'success'` with `is_error: true`
   * and the reason in `result`. Trusting the subtype reported a clean finish and
   * swallowed the authentication failure entirely, leaving an empty reply and no
   * explanation, so both signals are checked.
   */
  #result(message: Extract<SDKMessage, { type: 'result' }>): UIMessageChunk[] {
    const failed = message.subtype !== 'success' || (message as { is_error?: boolean }).is_error === true
    const chunks: UIMessageChunk[] = !failed ? [{ type: 'finish' }] : [
      { errorText: readResultError(message), type: 'error' },
      { type: 'finish' },
    ]
    this.#resetTurn()
    return chunks
  }

  #resetTurn(): void {
    this.#kinds.clear()
    this.#partIds.clear()
    this.#toolNames.clear()
    this.#toolCallIds.clear()
    this.#sawPartials = false
    this.#started = false
  }
}

/** `mcp__mona__look` is an implementation detail; the dock shows `look`. */
const stripMonaPrefix = (name: string): string => name.replace(/^mcp__mona__/, '')

const readErrorText = (content: unknown): string => {
  const text = summariseOutput(content)
  return text || 'The tool failed.'
}

/**
 * A tool result as the dock displays it.
 *
 * Image blocks are deliberately reduced to a note rather than carried through:
 * the model already received the real image, and putting base64 into the UI
 * transcript would bloat every subsequent request for no visible gain.
 */
const summariseOutput = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map(block => {
      const part = block as { text?: string; type?: string }
      if (part.type === 'text') return part.text ?? ''
      if (part.type === 'image') return '[image]'
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

const readResultError = (message: Extract<SDKMessage, { type: 'result' }>): string => {
  // `result` carries the real reason - "OAuth session expired and could not be
  // refreshed" - which is far more use than the subtype.
  const detail = (message as { result?: unknown }).result
  if (typeof detail === 'string' && detail) return detail
  return `The agent stopped: ${message.subtype}`
}
