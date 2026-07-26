import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { pathToFileURL } from 'node:url'

import { readLocalClaudeLogin } from './agent-sdk-auth.js'
import { readAnthropicModels } from './agent-sdk-models.js'
import { attachAgentSocket } from './agent-socket.js'
import {
  browsePexelsImages,
  browsePexelsVideos,
  ManagedImageAssets,
  type BrowseQuery,
} from './assets.js'
import { loadAgentServerConfig, type AgentServerConfig } from './config.js'
import { searchWeb, webSearchEnabled } from './web-search.js'

const JSON_BODY_LIMIT = 20 * 1024 * 1024

class HttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const setApiHeaders = (response: ServerResponse) => {
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
  response.setHeader('Referrer-Policy', 'no-referrer')
  response.setHeader('X-Content-Type-Options', 'nosniff')
}

const sendJson = (response: ServerResponse, status: number, value: unknown) => {
  if (response.writableEnded) return
  const data = Buffer.from(JSON.stringify(value))
  response.statusCode = status
  response.setHeader('Content-Length', String(data.byteLength))
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(data)
}

const readJson = async (request: IncomingMessage): Promise<unknown> => {
  const contentType = request.headers['content-type']?.split(';')[0]?.trim()
  if (contentType !== 'application/json') throw new HttpError(415, 'Content-Type must be application/json')
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of request) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    length += data.byteLength
    if (length > JSON_BODY_LIMIT) throw new HttpError(413, 'Request body is too large')
    chunks.push(data)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  }
  catch {
    throw new HttpError(400, 'Request body must contain valid JSON')
  }
}

const methodIsMutation = (method: string | undefined) => !['GET', 'HEAD', 'OPTIONS'].includes(method ?? '')

/**
 * The server listens on loopback, where any local process can reach it, so an
 * approved Origin is still the gate on anything that changes state. This goes when
 * the renderer stops speaking HTTP at all.
 */
const assertOrigin = (
  request: IncomingMessage,
  response: ServerResponse,
  config: AgentServerConfig,
) => {
  const origin = request.headers.origin
  if (origin && config.allowedOrigins.has(origin)) {
    response.setHeader('Access-Control-Allow-Credentials', 'true')
    response.setHeader('Access-Control-Allow-Origin', origin)
    response.setHeader('Vary', 'Origin')
    return
  }
  if (methodIsMutation(request.method)) throw new HttpError(403, 'Request origin is not allowed')
}

const pathSegments = (pathname: string) => pathname.split('/').filter(Boolean).map(segment => {
  try {
    return decodeURIComponent(segment)
  }
  catch {
    throw new HttpError(400, 'Malformed request path')
  }
})

const requestAbortSignal = (request: IncomingMessage): AbortSignal => {
  const controller = new AbortController()
  request.once('aborted', () => controller.abort())
  return controller.signal
}

export interface AgentServerDependencies {
  config: AgentServerConfig
}

/**
 * The agent host.
 *
 * There is one account and it is the machine's own Claude login, read from the
 * `claude` binary rather than stored here. That removes the entire apparatus this
 * file used to carry: a credential vault keyed by session, an OAuth flow manager
 * turning interactive prompts into pollable REST resources, per-session model
 * instances, and a signed session cookie to tell those sessions apart. All of it
 * existed to keep one hosted user's credentials away from another's, and there is
 * only one user now.
 */
export const createAgentServer = ({ config }: AgentServerDependencies) => {
  const assets = new ManagedImageAssets(config.assetDirectory, config.assetSigningKey)

  const server = createServer(async (request, response) => {
    setApiHeaders(response)
    try {
      assertOrigin(request, response, config)
      if (request.method === 'OPTIONS') {
        response.statusCode = 204
        response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
        response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        response.end()
        return
      }
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
      const segments = pathSegments(url.pathname)
      if (segments[0] !== 'api' || segments[1] !== 'agent') throw new HttpError(404, 'Route not found')

      if (request.method === 'GET' && segments.length === 3 && segments[2] === 'health') {
        sendJson(response, 200, { ok: true, service: 'mona-agent-server' })
        return
      }

      // Whether this machine is signed in to Claude, and as whom. Not a stored
      // credential: the Agent SDK authenticates from the user's own login, so this
      // reports a fact about the machine rather than about anything we hold.
      if (request.method === 'GET' && segments[2] === 'account' && segments.length === 3) {
        const login = await readLocalClaudeLogin()
        sendJson(response, 200, {
          connected: login.connected,
          ...(login.connected
            ? {
                accountLabel: login.email ?? 'Claude account connected',
                ...(login.plan ? { planLabel: login.plan } : {}),
              }
            : {}),
        })
        return
      }

      // The catalog belongs to the signed-in plan, so it can only come from the
      // SDK, and it carries which reasoning depths each model accepts.
      if (request.method === 'GET' && segments[2] === 'models' && segments.length === 3) {
        sendJson(response, 200, { models: await readAnthropicModels() })
        return
      }

      // Panel-facing media browse, for the Photos and Videos panels.
      if (
        request.method === 'POST'
        && segments[2] === 'assets'
        && (segments[3] === 'images' || segments[3] === 'videos')
        && segments[4] === 'browse'
        && segments.length === 5
      ) {
        const body = await readJson(request) as BrowseQuery
        const signal = requestAbortSignal(request)
        sendJson(response, 200, segments[3] === 'videos'
          ? await browsePexelsVideos(body, signal)
          : await browsePexelsImages(body, signal))
        return
      }

      if (
        request.method === 'POST'
        && segments[2] === 'web'
        && segments[3] === 'search'
        && segments.length === 4
      ) {
        if (!webSearchEnabled()) throw new HttpError(503, 'Web search is not configured on this deployment')
        const body = await readJson(request) as { query?: unknown }
        const query = typeof body.query === 'string' ? body.query : ''
        sendJson(response, 200, { results: await searchWeb(query, requestAbortSignal(request)) })
        return
      }

      if (
        request.method === 'GET'
        && segments[2] === 'assets'
        && segments[3] === 'images'
        && segments[4] === 'search'
        && segments.length === 5
      ) {
        const query = url.searchParams.get('q') ?? ''
        sendJson(response, 200, { results: await assets.search(query, requestAbortSignal(request)) })
        return
      }

      if (
        request.method === 'POST'
        && segments[2] === 'assets'
        && segments[3] === 'images'
        && segments[4] === 'import'
        && segments.length === 5
      ) {
        const body = await readJson(request) as { result?: unknown }
        sendJson(response, 201, await assets.import(body.result, requestAbortSignal(request)))
        return
      }

      if (
        request.method === 'GET'
        && segments[2] === 'assets'
        && segments[3] === 'images'
        && typeof segments[4] === 'string'
        && segments.length === 5
      ) {
        if (!await assets.serve(segments[4], response)) throw new HttpError(404, 'Managed image not found')
        return
      }

      throw new HttpError(404, 'Route not found')
    }
    catch (error) {
      const status = error instanceof HttpError ? error.status : 500
      const message = error instanceof HttpError
        ? error.message
        : 'The agent server could not complete the request'
      sendJson(response, status, { message })
    }
  })

  attachAgentSocket({ allowedOrigins: config.allowedOrigins, server })

  return server
}

const main = async () => {
  const config = await loadAgentServerConfig()
  const server = createAgentServer({ config })
  server.listen(config.port, config.host, () => {
    console.log(`Mona agent server listening on http://${config.host}:${config.port}`)
  })
  const shutdown = () => server.close(() => process.exit(0))
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main()
}
