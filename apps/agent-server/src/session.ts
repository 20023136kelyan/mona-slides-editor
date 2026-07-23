import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { decodeSignedValue, encodeSignedValue } from './security.js'

const COOKIE_NAME = 'mona_agent_session'
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

const parseCookies = (header: string | undefined): Map<string, string> => {
  const cookies = new Map<string, string>()
  for (const segment of header?.split(';') ?? []) {
    const separator = segment.indexOf('=')
    if (separator < 1) continue
    const name = segment.slice(0, separator).trim()
    const value = segment.slice(separator + 1).trim()
    if (name) cookies.set(name, value)
  }
  return cookies
}

export class SessionManager {
  readonly #development: boolean
  readonly #signingKey: Buffer

  constructor(signingKey: Buffer, development: boolean) {
    this.#signingKey = signingKey
    this.#development = development
  }

  getOrCreate(request: IncomingMessage, response: ServerResponse): string {
    const existing = parseCookies(request.headers.cookie).get(COOKIE_NAME)
    const verified = existing ? decodeSignedValue(existing, this.#signingKey) : undefined
    if (verified && /^[a-f\d]{64}$/.test(verified)) return verified
    const sessionId = randomBytes(32).toString('hex')
    const secure = !this.#development ? '; Secure' : ''
    response.setHeader(
      'Set-Cookie',
      `${COOKIE_NAME}=${encodeSignedValue(sessionId, this.#signingKey)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}${secure}`,
    )
    return sessionId
  }
}
