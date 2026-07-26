import type { IncomingMessage, Server } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'

import { AgentSdkSession } from './agent-sdk-session.js'
import { AgentStreamTranslator } from './agent-sdk-stream.js'
import { AgentToolBridge, type AgentToolRequest } from './agent-tool-bridge.js'

export const AGENT_SOCKET_PATH = '/api/agent/chat/ws'

/**
 * The largest single frame either side may send.
 *
 * Stated rather than inherited, because the default silently decided a design
 * question. `ws` allows 100 MiB; a deck's images sent together came to 342 MB, so
 * the socket closed mid-handshake with nothing in any log explaining it. Assets now
 * travel one per frame, and the biggest single one observed is ~40 MB of base64 -
 * so this is generous for a real asset and still small enough that a frame this
 * size means something has gone wrong.
 */
const MAX_FRAME_BYTES = 64 * 1024 * 1024

/** Sent to the browser. */
type ServerFrame =
  | { type: 'chunk'; chunk: unknown }
  | { type: 'tool-request' } & AgentToolRequest

/** Received from the browser. */
interface ClientFrame {
  effort?: string
  errorText?: string
  id?: string
  model?: string
  output?: unknown
  text?: string
  type?: string
}

const EFFORT_LEVELS = new Set(['low', 'medium', 'high', 'xhigh', 'max'])

const isEffortLevel = (value: unknown): value is 'low' | 'medium' | 'high' | 'xhigh' | 'max' => (
  typeof value === 'string' && EFFORT_LEVELS.has(value)
)

const parseFrame = (data: unknown): ClientFrame | undefined => {
  try {
    const parsed = JSON.parse(String(data)) as unknown
    return parsed && typeof parsed === 'object' ? parsed as ClientFrame : undefined
  }
  catch {
    return undefined
  }
}

/**
 * One browser connection, driving one Agent SDK conversation.
 *
 * The socket carries three things upward - a prompt, a tool result, an
 * interrupt - and two downward: UI chunks for the renderer, and tool requests
 * the browser must fulfil. A plain request/response could not do this: the tool
 * handler runs here but can only act over there, so the connection has to stay
 * open in both directions for the length of a turn.
 */
class AgentConnection {
  readonly #bridge: AgentToolBridge
  readonly #socket: WebSocket
  #session?: AgentSdkSession
  #turn?: Promise<void>

  constructor(socket: WebSocket) {
    this.#socket = socket
    this.#bridge = new AgentToolBridge({
      send: request => this.#send({ ...request, type: 'tool-request' }),
    })
    socket.on('message', data => void this.#receive(data))
    socket.on('close', () => this.#close())
    socket.on('error', () => this.#close())
  }

  async #receive(data: unknown): Promise<void> {
    const frame = parseFrame(data)
    if (!frame) return
    switch (frame.type) {
      case 'prompt': {
        if (typeof frame.text !== 'string' || !frame.text) return
        this.#start(frame.model, frame.effort)
        this.#session?.send(frame.text)
        return
      }
      case 'tool-result': {
        if (typeof frame.id !== 'string') return
        this.#bridge.fulfil(frame.id, { errorText: frame.errorText, output: frame.output })
        return
      }
      case 'interrupt': {
        await this.#session?.interrupt()
        return
      }
      default:
        return
    }
  }

  /**
   * Starts the turn on the first prompt and never again: a later prompt is
   * queued onto the same session, which is what makes steering work rather
   * than starting a second conversation over the top of the first.
   */
  #start(model?: string, effort?: string): void {
    if (this.#session) return
    this.#session = new AgentSdkSession({
      bridge: this.#bridge,
      // Validated against the SDK's own levels rather than trusted from the
      // browser, so a bad value is dropped instead of failing the turn.
      ...(isEffortLevel(effort) ? { effort } : {}),
      modelId: typeof model === 'string' && model ? model : 'claude-sonnet-5',
    })
    this.#turn = this.#stream(this.#session)
  }

  async #stream(session: AgentSdkSession): Promise<void> {
    const translator = new AgentStreamTranslator()
    try {
      for await (const message of session.run()) {
        for (const chunk of translator.translate(message)) {
          this.#send({ chunk, type: 'chunk' })
        }
      }
    }
    catch (error) {
      this.#send({
        chunk: {
          errorText: error instanceof Error ? error.message : 'The agent failed.',
          type: 'error',
        },
        type: 'chunk',
      })
    }
  }

  #send(frame: ServerFrame): void {
    if (this.#socket.readyState !== this.#socket.OPEN) return
    this.#socket.send(JSON.stringify(frame))
  }

  #close(): void {
    // Fail the handlers first: the agent loop is blocked on them, and without
    // this the subprocess would sit waiting on a browser that has gone.
    this.#bridge.closeAll('The editor disconnected.')
    this.#session?.close()
    void this.#turn?.catch(() => undefined)
  }
}

/**
 * Attaches the agent socket to the existing HTTP server.
 *
 * `noServer` rather than a second listener, so the socket shares the HTTP server's
 * origin and its Origin check. That check is the whole gate now: there is no session
 * to authenticate, because there is one user and their credential is the machine's
 * own Claude login rather than anything this process holds.
 */
export const attachAgentSocket = ({
  allowedOrigins,
  server,
}: {
  allowedOrigins: ReadonlySet<string>
  server: Server
}): WebSocketServer => {
  const sockets = new WebSocketServer({ maxPayload: MAX_FRAME_BYTES, noServer: true })

  server.on('upgrade', (request: IncomingMessage, socket, head) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
    if (url.pathname !== AGENT_SOCKET_PATH) {
      // Registering an upgrade listener makes us responsible for every upgrade,
      // not just ours: Node stops destroying unhandled ones, so returning early
      // would leave the socket open forever and hold the server from closing.
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
      socket.destroy()
      return
    }
    // WebSockets are not subject to CORS: a browser will happily open one to us
    // from any page and attach the session cookie while doing it. Without this
    // check, any site the user visited could drive their agent. The Origin
    // header is mandatory here rather than optional - a browser always sends one
    // on an upgrade, so its absence is not a request we need to serve.
    const origin = request.headers.origin
    if (!origin || !allowedOrigins.has(origin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
      socket.destroy()
      return
    }
    sockets.handleUpgrade(request, socket, head, connection => {
      new AgentConnection(connection)
    })
  })

  return sockets
}
