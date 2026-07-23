import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { EncryptedFileCredentialVault } from './credential-vault.js'
import {
  decodeSignedValue,
  decryptJson,
  encodeSignedValue,
  encryptJson,
} from './security.js'

describe('agent server secret handling', () => {
  it('encrypts credential JSON with authenticated encryption', () => {
    const key = randomBytes(32)
    const source = { token: 'credential-that-must-not-be-cleartext' }
    const envelope = encryptJson(source, key)
    expect(JSON.stringify(envelope)).not.toContain(source.token)
    expect(decryptJson(envelope, key)).toEqual(source)
    expect(() => decryptJson(envelope, randomBytes(32))).toThrow()
  })

  it('signs opaque browser values and rejects tampering', () => {
    const key = randomBytes(32)
    const signed = encodeSignedValue('session-id', key)
    expect(decodeSignedValue(signed, key)).toBe('session-id')
    expect(decodeSignedValue(`${signed}x`, key)).toBeUndefined()
  })

  it('persists OAuth credentials without cleartext secrets', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mona-agent-vault-'))
    const file = join(directory, 'credentials.enc.json')
    const key = randomBytes(32)
    const vault = new EncryptedFileCredentialVault(file, key)
    await vault.modify('session', 'openai-codex', async () => ({
      access: 'secret-access-token',
      expires: Date.now() + 60_000,
      refresh: 'secret-refresh-token',
      type: 'oauth',
    }))
    const persisted = await readFile(file, 'utf8')
    expect(persisted).not.toContain('secret-access-token')
    expect(persisted).not.toContain('secret-refresh-token')

    const restored = new EncryptedFileCredentialVault(file, key)
    expect(await restored.read('session', 'openai-codex')).toMatchObject({
      access: 'secret-access-token',
      type: 'oauth',
    })
    await restored.delete('session', 'openai-codex')
    expect(await restored.read('session', 'openai-codex')).toBeUndefined()
  })
})
