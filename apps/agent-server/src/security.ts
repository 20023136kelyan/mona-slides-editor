import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Signing for values that cross a trust boundary and come back.
 *
 * Only one caller remains: a photo-search result id, which the agent hands back to
 * the importer. Without a signature that id is a URL the agent chose, and the
 * importer would fetch whatever it named. The credential encryption that used to
 * live here went with the vault - there is no stored credential now, because the
 * Agent SDK authenticates from the machine's own Claude login.
 */

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
