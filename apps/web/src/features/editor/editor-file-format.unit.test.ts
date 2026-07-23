import { describe, expect, it } from 'vitest'

import { decryptNativePresentation, encryptNativePresentation } from '@/features/editor/editor-file-format'

describe('Mona native file format', () => {
  it('round-trips page workflow metadata without changing its values', () => {
    const payload = {
      height: 562.5,
      slides: [{
        id: 'slide-1',
        durationMs: 15_000,
        elements: [],
        hidden: true,
        title: 'Opening',
        turningMode: 'fade',
      }],
      title: 'Page metadata fixture',
      width: 1000,
    }
    const encrypted = encryptNativePresentation(JSON.stringify(payload))

    expect(JSON.parse(decryptNativePresentation(encrypted))).toEqual(payload)
  })
})
