import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'

export interface EncryptedEnvelope {
  ciphertext: string
  iv: string
  tag: string
  version: 1
}

export const encryptJson = (value: unknown, key: Buffer): EncryptedEnvelope => {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ])
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    version: 1,
  }
}

export const decryptJson = <Value>(envelope: EncryptedEnvelope, key: Buffer): Value => {
  if (envelope.version !== 1) throw new Error('Unsupported encrypted credential format')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
  const cleartext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final(),
  ])
  return JSON.parse(cleartext.toString('utf8')) as Value
}

export const signOpaqueValue = (value: string, key: Buffer): string => (
  createHmac('sha256', key).update(value).digest('base64url')
)

export const encodeSignedValue = (value: string, key: Buffer): string => (
  `${Buffer.from(value, 'utf8').toString('base64url')}.${signOpaqueValue(value, key)}`
)

export const decodeSignedValue = (signed: string, key: Buffer): string | undefined => {
  const separator = signed.lastIndexOf('.')
  if (separator < 1) return undefined
  let value: string
  try {
    value = Buffer.from(signed.slice(0, separator), 'base64url').toString('utf8')
  }
  catch {
    return undefined
  }
  const supplied = Buffer.from(signed.slice(separator + 1), 'utf8')
  const expected = Buffer.from(signOpaqueValue(value, key), 'utf8')
  if (supplied.byteLength !== expected.byteLength || !timingSafeEqual(supplied, expected)) return undefined
  return value
}

export const isSafeIdentifier = (value: string): boolean => /^[A-Za-z0-9_-]{12,160}$/.test(value)
