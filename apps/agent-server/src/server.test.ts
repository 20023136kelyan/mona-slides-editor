import { randomBytes } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import type { AgentServerConfig } from './config.js'
import { createAgentServer } from './server.js'

const servers: Array<ReturnType<typeof createAgentServer>> = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))))
})

const start = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mona-agent-server-'))
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
  return `http://127.0.0.1:${address.port}`
}

describe('agent HTTP boundary', () => {
  it('sets a signed HttpOnly session and returns disconnected provider status', async () => {
    const baseUrl = await start()
    const response = await fetch(`${baseUrl}/api/agent/auth/openai-chatgpt/status`, {
      headers: { Origin: 'http://127.0.0.1:6174' },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toContain('HttpOnly')
    expect(await response.json()).toEqual({ connected: false })
  })

  it('rejects state-changing requests without an approved Origin', async () => {
    const baseUrl = await start()
    const response = await fetch(`${baseUrl}/api/agent/auth/openai-chatgpt`, { method: 'DELETE' })
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ message: 'Request origin is not allowed' })
  })

  it('does not pretend the Mona-managed provider is configured', async () => {
    const baseUrl = await start()
    const status = await fetch(`${baseUrl}/api/agent/providers/mona-managed/status`)
    expect(status.status).toBe(200)
    expect(await status.json()).toEqual({
      available: false,
      message: 'Mona managed AI is not configured on this deployment',
    })

    const response = await fetch(`${baseUrl}/api/agent/plan`, {
      body: '{}',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://127.0.0.1:6174',
      },
      method: 'POST',
    })
    expect(response.status).toBe(503)
  })
})
