import type enUS from './locales/en-US.json'

type MessageSchema = typeof enUS

declare module 'vue-i18n' {
  export interface DefineLocaleMessage extends MessageSchema {}
}
