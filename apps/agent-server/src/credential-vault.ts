import type {
  Credential,
  CredentialInfo,
  CredentialStore,
} from '@earendil-works/pi-ai'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import {
  decryptJson,
  encryptJson,
  type EncryptedEnvelope,
} from './security.js'

type CredentialDocument = Record<string, Record<string, Credential>>

export interface CredentialVault {
  delete(sessionId: string, providerId: string): Promise<void>
  list(sessionId: string): Promise<readonly CredentialInfo[]>
  modify(
    sessionId: string,
    providerId: string,
    change: (credential: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined>
  read(sessionId: string, providerId: string): Promise<Credential | undefined>
}

const cloneCredential = (credential: Credential | undefined): Credential | undefined => (
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

  read(sessionId: string, providerId: string): Promise<Credential | undefined> {
    return this.#withLock(async () => cloneCredential(this.#document[sessionId]?.[providerId]))
  }

  list(sessionId: string): Promise<readonly CredentialInfo[]> {
    return this.#withLock(async () => Object.entries(this.#document[sessionId] ?? {}).map(
      ([providerId, credential]) => ({ providerId, type: credential.type }),
    ))
  }

  modify(
    sessionId: string,
    providerId: string,
    change: (credential: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
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

export class SessionCredentialStore implements CredentialStore {
  readonly #sessionId: string
  readonly #vault: CredentialVault

  constructor(vault: CredentialVault, sessionId: string) {
    this.#vault = vault
    this.#sessionId = sessionId
  }

  read(providerId: string): Promise<Credential | undefined> {
    return this.#vault.read(this.#sessionId, providerId)
  }

  list(): Promise<readonly CredentialInfo[]> {
    return this.#vault.list(this.#sessionId)
  }

  modify(
    providerId: string,
    change: (credential: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
    return this.#vault.modify(this.#sessionId, providerId, change)
  }

  delete(providerId: string): Promise<void> {
    return this.#vault.delete(this.#sessionId, providerId)
  }
}
