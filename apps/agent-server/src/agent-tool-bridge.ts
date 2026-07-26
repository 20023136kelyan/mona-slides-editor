import { randomUUID } from 'node:crypto'

/**
 * A tool call travelling from the server to the browser.
 *
 * The Agent SDK runs our tool handlers in-process here, but the deck lives in
 * the browser, so `look`, `inspect` and `edit` can only act there. The handler
 * therefore sends one of these and waits for the answer to come back.
 */
export interface AgentToolRequest {
  id: string
  input: unknown
  name: string
}

/** What the browser sends back once it has run the tool. */
export interface AgentToolOutcome {
  errorText?: string
  output?: unknown
}

/** How long a handler waits for the browser before giving up. */
const DEFAULT_TIMEOUT_MS = 90_000

interface Pending {
  reject: (error: Error) => void
  resolve: (output: unknown) => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * Correlates in-process tool handlers with the browser that fulfils them.
 *
 * Every request carries an id, and the matching outcome resolves the handler's
 * promise. A request that is never answered rejects on a timer rather than
 * waiting forever: a closed tab must fail the turn, not wedge it, because the
 * agent loop is blocked on the handler until it settles.
 */
export class AgentToolBridge {
  readonly #pending = new Map<string, Pending>()
  readonly #newId: () => string
  readonly #send: (request: AgentToolRequest) => void
  readonly #timeoutMs: number

  constructor({
    newId = randomUUID,
    send,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  }: {
    newId?: () => string
    send: (request: AgentToolRequest) => void
    timeoutMs?: number
  }) {
    this.#newId = newId
    this.#send = send
    this.#timeoutMs = timeoutMs
  }

  get pendingCount(): number {
    return this.#pending.size
  }

  /** Ask the browser to run a tool, and resolve with whatever it returns. */
  request(name: string, input: unknown): Promise<unknown> {
    const id = this.#newId()
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        reject(new Error(`The editor did not answer the ${name} tool in time.`))
      }, this.#timeoutMs)
      // A pending timer would otherwise hold the process open on shutdown.
      timer.unref?.()
      this.#pending.set(id, { reject, resolve, timer })
      try {
        this.#send({ id, input, name })
      }
      catch (error) {
        this.#settle(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  /**
   * Deliver the browser's answer.
   *
   * Returns false for an id we are not waiting on, so a duplicate or forged
   * outcome is ignored rather than trusted.
   */
  fulfil(id: string, outcome: AgentToolOutcome): boolean {
    const pending = this.#settle(id)
    if (!pending) return false
    if (outcome.errorText) pending.reject(new Error(outcome.errorText))
    else pending.resolve(outcome.output)
    return true
  }

  /** Fail everything still in flight - the browser is gone. */
  closeAll(reason: string): void {
    for (const id of [...this.#pending.keys()]) {
      this.#settle(id)?.reject(new Error(reason))
    }
  }

  #settle(id: string): Pending | undefined {
    const pending = this.#pending.get(id)
    if (!pending) return undefined
    clearTimeout(pending.timer)
    this.#pending.delete(id)
    return pending
  }
}
