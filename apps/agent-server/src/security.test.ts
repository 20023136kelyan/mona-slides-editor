import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { decodeSignedValue, encodeSignedValue } from './security.js'

describe('signed values', () => {
  it('round-trips a value the holder of the key signed', () => {
    const key = randomBytes(32)
    const signed = encodeSignedValue('pexels:1234', key)

    expect(signed).not.toBe('pexels:1234')
    expect(decodeSignedValue(signed, key)).toBe('pexels:1234')
  })

  it('rejects a value signed with a different key', () => {
    // The point of the signature: an id the agent supplies must be one we issued,
    // or the importer would fetch whatever URL it names.
    const signed = encodeSignedValue('pexels:1234', randomBytes(32))

    expect(decodeSignedValue(signed, randomBytes(32))).toBeUndefined()
  })

  it('rejects a tampered payload', () => {
    const key = randomBytes(32)
    const signed = encodeSignedValue('pexels:1234', key)
    const [, signature] = signed.split('.')

    expect(decodeSignedValue(`${Buffer.from('pexels:9999').toString('base64url')}.${signature}`, key))
      .toBeUndefined()
  })

  it('rejects malformed input rather than throwing', () => {
    const key = randomBytes(32)
    for (const value of ['', 'nodot', 'a.b.c', '...']) {
      expect(decodeSignedValue(value, key)).toBeUndefined()
    }
  })
})
