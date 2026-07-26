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
  const directory = await mkdtemp(join(tmpdir(), 'mona-agent-http-'))
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
  return `http://127.0.0.1:${address.port}`
}

const ORIGIN = 'http://127.0.0.1:6174'

describe('agent HTTP boundary', () => {
  it('answers health without needing anything established first', async () => {
    const baseUrl = await start()
    const response = await fetch(`${baseUrl}/api/agent/health`, { headers: { Origin: ORIGIN } })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true })
  })

  it('refuses a mutation from an origin we do not serve', async () => {
    // The server listens on loopback, where any local process can reach it.
    const baseUrl = await start()
    const response = await fetch(`${baseUrl}/api/agent/web/search`, {
      body: JSON.stringify({ query: 'anything' }),
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
      method: 'POST',
    })

    expect(response.status).toBe(403)
  })

  it('sets no cookie, because there is no session to keep', async () => {
    // One user, and their credential is the machine's own Claude login rather than
    // anything this process holds.
    const baseUrl = await start()
    const response = await fetch(`${baseUrl}/api/agent/health`, { headers: { Origin: ORIGIN } })

    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('has no provider, auth or credential routes left', async () => {
    const baseUrl = await start()
    for (const path of [
      '/api/agent/auth/anthropic-claude/status',
      '/api/agent/providers/anthropic-claude/key',
      '/api/agent/auth/openai-chatgpt/flows/anything',
    ]) {
      const response = await fetch(`${baseUrl}${path}`, { headers: { Origin: ORIGIN } })
      expect(response.status).toBe(404)
    }
  })
})
