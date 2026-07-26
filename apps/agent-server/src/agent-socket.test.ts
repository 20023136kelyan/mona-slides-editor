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
    assetSigningKey: randomBytes(32),
    development: true,
    host: '127.0.0.1',
    port: 0,
  }
  const server = createAgentServer({ config })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test server did not start')
  return { port: address.port }
}

const upgrade = (port: number, path: string, origin: string | null) => new Promise<string>(resolve => {
  const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`, {
    headers: origin === null ? {} : { Origin: origin },
  })
  socket.on('open', () => { socket.close(); resolve('open') })
  socket.on('error', error => resolve(error.message))
  socket.on('unexpected-response', (_request, response) => resolve(`status ${response.statusCode}`))
})

describe('agent socket boundary', () => {
  it('accepts an upgrade from an origin we serve', async () => {
    const { port } = await start()
    expect(await upgrade(port, AGENT_SOCKET_PATH, 'http://127.0.0.1:6174')).toBe('open')
  })

  it('refuses an upgrade from an origin we do not serve', async () => {
    // WebSockets are not subject to CORS: any page the user visits can open one to
    // a loopback port. Without this check, that page could drive their agent.
    const { port } = await start()
    expect(await upgrade(port, AGENT_SOCKET_PATH, 'https://evil.example')).toContain('403')
  })

  it('refuses an upgrade that declares no origin at all', async () => {
    // A browser always sends one, so its absence is not a request worth serving.
    const { port } = await start()
    expect(await upgrade(port, AGENT_SOCKET_PATH, null)).toContain('403')
  })

  it('closes an upgrade to any other path instead of leaving it hanging', async () => {
    // Registering an upgrade listener makes us responsible for every upgrade: Node
    // stops destroying unhandled ones, so returning early would hold the server open.
    const { port } = await start()
    expect(await upgrade(port, '/api/agent/not-the-socket', 'http://127.0.0.1:6174')).toContain('404')
  })
})
