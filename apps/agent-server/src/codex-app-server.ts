import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface, type Interface as ReadLineInterface } from 'node:readline'

import { monaCodexEnv } from './codex-env.js'

type RequestId = number | string

interface RpcError {
  code?: number
  data?: unknown
  message?: string
}

interface RpcMessage {
  error?: RpcError
  id?: RequestId
  method?: string
  params?: unknown
  result?: unknown
}

interface PendingRequest {
  reject: (error: Error) => void
  resolve: (result: unknown) => void
  timeout: ReturnType<typeof setTimeout>
}

export interface CodexServerNotification {
  method: string
  params: unknown
}

export interface CodexServerRequest extends CodexServerNotification {
  id: RequestId
}

export interface CodexProcess {
  kill: (signal?: NodeJS.Signals | number) => boolean
  once: ChildProcessWithoutNullStreams['once']
  stderr: NodeJS.ReadableStream
  stdin: NodeJS.WritableStream
  stdout: NodeJS.ReadableStream
}

export interface CodexAppServerClientOptions {
  executablePath: string
  processFactory?: () => CodexProcess
  requestTimeoutMs?: number
}

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000

/**
 * A small, strict app-server client.
 *
 * Codex speaks one JSON-RPC-shaped object per line over stdio. Keeping that
 * protocol in the main process means credentials and native thread identities
 * never enter the renderer, while every surface can consume the same AI SDK UI
 * chunks it already uses for Claude.
 */
export class CodexAppServerClient {
  readonly #failures = new Set<(error: Error) => void>()
  readonly #notifications = new Set<(notification: CodexServerNotification) => void>()
  readonly #pending = new Map<RequestId, PendingRequest>()
  readonly #process: CodexProcess
  readonly #reader: ReadLineInterface
  readonly #requestTimeoutMs: number
  readonly #serverRequests = new Set<(request: CodexServerRequest) => Promise<unknown> | unknown>()
  #closed = false
  #nextId = 1
  #stderrTail = ''

  private constructor(options: CodexAppServerClientOptions) {
    this.#requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    this.#process = options.processFactory?.() ?? spawn(
      options.executablePath,
      ['app-server', '--listen', 'stdio://'],
      {
        env: monaCodexEnv(),
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )
    this.#reader = createInterface({ input: this.#process.stdout })
    this.#reader.on('line', line => this.#receive(line))
    this.#process.stderr.on('data', chunk => {
      this.#stderrTail = `${this.#stderrTail}${String(chunk)}`.slice(-8_000)
    })
    this.#process.once('error', error => this.#fail(error))
    this.#process.once('exit', (code, signal) => {
      if (this.#closed) return
      const detail = this.#stderrTail.trim()
      this.#fail(new Error([
        `Codex app-server exited${signal ? ` from ${signal}` : ` with code ${code ?? 'unknown'}`}.`,
        detail,
      ].filter(Boolean).join('\n')))
    })
  }

  static async connect(options: CodexAppServerClientOptions): Promise<CodexAppServerClient> {
    const client = new CodexAppServerClient(options)
    try {
      await client.request('initialize', {
        capabilities: {
          experimentalApi: true,
          requestAttestation: false,
        },
        clientInfo: {
          name: 'mona_slides',
          title: 'Mona',
          version: '0.1.0',
        },
      })
      client.notify('initialized')
      return client
    }
    catch (error) {
      client.close()
      throw error
    }
  }

  request<Result = unknown>(method: string, params?: unknown): Promise<Result> {
    if (this.#closed) return Promise.reject(new Error('The Codex app-server is closed.'))
    const id = this.#nextId++
    return new Promise<Result>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id)
        reject(new Error(`Codex app-server did not answer ${method} within ${this.#requestTimeoutMs} ms.`))
      }, this.#requestTimeoutMs)
      timeout.unref?.()
      this.#pending.set(id, {
        reject,
        resolve: result => resolve(result as Result),
        timeout,
      })
      try {
        this.#write({ id, method, ...(params === undefined ? {} : { params }) })
      }
      catch (error) {
        clearTimeout(timeout)
        this.#pending.delete(id)
        reject(error instanceof Error ? error : new Error('Could not write to Codex app-server.'))
      }
    })
  }

  notify(method: string, params?: unknown): void {
    this.#write({ method, ...(params === undefined ? {} : { params }) })
  }

  onNotification(listener: (notification: CodexServerNotification) => void): () => void {
    this.#notifications.add(listener)
    return () => this.#notifications.delete(listener)
  }

  onFailure(listener: (error: Error) => void): () => void {
    this.#failures.add(listener)
    return () => this.#failures.delete(listener)
  }

  onServerRequest(
    listener: (request: CodexServerRequest) => Promise<unknown> | unknown,
  ): () => void {
    this.#serverRequests.add(listener)
    return () => this.#serverRequests.delete(listener)
  }

  async waitForNotification(
    predicate: (notification: CodexServerNotification) => boolean,
    timeoutMs = 5 * 60_000,
  ): Promise<CodexServerNotification> {
    return await new Promise<CodexServerNotification>((resolve, reject) => {
      const timeout = setTimeout(() => {
        stop()
        reject(new Error('Timed out waiting for Codex app-server.'))
      }, timeoutMs)
      timeout.unref?.()
      const stop = this.onNotification(notification => {
        if (!predicate(notification)) return
        clearTimeout(timeout)
        stop()
        resolve(notification)
      })
    })
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#reader.close()
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(new Error('The Codex app-server closed.'))
    }
    this.#pending.clear()
    this.#failures.clear()
    this.#notifications.clear()
    this.#serverRequests.clear()
    this.#process.stdin.end()
    const force = setTimeout(() => this.#process.kill('SIGTERM'), 500)
    force.unref?.()
  }

  #write(message: RpcMessage): void {
    if (this.#closed) throw new Error('The Codex app-server is closed.')
    this.#process.stdin.write(`${JSON.stringify(message)}\n`)
  }

  #receive(line: string): void {
    let message: RpcMessage
    try {
      message = JSON.parse(line) as RpcMessage
    }
    catch {
      return
    }

    if (message.id !== undefined && !message.method) {
      const pending = this.#pending.get(message.id)
      if (!pending) return
      this.#pending.delete(message.id)
      clearTimeout(pending.timeout)
      if (message.error) {
        pending.reject(new Error(message.error.message ?? 'Codex app-server request failed.'))
      }
      else pending.resolve(message.result)
      return
    }

    if (message.id !== undefined && message.method) {
      void this.#handleServerRequest({
        id: message.id,
        method: message.method,
        params: message.params,
      })
      return
    }

    if (!message.method) return
    const notification = { method: message.method, params: message.params }
    for (const listener of this.#notifications) listener(notification)
  }

  async #handleServerRequest(request: CodexServerRequest): Promise<void> {
    const handler = this.#serverRequests.values().next().value as (
      ((value: CodexServerRequest) => Promise<unknown> | unknown) | undefined
    )
    if (!handler) {
      this.#write({
        error: { code: -32601, message: `Mona does not handle ${request.method}.` },
        id: request.id,
      })
      return
    }
    try {
      this.#write({ id: request.id, result: await handler(request) })
    }
    catch (error) {
      this.#write({
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : 'The Mona tool failed.',
        },
        id: request.id,
      })
    }
  }

  #fail(error: Error): void {
    if (this.#closed) return
    this.#closed = true
    this.#reader.close()
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.#pending.clear()
    for (const listener of this.#failures) listener(error)
    this.#failures.clear()
    this.#notifications.clear()
    this.#serverRequests.clear()
  }
}
