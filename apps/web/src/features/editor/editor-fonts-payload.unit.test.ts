import { describe, expect, it } from 'vitest'

import { extractFontPayload } from '@/features/editor/editor-fonts'

const OPENTYPE = [0x4F, 0x54, 0x54, 0x4F] // "OTTO"
const TRUETYPE = [0x00, 0x01, 0x00, 0x00]

/**
 * Builds the container PowerPoint actually writes: an EOT header whose first
 * two little-endian words are the container length and the font length, with
 * the font itself sitting at their difference.
 */
const eotContainer = (headerLength: number, font: number[]) => {
  const total = headerLength + font.length
  const bytes = new Uint8Array(total)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, total, true)
  view.setUint32(4, font.length, true)
  view.setUint32(8, 0x00020002, true)
  bytes.set(font, headerLength)
  return bytes
}

describe('embedded font payloads', () => {
  it('unwraps the font from a PowerPoint EOT container', () => {
    const payload = extractFontPayload(eotContainer(214, [...OPENTYPE, 9, 9, 9]))

    expect(payload).toBeDefined()
    expect([...payload!.subarray(0, 4)]).toEqual(OPENTYPE)
    expect(payload!.byteLength).toBe(7)
  })

  it('returns a bare font untouched', () => {
    const bare = new Uint8Array([...TRUETYPE, ...new Array(20).fill(7)])

    expect(extractFontPayload(bare)).toBe(bare)
  })

  it('reports a container whose payload it cannot recognise', () => {
    // A compressed EOT payload has no font signature at the offset, and
    // guessing at it would register a broken face that measures wrongly.
    const compressed = eotContainer(214, [0x4D, 0x54, 0x58, 0x00, 1, 2, 3])

    expect(extractFontPayload(compressed)).toBeUndefined()
  })

  it('ignores a part too small to carry a header', () => {
    expect(extractFontPayload(new Uint8Array([1, 2, 3, 4]))).toBeUndefined()
  })
})
