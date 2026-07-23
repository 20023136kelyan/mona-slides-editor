import AES from 'crypto-js/aes'
import Utf8 from 'crypto-js/enc-utf8'

import type { PPTElement, Slide } from '@mona/presentation-core/model'

import { LEGACY_PRESENTATION_ENCRYPTION_KEY } from '@/lib/legacy-compatibility'

const MONA_CLIPBOARD_KEY = 'mona'

export type EditorClipboardPayload =
  | { data: PPTElement[]; type: 'elements' }
  | { data: Slide[]; type: 'slides' }

const isClipboardPayload = (value: unknown): value is EditorClipboardPayload => {
  if (!value || typeof value !== 'object') return false
  const payload = value as { data?: unknown; type?: unknown }
  return (payload.type === 'elements' || payload.type === 'slides') && Array.isArray(payload.data)
}

export const serializeEditorClipboard = (payload: EditorClipboardPayload): string => (
  AES.encrypt(JSON.stringify(payload), MONA_CLIPBOARD_KEY).toString()
)

export const parseCustomEditorClipboard = (text: string): unknown => {
  for (const key of [MONA_CLIPBOARD_KEY, LEGACY_PRESENTATION_ENCRYPTION_KEY]) {
    try {
      const decrypted = AES.decrypt(text, key).toString(Utf8)
      if (decrypted) return JSON.parse(decrypted) as unknown
    }
    catch {
      // Try the next supported clipboard format.
    }
  }
  // Keep ordinary clipboard text byte-for-byte as the fallback.
  return text
}

export const parseEditorClipboard = (text: string): EditorClipboardPayload | string => {
  const payload = parseCustomEditorClipboard(text)
  return isClipboardPayload(payload) ? payload : text
}
