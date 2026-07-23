import { ModelsError } from '@earendil-works/pi-ai'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { pathToFileURL } from 'node:url'

import { ManagedImageAssets } from './assets.js'
import { loadAgentServerConfig, type AgentServerConfig } from './config.js'
import {
  EncryptedFileCredentialVault,
  type CredentialVault,
} from './credential-vault.js'
import {
  createSessionModels,
  generateProviderPlan,
  getProviderConfiguration,
  isExternalProviderId,
  reviewProviderPlan,
  type ExternalProviderId,
} from './models.js'
import { OAuthFlowBusyError, OAuthFlowManager } from './oauth-flows.js'
import { SessionManager } from './session.js'

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

const isProviderPath = (
  segments: string[],
  offset: number,
): segments is string[] & { [key: number]: string } => {
  const provider = segments[offset]
  return typeof provider === 'string' && isExternalProviderId(provider)
}

const requestAbortSignal = (request: IncomingMessage): AbortSignal => {
  const controller = new AbortController()
  request.once('aborted', () => controller.abort())
  return controller.signal
}

const providerStatus = async (
  vault: CredentialVault,
  sessionId: string,
  providerId: ExternalProviderId,
) => {
  const models = createSessionModels(vault, sessionId)
  const configuration = getProviderConfiguration(providerId)
  const credential = await vault.read(sessionId, configuration.piProviderId)
  const status = await models.checkAuth(configuration.piProviderId)
  return {
    connected: credential?.type === 'oauth' && status?.type === 'oauth',
    ...(credential?.type === 'oauth'
      ? {
          accountLabel: providerId === 'openai-chatgpt'
            ? 'OpenAI account connected'
            : 'Anthropic account connected',
          planLabel: configuration.planLabel,
        }
      : {}),
  }
}

export interface AgentServerDependencies {
  config: AgentServerConfig
  vault?: CredentialVault
}

export const createAgentServer = ({ config, vault: providedVault }: AgentServerDependencies) => {
  const vault = providedVault ?? new EncryptedFileCredentialVault(config.credentialFile, config.credentialKey)
  const sessions = new SessionManager(config.sessionSigningKey, config.development)
  const modelsForSession = (sessionId: string) => createSessionModels(vault, sessionId)
  const flows = new OAuthFlowManager(modelsForSession)
  const assets = new ManagedImageAssets(config.assetDirectory, config.sessionSigningKey)

  return createServer(async (request, response) => {
    setApiHeaders(response)
    try {
      assertOrigin(request, response, config)
      if (request.method === 'OPTIONS') {
        response.statusCode = 204
        response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
        response.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
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

      if (
        request.method === 'GET'
        && segments[2] === 'providers'
        && segments[3] === 'mona-managed'
        && segments[4] === 'status'
        && segments.length === 5
      ) {
        sendJson(response, 200, {
          available: false,
          message: 'Mona managed AI is not configured on this deployment',
        })
        return
      }

      const sessionId = sessions.getOrCreate(request, response)

      if (
        request.method === 'GET'
        && segments[2] === 'auth'
        && isProviderPath(segments, 3)
        && segments[4] === 'status'
        && segments.length === 5
      ) {
        sendJson(response, 200, await providerStatus(vault, sessionId, segments[3] as ExternalProviderId))
        return
      }

      if (
        request.method === 'POST'
        && segments[2] === 'auth'
        && isProviderPath(segments, 3)
        && segments[4] === 'start'
        && segments.length === 5
      ) {
        await readJson(request)
        sendJson(response, 201, await flows.start(sessionId, segments[3] as ExternalProviderId))
        return
      }

      if (
        request.method === 'GET'
        && segments[2] === 'auth'
        && isProviderPath(segments, 3)
        && segments[4] === 'flows'
        && typeof segments[5] === 'string'
        && segments.length === 6
      ) {
        sendJson(response, 200, flows.get(sessionId, segments[5]))
        return
      }

      if (
        request.method === 'POST'
        && segments[2] === 'auth'
        && isProviderPath(segments, 3)
        && segments[4] === 'flows'
        && typeof segments[5] === 'string'
        && segments[6] === 'prompts'
        && typeof segments[7] === 'string'
        && segments.length === 8
      ) {
        const body = await readJson(request) as { answer?: unknown }
        sendJson(response, 200, flows.answerPrompt(sessionId, segments[5], segments[7], body.answer))
        return
      }

      if (
        request.method === 'DELETE'
        && segments[2] === 'auth'
        && isProviderPath(segments, 3)
        && segments[4] === 'flows'
        && typeof segments[5] === 'string'
        && segments.length === 6
      ) {
        flows.cancel(sessionId, segments[5])
        response.statusCode = 204
        response.end()
        return
      }

      if (
        request.method === 'DELETE'
        && segments[2] === 'auth'
        && isProviderPath(segments, 3)
        && segments.length === 4
      ) {
        const configuration = getProviderConfiguration(segments[3] as ExternalProviderId)
        await modelsForSession(sessionId).logout(configuration.piProviderId)
        sendJson(response, 200, { connected: false })
        return
      }

      if (
        request.method === 'POST'
        && segments[2] === 'providers'
        && isProviderPath(segments, 3)
        && (segments[4] === 'plan' || segments[4] === 'review')
        && segments.length === 5
      ) {
        const providerId = segments[3] as ExternalProviderId
        const status = await providerStatus(vault, sessionId, providerId)
        if (!status.connected) throw new HttpError(401, 'Connect this provider before using it')
        const body = await readJson(request)
        const models = modelsForSession(sessionId)
        const result = segments[4] === 'plan'
          ? await generateProviderPlan(models, providerId, body, requestAbortSignal(request))
          : await reviewProviderPlan(models, providerId, body, requestAbortSignal(request))
        sendJson(response, 200, result)
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

      if (
        request.method === 'POST'
        && ((segments[2] === 'plan' && segments.length === 3) || (segments[2] === 'review' && segments.length === 3))
      ) {
        throw new HttpError(503, 'Mona managed AI is not configured on this deployment')
      }

      throw new HttpError(404, 'Route not found')
    }
    catch (error) {
      const status = error instanceof HttpError
        ? error.status
        : error instanceof OAuthFlowBusyError
          ? 409
        : error instanceof ModelsError && (error.code === 'auth' || error.code === 'oauth')
          ? 401
          : 500
      const message = error instanceof HttpError || error instanceof OAuthFlowBusyError || status === 401
        ? error instanceof Error ? error.message : 'Request failed'
        : config.development && error instanceof Error
          ? error.message
          : 'The agent service could not complete this request'
      if (status >= 500) {
        const safeMessage = error instanceof Error ? error.message.slice(0, 500) : String(error)
        console.error('[mona-agent-server]', safeMessage)
      }
      sendJson(response, status, { message })
    }
  })
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
