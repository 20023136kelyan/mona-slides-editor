import { describe, expect, it } from 'vitest'

import { AgentStreamTranslator } from './agent-sdk-stream.js'

/** A `stream_event` carrying one raw Anthropic streaming event. */
const streamEvent = (event: unknown) => ({
  event,
  parent_tool_use_id: null,
  session_id: 'session-1',
  type: 'stream_event' as const,
  uuid: 'msg-1',
}) as never

const toolResult = (content: unknown, isError = false) => ({
  message: {
    content: [{ content, is_error: isError, tool_use_id: 'call-1', type: 'tool_result' }],
    role: 'user',
  },
  parent_tool_use_id: null,
  session_id: 'session-1',
  type: 'user' as const,
}) as never

const result = (subtype: string, detail?: string) => ({
  result: detail,
  session_id: 'session-1',
  subtype,
  type: 'result' as const,
}) as never

const translateAll = (translator: AgentStreamTranslator, messages: unknown[]) =>
  messages.flatMap(message => translator.translate(message as never))

describe('agent SDK stream translation', () => {
  it('opens the stream once, however many messages arrive', () => {
    const translator = new AgentStreamTranslator()
    const chunks = translateAll(translator, [
      streamEvent({ content_block: { type: 'text' }, index: 0, type: 'content_block_start' }),
      streamEvent({ delta: { text: 'hi', type: 'text_delta' }, index: 0, type: 'content_block_delta' }),
    ])

    expect(chunks.filter(chunk => chunk.type === 'start')).toHaveLength(1)
    expect(chunks[0]).toEqual({ type: 'start' })
  })

  it('turns a text block into start, deltas and end with one stable id', () => {
    const translator = new AgentStreamTranslator()
    const chunks = translateAll(translator, [
      streamEvent({ content_block: { type: 'text' }, index: 0, type: 'content_block_start' }),
      streamEvent({ delta: { text: 'Hello ', type: 'text_delta' }, index: 0, type: 'content_block_delta' }),
      streamEvent({ delta: { text: 'there', type: 'text_delta' }, index: 0, type: 'content_block_delta' }),
      streamEvent({ index: 0, type: 'content_block_stop' }),
    ])

    expect(chunks.slice(1)).toEqual([
      { id: 'msg-1-0', type: 'text-start' },
      { delta: 'Hello ', id: 'msg-1-0', type: 'text-delta' },
      { delta: 'there', id: 'msg-1-0', type: 'text-delta' },
      { id: 'msg-1-0', type: 'text-end' },
    ])
  })

  it('maps a thinking block onto reasoning chunks, not text', () => {
    const translator = new AgentStreamTranslator()
    const chunks = translateAll(translator, [
      streamEvent({ content_block: { type: 'thinking' }, index: 0, type: 'content_block_start' }),
      streamEvent({ delta: { thinking: 'weighing it', type: 'thinking_delta' }, index: 0, type: 'content_block_delta' }),
      streamEvent({ index: 0, type: 'content_block_stop' }),
    ])

    expect(chunks.slice(1)).toEqual([
      { id: 'msg-1-0', type: 'reasoning-start' },
      { delta: 'weighing it', id: 'msg-1-0', type: 'reasoning-delta' },
      { id: 'msg-1-0', type: 'reasoning-end' },
    ])
  })

  it('keeps concurrent blocks apart by index', () => {
    const translator = new AgentStreamTranslator()
    const chunks = translateAll(translator, [
      streamEvent({ content_block: { type: 'thinking' }, index: 0, type: 'content_block_start' }),
      streamEvent({ content_block: { type: 'text' }, index: 1, type: 'content_block_start' }),
      streamEvent({ delta: { text: 'answer', type: 'text_delta' }, index: 1, type: 'content_block_delta' }),
      streamEvent({ delta: { thinking: 'hmm', type: 'thinking_delta' }, index: 0, type: 'content_block_delta' }),
    ])

    expect(chunks.slice(1)).toEqual([
      { id: 'msg-1-0', type: 'reasoning-start' },
      { id: 'msg-1-1', type: 'text-start' },
      { delta: 'answer', id: 'msg-1-1', type: 'text-delta' },
      { delta: 'hmm', id: 'msg-1-0', type: 'reasoning-delta' },
    ])
  })

  it('reports a tool call under its plain name, not the MCP path', () => {
    const translator = new AgentStreamTranslator()
    const chunks = translateAll(translator, [
      streamEvent({
        content_block: { id: 'call-1', name: 'mcp__mona__look', type: 'tool_use' },
        index: 0,
        type: 'content_block_start',
      }),
      streamEvent({
        delta: { partial_json: '{"slideIds"', type: 'input_json_delta' },
        index: 0,
        type: 'content_block_delta',
      }),
    ])

    expect(chunks.slice(1)).toEqual([
      { toolCallId: 'call-1', toolName: 'look', type: 'tool-input-start' },
      { inputTextDelta: '{"slideIds"', toolCallId: 'call-1', type: 'tool-input-delta' },
    ])
  })

  it('does not end a tool part when its input stops streaming', () => {
    const translator = new AgentStreamTranslator()
    const chunks = translateAll(translator, [
      streamEvent({
        content_block: { id: 'call-1', name: 'mcp__mona__look', type: 'tool_use' },
        index: 0,
        type: 'content_block_start',
      }),
      streamEvent({ index: 0, type: 'content_block_stop' }),
    ])

    // The row stays running until the result arrives, which is a later message.
    expect(chunks.slice(1)).toEqual([
      { toolCallId: 'call-1', toolName: 'look', type: 'tool-input-start' },
    ])
  })

  it('settles a tool call when its result arrives', () => {
    const translator = new AgentStreamTranslator()
    const chunks = translateAll(translator, [toolResult([{ text: 'Slide 1:', type: 'text' }])])

    expect(chunks.slice(1)).toEqual([
      { output: 'Slide 1:', toolCallId: 'call-1', type: 'tool-output-available' },
    ])
  })

  it('keeps base64 images out of the transcript', () => {
    const translator = new AgentStreamTranslator()
    const chunks = translateAll(translator, [
      toolResult([
        { text: 'Slide 1:', type: 'text' },
        { data: 'iVBORw0KGgoAAAANSUhEUg', mimeType: 'image/png', type: 'image' },
      ]),
    ])

    expect(chunks.slice(1)).toEqual([
      { output: 'Slide 1:\n[image]', toolCallId: 'call-1', type: 'tool-output-available' },
    ])
  })

  it('surfaces a failed tool as an error on that call', () => {
    const translator = new AgentStreamTranslator()
    const chunks = translateAll(translator, [
      toolResult([{ text: 'boom is not defined', type: 'text' }], true),
    ])

    expect(chunks.slice(1)).toEqual([
      { errorText: 'boom is not defined', toolCallId: 'call-1', type: 'tool-output-error' },
    ])
  })

  it('finishes cleanly on success', () => {
    const translator = new AgentStreamTranslator()
    expect(translateAll(translator, [result('success')]).slice(1)).toEqual([{ type: 'finish' }])
  })

  it('surfaces a failure that arrives labelled success', () => {
    // Observed live: an expired login returns subtype 'success' with
    // is_error true. Trusting the subtype swallowed the whole failure.
    const translator = new AgentStreamTranslator()
    const chunks = translateAll(translator, [{
      is_error: true,
      result: 'Failed to authenticate: OAuth session expired and could not be refreshed',
      session_id: 'session-1',
      subtype: 'success',
      type: 'result',
    }]).slice(1)

    expect(chunks).toEqual([
      {
        errorText: 'Failed to authenticate: OAuth session expired and could not be refreshed',
        type: 'error',
      },
      { type: 'finish' },
    ])
  })

  it('reports why the agent stopped, then finishes', () => {
    const translator = new AgentStreamTranslator()
    const chunks = translateAll(translator, [result('error_max_turns')]).slice(1)

    expect(chunks).toEqual([
      { errorText: 'The agent stopped: error_max_turns', type: 'error' },
      { type: 'finish' },
    ])
  })

  it('renders a completed assistant message when nothing streamed', () => {
    // Observed live: a turn can finish having emitted no stream_event at all,
    // and then this is the only copy of the text.
    const translator = new AgentStreamTranslator()
    const chunks = translateAll(translator, [{
      message: {
        content: [
          { thinking: 'thinking it through', type: 'thinking' },
          { text: 'pineapple', type: 'text' },
          { id: 'call-1', input: { slideIds: ['s1'] }, name: 'mcp__mona__look', type: 'tool_use' },
        ],
        role: 'assistant',
      },
      parent_tool_use_id: null,
      session_id: 'session-1',
      type: 'assistant',
      uuid: 'msg-9',
    }]).slice(1)

    expect(chunks).toEqual([
      { id: 'msg-9-0', type: 'reasoning-start' },
      { delta: 'thinking it through', id: 'msg-9-0', type: 'reasoning-delta' },
      { id: 'msg-9-0', type: 'reasoning-end' },
      { id: 'msg-9-1', type: 'text-start' },
      { delta: 'pineapple', id: 'msg-9-1', type: 'text-delta' },
      { id: 'msg-9-1', type: 'text-end' },
      {
        input: { slideIds: ['s1'] },
        toolCallId: 'call-1',
        toolName: 'look',
        type: 'tool-input-available',
      },
    ])
  })

  it('does not render text twice when partials did stream', () => {
    const translator = new AgentStreamTranslator()
    const chunks = translateAll(translator, [
      streamEvent({ content_block: { type: 'text' }, index: 0, type: 'content_block_start' }),
      streamEvent({ delta: { text: 'pineapple', type: 'text_delta' }, index: 0, type: 'content_block_delta' }),
      streamEvent({ index: 0, type: 'content_block_stop' }),
      {
        message: { content: [{ text: 'pineapple', type: 'text' }], role: 'assistant' },
        parent_tool_use_id: null,
        session_id: 'session-1',
        type: 'assistant',
        uuid: 'msg-9',
      },
    ]).slice(1)

    // The completed message is the partials' duplicate, so it adds nothing.
    expect(chunks.filter(chunk => chunk.type === 'text-delta')).toEqual([
      { delta: 'pineapple', id: 'msg-1-0', type: 'text-delta' },
    ])
  })

  it('ignores SDK messages the dock has no use for', () => {
    const translator = new AgentStreamTranslator()
    const chunks = translateAll(translator, [
      { session_id: 's', subtype: 'init', type: 'system' },
      { session_id: 's', type: 'status' },
    ])

    // Only the stream opener - nothing else is invented.
    expect(chunks).toEqual([{ type: 'start' }])
  })
})
