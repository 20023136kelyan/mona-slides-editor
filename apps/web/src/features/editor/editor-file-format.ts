import AES from 'crypto-js/aes'
import Utf8 from 'crypto-js/enc-utf8'

import { LEGACY_PRESENTATION_ENCRYPTION_KEY } from '@/lib/legacy-compatibility'

const MONA_NATIVE_FILE_KEY = 'mona'

const decryptWithKey = (value: string, key: string) => {
  try {
    return AES.decrypt(value, key).toString(Utf8)
  }
  catch {
    return ''
  }
}

export const encryptNativePresentation = (value: string) => AES.encrypt(value, MONA_NATIVE_FILE_KEY).toString()

export const decryptNativePresentation = (value: string) => {
  const current = decryptWithKey(value, MONA_NATIVE_FILE_KEY)
  return current || decryptWithKey(value, LEGACY_PRESENTATION_ENCRYPTION_KEY)
}
