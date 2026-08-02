import type { UIMessageChunk } from 'ai'

import { agentContextToResponsesItems } from '@mona/agent-protocol'

import { CodexAppServerClient, type CodexServerNotification } from './codex-app-server.js'
import type { AgentToolRuntime } from './agent-tool-runtime.js'
import type { ProviderSession, ProviderSessionPrompt } from './provider-session.js'

interface CodexThreadResponse {
  thread?: { id?: string }
}

interface CodexTurnResponse {
  turn?: { id?: string }
}

interface CodexTurn {
  error?: { message?: string } | null
  id?: string
  status?: string
}

interface CodexThreadItem {
  aggregatedOutput?: string | null
  arguments?: unknown
  changes?: unknown[]
  command?: string
  contentItems?: Array<{ text?: string; type?: string }> | null
  id?: string
  query?: string
  status?: string
  success?: boolean | null
  text?: string
  tool?: string
  type?: string
}

export interface CodexSessionOptions {
  effort?: string
  executablePath: string
  modelId: string
  onSessionId?: (sessionId: string) => void
  resumeSessionId?: string
  runtime: AgentToolRuntime
  systemInstruction: string
}

class AsyncQueue<Value> {
  #closed = false
  readonly #queued: Value[] = []
  #wake?: () => void

  push(value: Value): void {
    if (this.#closed) return
    this.#queued.push(value)
    this.#release()
  }

  close(): void {
    this.#closed = true
    this.#release()
  }

  async *stream(): AsyncGenerator<Value> {
    for (;;) {
      const value = this.#queued.shift()
      if (value !== undefined) {
        yield value
        continue
      }
      if (this.#closed) return
      await new Promise<void>(resolve => { this.#wake = resolve })
    }
  }

  #release(): void {
    const wake = this.#wake
    this.#wake = undefined
    wake?.()
  }
}

const deferred = <Value>() => {
  let resolve!: (value: Value) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Value>((accept, decline) => {
    resolve = accept
    reject = decline
  })
  return { promise, reject, resolve }
}

/**
 * One native Codex thread, translated into Mona's existing UI-message stream.
 *
 * Codex keeps its own compaction, tool loop and rollout. Mona adds only its
 * document workspace tools and a provider-neutral handoff before a resumed
 * provider's next turn.
 */
export class CodexSession implements ProviderSession {
  readonly modelId: string
  readonly providerId = 'openai' as const
  readonly #effort?: string
  readonly #executablePath: string
  readonly #modelId: string
  readonly #onSessionId?: (sessionId: string) => void
  readonly #output = new AsyncQueue<UIMessageChunk>()
  readonly #ready = deferred<void>()
  readonly #resumeSessionId?: string
  readonly #runtime: AgentToolRuntime
  readonly #systemInstruction: string
  #activeTurnId?: string
  #client?: CodexAppServerClient
  #closed = false
  #reasoningParts = new Set<string>()
  #sendTail = Promise.resolve()
  #stopNotification?: () => void
  #stopFailure?: () => void
  #stopServerRequest?: () => void
  #textParts = new Set<string>()
  #threadId?: string

  constructor(options: CodexSessionOptions) {
    this.#effort = options.effort
    this.#executablePath = options.executablePath
    this.#modelId = options.modelId
    this.modelId = options.modelId
    this.#onSessionId = options.onSessionId
    this.#resumeSessionId = options.resumeSessionId
    this.#runtime = options.runtime
    this.#systemInstruction = options.systemInstruction
  }

  async *run(): AsyncGenerator<UIMessageChunk> {
    try {
      await this.#start()
      this.#ready.resolve()
    }
    catch (error) {
      this.#ready.reject(error)
      this.#output.push({
        errorText: error instanceof Error ? error.message : 'Codex could not start.',
        type: 'error',
      })
      this.#output.push({ type: 'finish' })
    }
    yield* this.#output.stream()
  }

  send(prompt: ProviderSessionPrompt): void {
    if (!this.#activeTurnId) {
      this.#output.push({ messageId: prompt.assistantMessageId, type: 'start' })
    }
    const operation = async () => {
      try {
        await this.#ready.promise
        await this.#send(prompt)
      }
      catch (error) {
        this.#output.push({
          errorText: error instanceof Error ? error.message : 'Codex could not run this turn.',
          type: 'error',
        })
        this.#output.push({ type: 'finish' })
      }
    }
    this.#sendTail = this.#sendTail.then(operation, operation)
  }

  async interrupt(): Promise<void> {
    const client = this.#client
    const threadId = this.#threadId
    const turnId = this.#activeTurnId
    if (!client || !threadId || !turnId) return
    await client.request('turn/interrupt', { threadId, turnId })
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#stopNotification?.()
    this.#stopFailure?.()
    this.#stopServerRequest?.()
    this.#client?.close()
    this.#client = undefined
    this.#output.close()
    void this.#runtime.dispose().catch(() => undefined)
  }

  async #start(): Promise<void> {
    const client = await CodexAppServerClient.connect({ executablePath: this.#executablePath })
    if (this.#closed) {
      client.close()
      return
    }
    this.#client = client
    this.#stopFailure = client.onFailure(error => this.#clientFailed(error))
    this.#stopNotification = client.onNotification(notification => this.#notification(notification))
    this.#stopServerRequest = client.onServerRequest(async request => {
      if (request.method !== 'item/tool/call') {
        throw new Error(`Mona does not handle the Codex request ${request.method}.`)
      }
      const params = request.params as {
        arguments?: unknown
        threadId?: unknown
        tool?: unknown
      }
      if (params.threadId !== this.#threadId || typeof params.tool !== 'string') {
        throw new Error('Codex requested a tool for a different Mona conversation.')
      }
      try {
        const result = await this.#runtime.execute(params.tool, params.arguments ?? {})
        return {
          contentItems: result.content.map(content => content.type === 'text'
            ? { text: content.text, type: 'inputText' }
            : {
                imageUrl: `data:${content.mediaType};base64,${content.data}`,
                type: 'inputImage',
              }),
          success: true,
        }
      }
      catch (error) {
        return {
          contentItems: [{
            text: error instanceof Error ? error.message : 'The Mona tool failed.',
            type: 'inputText',
          }],
          success: false,
        }
      }
    })

    const common = {
      approvalPolicy: 'never',
      cwd: this.#runtime.root,
      developerInstructions: this.#systemInstruction,
      model: this.#modelId,
      sandbox: 'workspace-write',
    }
    const response = this.#resumeSessionId
      ? await client.request<CodexThreadResponse>('thread/resume', {
          ...common,
          threadId: this.#resumeSessionId,
        })
      : await client.request<CodexThreadResponse>('thread/start', {
          ...common,
          dynamicTools: this.#runtime.tools.map(tool => ({
            description: tool.description,
            inputSchema: tool.inputSchema,
            name: tool.name,
            type: 'function',
          })),
          ephemeral: false,
          threadSource: 'mona',
        })
    const threadId = response.thread?.id
    if (!threadId) throw new Error('Codex started without a thread identity.')
    this.#threadId = threadId
    this.#onSessionId?.(threadId)
  }

  async #send(prompt: ProviderSessionPrompt): Promise<void> {
    const client = this.#client
    const threadId = this.#threadId
    if (!client || !threadId) throw new Error('Codex is not ready.')

    if (this.#activeTurnId) {
      await client.request('turn/steer', {
        clientUserMessageId: prompt.userMessageId,
        expectedTurnId: this.#activeTurnId,
        input: [{ text: prompt.text, text_elements: [], type: 'text' }],
        threadId,
      })
      return
    }

    if (prompt.handoff?.length) {
      await client.request('thread/inject_items', {
        items: agentContextToResponsesItems(prompt.handoff),
        threadId,
      })
    }
    const response = await client.request<CodexTurnResponse>('turn/start', {
      approvalPolicy: 'never',
      clientUserMessageId: prompt.userMessageId,
      cwd: this.#runtime.root,
      ...(this.#effort ? { effort: this.#effort } : {}),
      input: [{ text: prompt.text, text_elements: [], type: 'text' }],
      model: this.#modelId,
      sandboxPolicy: {
        excludeSlashTmp: false,
        excludeTmpdirEnvVar: false,
        networkAccess: true,
        type: 'workspaceWrite',
        writableRoots: [this.#runtime.root],
      },
      summary: 'concise',
      threadId,
    })
    const turnId = response.turn?.id
    if (!turnId) throw new Error('Codex started a turn without an identity.')
    this.#activeTurnId = turnId
  }

  #notification(notification: CodexServerNotification): void {
    const params = notification.params as Record<string, unknown> | undefined
    if (params?.threadId && params.threadId !== this.#threadId) return
    if (notification.method === 'turn/started') {
      const turn = params?.turn as CodexTurn | undefined
      if (turn?.id) this.#activeTurnId = turn.id
      return
    }
    if (notification.method === 'item/agentMessage/delta') {
      this.#textDelta(params)
      return
    }
    if (
      notification.method === 'item/reasoning/summaryTextDelta'
      || notification.method === 'item/reasoning/textDelta'
    ) {
      this.#reasoningDelta(params)
      return
    }
    if (notification.method === 'item/started') {
      this.#itemStarted(params?.item as CodexThreadItem | undefined)
      return
    }
    if (notification.method === 'item/completed') {
      this.#itemCompleted(params?.item as CodexThreadItem | undefined)
      return
    }
    if (notification.method === 'turn/completed') {
      this.#turnCompleted(params?.turn as CodexTurn | undefined)
      return
    }
    if (notification.method === 'error') {
      const error = params?.error as { message?: unknown } | undefined
      const message = typeof error?.message === 'string'
        ? error.message
        : typeof params?.message === 'string' ? params.message : 'Codex reported an error.'
      this.#output.push({ errorText: message, type: 'error' })
    }
  }

  #clientFailed(error: Error): void {
    if (this.#closed) return
    for (const id of this.#textParts) this.#output.push({ id, type: 'text-end' })
    for (const id of this.#reasoningParts) this.#output.push({ id, type: 'reasoning-end' })
    this.#textParts.clear()
    this.#reasoningParts.clear()
    this.#activeTurnId = undefined
    this.#output.push({ errorText: error.message, type: 'error' })
    this.#output.push({ type: 'finish' })
    this.#output.close()
  }

  #textDelta(params: Record<string, unknown> | undefined): void {
    const id = typeof params?.itemId === 'string' ? params.itemId : undefined
    const delta = typeof params?.delta === 'string' ? params.delta : undefined
    if (!id || !delta) return
    if (!this.#textParts.has(id)) {
      this.#textParts.add(id)
      this.#output.push({ id, type: 'text-start' })
    }
    this.#output.push({ delta, id, type: 'text-delta' })
  }

  #reasoningDelta(params: Record<string, unknown> | undefined): void {
    const id = typeof params?.itemId === 'string' ? params.itemId : undefined
    const delta = typeof params?.delta === 'string' ? params.delta : undefined
    if (!id || !delta) return
    if (!this.#reasoningParts.has(id)) {
      this.#reasoningParts.add(id)
      this.#output.push({ id, type: 'reasoning-start' })
    }
    this.#output.push({ delta, id, type: 'reasoning-delta' })
  }

  #itemStarted(item: CodexThreadItem | undefined): void {
    if (!item?.id) return
    if (item.type === 'dynamicToolCall') {
      this.#output.push({
        input: item.arguments ?? {},
        toolCallId: item.id,
        toolName: item.tool ?? 'tool',
        type: 'tool-input-available',
      })
      return
    }
    const tool = toolDisplay(item)
    if (!tool) return
    this.#output.push({
      input: tool.input,
      toolCallId: item.id,
      toolName: tool.name,
      type: 'tool-input-available',
    })
  }

  #itemCompleted(item: CodexThreadItem | undefined): void {
    if (!item?.id) return
    if (item.type === 'agentMessage') {
      if (!this.#textParts.has(item.id) && item.text) {
        this.#output.push({ id: item.id, type: 'text-start' })
        this.#output.push({ delta: item.text, id: item.id, type: 'text-delta' })
      }
      if (this.#textParts.delete(item.id) || item.text) {
        this.#output.push({ id: item.id, type: 'text-end' })
      }
      return
    }
    if (item.type === 'reasoning') {
      if (this.#reasoningParts.delete(item.id)) {
        this.#output.push({ id: item.id, type: 'reasoning-end' })
      }
      return
    }
    const tool = toolDisplay(item)
    if (!tool) return
    if (item.type === 'dynamicToolCall' && item.success === false) {
      this.#output.push({
        errorText: toolOutput(item) || 'The Mona tool failed.',
        toolCallId: item.id,
        type: 'tool-output-error',
      })
      return
    }
    this.#output.push({
      output: toolOutput(item) || 'Completed.',
      toolCallId: item.id,
      type: 'tool-output-available',
    })
  }

  #turnCompleted(turn: CodexTurn | undefined): void {
    if (turn?.id && this.#activeTurnId && turn.id !== this.#activeTurnId) return
    for (const id of this.#textParts) this.#output.push({ id, type: 'text-end' })
    for (const id of this.#reasoningParts) this.#output.push({ id, type: 'reasoning-end' })
    this.#textParts.clear()
    this.#reasoningParts.clear()
    this.#activeTurnId = undefined
    if (turn?.status === 'failed') {
      this.#output.push({
        errorText: turn.error?.message ?? 'Codex could not complete this turn.',
        type: 'error',
      })
    }
    this.#output.push({ type: 'finish' })
  }
}

const toolDisplay = (
  item: CodexThreadItem,
): { input: unknown; name: string } | null => {
  if (item.type === 'dynamicToolCall') {
    return { input: item.arguments ?? {}, name: item.tool ?? 'tool' }
  }
  if (item.type === 'commandExecution') {
    return { input: { command: item.command ?? '' }, name: 'command' }
  }
  if (item.type === 'fileChange') {
    return { input: { changes: item.changes?.length ?? 0 }, name: 'file_change' }
  }
  if (item.type === 'webSearch') {
    return { input: { query: item.query ?? '' }, name: 'web_search' }
  }
  if (item.type === 'imageView') return { input: {}, name: 'look' }
  return null
}

const toolOutput = (item: CodexThreadItem): string => {
  if (typeof item.aggregatedOutput === 'string') return item.aggregatedOutput.slice(-4_000)
  return (item.contentItems ?? [])
    .flatMap(content => content.type === 'inputText' && content.text ? [content.text] : [])
    .join('\n')
}
