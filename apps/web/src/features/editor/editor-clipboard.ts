import AES from 'crypto-js/aes'
import Utf8 from 'crypto-js/enc-utf8'

import type { PPTElement, Slide } from '@mona/presentation-core/model'

const PPTIST_CLIPBOARD_KEY = 'pptist'

export type EditorClipboardPayload =
  | { data: PPTElement[]; type: 'elements' }
  | { data: Slide[]; type: 'slides' }

const isClipboardPayload = (value: unknown): value is EditorClipboardPayload => {
  if (!value || typeof value !== 'object') return false
  const payload = value as { data?: unknown; type?: unknown }
  return (payload.type === 'elements' || payload.type === 'slides') && Array.isArray(payload.data)
}

export const serializeEditorClipboard = (payload: EditorClipboardPayload): string => (
  AES.encrypt(JSON.stringify(payload), PPTIST_CLIPBOARD_KEY).toString()
)

export const parseCustomEditorClipboard = (text: string): unknown => {
  try {
    const bytes = AES.decrypt(text, PPTIST_CLIPBOARD_KEY)
    const decrypted = bytes.toString(Utf8)
    return JSON.parse(decrypted) as unknown
  }
  catch {
    // Keep ordinary clipboard text byte-for-byte, matching PPTist's fallback.
    return text
  }
}

export const parseEditorClipboard = (text: string): EditorClipboardPayload | string => {
  const payload = parseCustomEditorClipboard(text)
  return isClipboardPayload(payload) ? payload : text
}
