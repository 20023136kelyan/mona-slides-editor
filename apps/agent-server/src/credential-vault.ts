import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import {
  decryptJson,
  encryptJson,
  type EncryptedEnvelope,
} from './security.js'

/**
 * A bring-your-own-key credential. `env` carries provider-scoped configuration
 * that travels with the key rather than with the request.
 */
export interface AgentApiKeyCredential {
  type: 'api_key'
  env?: Record<string, string>
  key?: string
}

/**
 * A subscription credential: a bearer token plus the state needed to rotate it.
 *
 * `refresh` and `expires` are required because a stored bearer token is only
 * usable for as long as it can be renewed - a token with no rotation state goes
 * dead silently, which is the failure this shape exists to prevent.
 */
export interface AgentOAuthCredential {
  type: 'oauth'
  access: string
  expires: number
  refresh: string
  [key: string]: unknown
}

export type AgentCredential = AgentApiKeyCredential | AgentOAuthCredential

/** Non-secret credential metadata, for status without exposing the secret. */
export interface AgentCredentialInfo {
  providerId: string
  type: AgentCredential['type']
}

/**
 * One session's view of the vault, keyed by provider.
 *
 * `modify` is the only write path so every mutation is a serialized
 * read-modify-write: a token refresh has to see the current credential, or two
 * concurrent requests will each rotate a single-use refresh token and the
 * second one loses.
 */
export interface AgentCredentialStore {
  delete(providerId: string): Promise<void>
  list(): Promise<readonly AgentCredentialInfo[]>
  modify(
    providerId: string,
    change: (credential: AgentCredential | undefined) => Promise<AgentCredential | undefined>,
  ): Promise<AgentCredential | undefined>
  read(providerId: string): Promise<AgentCredential | undefined>
}

type CredentialDocument = Record<string, Record<string, AgentCredential>>

export interface CredentialVault {
  delete(sessionId: string, providerId: string): Promise<void>
  list(sessionId: string): Promise<readonly AgentCredentialInfo[]>
  modify(
    sessionId: string,
    providerId: string,
    change: (credential: AgentCredential | undefined) => Promise<AgentCredential | undefined>,
  ): Promise<AgentCredential | undefined>
  read(sessionId: string, providerId: string): Promise<AgentCredential | undefined>
}

const cloneCredential = (
  credential: AgentCredential | undefined,
): AgentCredential | undefined => (
  credential ? structuredClone(credential) : undefined
)

export class EncryptedFileCredentialVault implements CredentialVault {
  readonly #file: string
  readonly #key: Buffer
  #loaded = false
  #document: CredentialDocument = {}
  #operation = Promise.resolve()

  constructor(file: string, key: Buffer) {
    this.#file = file
    this.#key = key
  }

  async #withLock<Value>(operation: () => Promise<Value>): Promise<Value> {
    const previous = this.#operation
    let release: () => void = () => undefined
    this.#operation = new Promise<void>(resolve => {
      release = resolve
    })
    await previous
    try {
      await this.#load()
      return await operation()
    }
    finally {
      release()
    }
  }

  async #load(): Promise<void> {
    if (this.#loaded) return
    try {
      const envelope = JSON.parse(await readFile(this.#file, 'utf8')) as EncryptedEnvelope
      this.#document = decryptJson<CredentialDocument>(envelope, this.#key)
    }
    catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      this.#document = {}
    }
    this.#loaded = true
  }

  async #save(): Promise<void> {
    await mkdir(dirname(this.#file), { recursive: true, mode: 0o700 })
    const temporary = `${this.#file}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(encryptJson(this.#document, this.#key))}\n`, { mode: 0o600 })
    await rename(temporary, this.#file)
  }

  read(sessionId: string, providerId: string): Promise<AgentCredential | undefined> {
    return this.#withLock(async () => cloneCredential(this.#document[sessionId]?.[providerId]))
  }

  list(sessionId: string): Promise<readonly AgentCredentialInfo[]> {
    return this.#withLock(async () => Object.entries(this.#document[sessionId] ?? {}).map(
      ([providerId, credential]) => ({ providerId, type: credential.type }),
    ))
  }

  modify(
    sessionId: string,
    providerId: string,
    change: (credential: AgentCredential | undefined) => Promise<AgentCredential | undefined>,
  ): Promise<AgentCredential | undefined> {
    return this.#withLock(async () => {
      const current = cloneCredential(this.#document[sessionId]?.[providerId])
      const next = await change(current)
      if (next === undefined) return current
      const session = this.#document[sessionId] ?? {}
      session[providerId] = structuredClone(next)
      this.#document[sessionId] = session
      await this.#save()
      return cloneCredential(next)
    })
  }

  delete(sessionId: string, providerId: string): Promise<void> {
    return this.#withLock(async () => {
      const session = this.#document[sessionId]
      if (!session?.[providerId]) return
      delete session[providerId]
      if (!Object.keys(session).length) delete this.#document[sessionId]
      await this.#save()
    })
  }
}

export class SessionCredentialStore implements AgentCredentialStore {
  readonly #sessionId: string
  readonly #vault: CredentialVault

  constructor(vault: CredentialVault, sessionId: string) {
    this.#vault = vault
    this.#sessionId = sessionId
  }

  read(providerId: string): Promise<AgentCredential | undefined> {
    return this.#vault.read(this.#sessionId, providerId)
  }

  list(): Promise<readonly AgentCredentialInfo[]> {
    return this.#vault.list(this.#sessionId)
  }

  modify(
    providerId: string,
    change: (credential: AgentCredential | undefined) => Promise<AgentCredential | undefined>,
  ): Promise<AgentCredential | undefined> {
    return this.#vault.modify(this.#sessionId, providerId, change)
  }

  delete(providerId: string): Promise<void> {
    return this.#vault.delete(this.#sessionId, providerId)
  }
}
