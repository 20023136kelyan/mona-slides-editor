import AES from 'crypto-js/aes'
import { describe, expect, it } from 'vitest'

import {
  parseEditorClipboard,
  serializeEditorClipboard,
  type EditorClipboardPayload,
} from '@/features/editor/editor-clipboard'
import {
  decryptNativePresentation,
  encryptNativePresentation,
} from '@/features/editor/editor-file-format'
import { LEGACY_PRESENTATION_ENCRYPTION_KEY } from '@/lib/legacy-compatibility'

describe('Mona native-format compatibility', () => {
  it('round-trips files written with the current Mona format', () => {
    const presentation = JSON.stringify({ slides: [], title: 'Mona fixture' })
    expect(decryptNativePresentation(encryptNativePresentation(presentation))).toBe(presentation)
  })

  it('opens files encrypted with the legacy native-format key', () => {
    const presentation = JSON.stringify({ slides: [], title: 'Legacy fixture' })
    const encrypted = AES.encrypt(presentation, LEGACY_PRESENTATION_ENCRYPTION_KEY).toString()
    expect(decryptNativePresentation(encrypted)).toBe(presentation)
  })

  it('reads both current and legacy clipboard payloads', () => {
    const payload: EditorClipboardPayload = { data: [], type: 'elements' }
    expect(parseEditorClipboard(serializeEditorClipboard(payload))).toEqual(payload)

    const legacy = AES.encrypt(JSON.stringify(payload), LEGACY_PRESENTATION_ENCRYPTION_KEY).toString()
    expect(parseEditorClipboard(legacy)).toEqual(payload)
  })
})
