import { randomBytes } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'

import { AGENT_SOCKET_PATH } from './agent-socket.js'
import type { AgentServerConfig } from './config.js'
import { createAgentServer } from './server.js'

const servers: Array<ReturnType<typeof createAgentServer>> = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))))
})

const start = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mona-agent-socket-'))
  const config: AgentServerConfig = {
    allowedOrigins: new Set(['http://127.0.0.1:6174']),
    assetDirectory: join(directory, 'assets'),
    credentialFile: join(directory, 'credentials.enc.json'),
    credentialKey: randomBytes(32),
    development: true,
    host: '127.0.0.1',
    port: 0,
    sessionSigningKey: randomBytes(32),
  }
  const server = createAgentServer({ config })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test server did not start')
  return { baseUrl: `http://127.0.0.1:${address.port}`, port: address.port }
}

/** A signed session cookie, obtained the way the browser obtains one. */
const establishSession = async (baseUrl: string): Promise<string> => {
  const response = await fetch(`${baseUrl}/api/agent/auth/openai-chatgpt/status`, {
    headers: { Origin: 'http://127.0.0.1:6174' },
  })
  const cookie = response.headers.get('set-cookie')
  if (!cookie) throw new Error('Server did not set a session cookie')
  return cookie.split(';')[0] ?? ''
}

const ALLOWED_ORIGIN = 'http://127.0.0.1:6174'

/** `origin: null` means send no Origin header at all - `undefined` would take the default. */
const connect = (
  port: number,
  cookie?: string,
  origin: string | null = ALLOWED_ORIGIN,
) => new Promise<{ code?: number; open: boolean }>(resolve => {
  const socket = new WebSocket(`ws://127.0.0.1:${port}${AGENT_SOCKET_PATH}`, {
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(origin ? { Origin: origin } : {}),
    },
  })
  socket.on('open', () => {
    socket.close()
    resolve({ open: true })
  })
  // Neither close() nor terminate() is legal before the handshake completes, so
  // a rejected upgrade is cleaned up through the underlying request instead.
  socket.on('unexpected-response', (request, response) => {
    const code = response.statusCode
    request.destroy()
    resolve({ code, open: false })
  })
  socket.on('error', () => resolve({ open: false }))
})

describe('agent socket boundary', () => {
  it('refuses an upgrade that carries no session', async () => {
    const { port } = await start()

    expect(await connect(port)).toEqual({ code: 401, open: false })
  })

  it('refuses an upgrade whose session cookie is not ours', async () => {
    const { port } = await start()
    // A well-formed session id with a signature this server never issued.
    const forged = `mona_agent_session=${'a'.repeat(64)}.${'b'.repeat(64)}`

    expect(await connect(port, forged)).toEqual({ code: 401, open: false })
  })

  it('accepts an upgrade on an established session', async () => {
    const { baseUrl, port } = await start()
    const cookie = await establishSession(baseUrl)

    expect(await connect(port, cookie)).toEqual({ open: true })
  })

  it('refuses an upgrade from an origin we do not serve', async () => {
    // WebSockets bypass CORS entirely, so without this a page on any origin
    // could open a socket and the browser would attach the session cookie.
    const { baseUrl, port } = await start()
    const cookie = await establishSession(baseUrl)

    expect(await connect(port, cookie, 'https://evil.example')).toEqual({ code: 403, open: false })
  })

  it('refuses an upgrade that declares no origin at all', async () => {
    const { baseUrl, port } = await start()
    const cookie = await establishSession(baseUrl)

    expect(await connect(port, cookie, null)).toEqual({ code: 403, open: false })
  })

  it('checks the origin before it checks the session', async () => {
    // A cross-origin attempt should not be able to tell whether a session
    // exists, so the origin is rejected first.
    const { port } = await start()

    expect(await connect(port, undefined, 'https://evil.example')).toEqual({ code: 403, open: false })
  })

  it('closes an upgrade to any other path instead of leaving it hanging', async () => {
    // Registering an upgrade listener makes this server responsible for every
    // upgrade. An unhandled one used to sit open forever, which both leaked a
    // socket per attempt and stopped the server from ever closing.
    const { baseUrl, port } = await start()
    const cookie = await establishSession(baseUrl)
    const outcome = await new Promise<{ code?: number; open: boolean }>(resolve => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/api/agent/somewhere-else`, {
        headers: { Cookie: cookie, Origin: ALLOWED_ORIGIN },
      })
      socket.on('open', () => {
        socket.close()
        resolve({ open: true })
      })
      socket.on('unexpected-response', (request, response) => {
        const code = response.statusCode
        request.destroy()
        resolve({ code, open: false })
      })
      socket.on('error', () => resolve({ open: false }))
    })

    expect(outcome).toEqual({ code: 404, open: false })
  })
})
