import AES from 'crypto-js/aes'
import Utf8 from 'crypto-js/enc-utf8'

const NATIVE_FILE_KEY = 'pptist'

export const encryptNativePresentation = (value: string) => AES.encrypt(value, NATIVE_FILE_KEY).toString()

export const decryptNativePresentation = (value: string) => {
  const bytes = AES.decrypt(value, NATIVE_FILE_KEY)
  return bytes.toString(Utf8)
}
