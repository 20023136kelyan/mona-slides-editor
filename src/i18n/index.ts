import { nextTick, type WritableComputedRef } from 'vue'
import { createI18n } from 'vue-i18n'
import enUS from './locales/en-US.json'
import {
  DEFAULT_LOCALE,
  FALLBACK_LOCALE,
  LOCALES,
  LOCALE_STORAGE_KEY,
  detectInitialLocale,
  isSupportedLocale,
  type SupportedLocale,
} from './locales'

export type MessageSchema = typeof enUS

const localeLoaders: Record<SupportedLocale, () => Promise<{ default: MessageSchema }>> = {
  'en-US': () => Promise.resolve({ default: enUS }),
  'zh-CN': () => import('./locales/zh-CN.json') as Promise<{ default: MessageSchema }>,
}

export const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: DEFAULT_LOCALE,
  fallbackLocale: FALLBACK_LOCALE,
  messages: {
    'en-US': enUS,
  },
  missingWarn: import.meta.env.DEV,
  fallbackWarn: import.meta.env.DEV,
})

const loadedLocales = new Set<SupportedLocale>(['en-US'])

const persistLocale = (locale: SupportedLocale) => {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  }
  catch {
    // The locale still works for this session when browser storage is unavailable.
  }
}

const updateDocumentLocale = (locale: SupportedLocale) => {
  const definition = LOCALES.find(item => item.code === locale)
  document.documentElement.lang = locale
  document.documentElement.dir = definition?.direction || 'ltr'
}

export const loadLocale = async (locale: SupportedLocale) => {
  if (loadedLocales.has(locale)) return

  const messages = await localeLoaders[locale]()
  i18n.global.setLocaleMessage(locale, messages.default)
  loadedLocales.add(locale)
}

export const setLocale = async (locale: SupportedLocale) => {
  if (!isSupportedLocale(locale)) return

  await loadLocale(locale)
  const activeLocale = i18n.global.locale as WritableComputedRef<string>
  activeLocale.value = locale
  updateDocumentLocale(locale)
  persistLocale(locale)
  await nextTick()
}

export const initializeLocale = async () => {
  await setLocale(detectInitialLocale())
}

export const translate = (key: string, named?: Record<string, unknown>): string => {
  return named ? i18n.global.t(key, named) : i18n.global.t(key)
}

export { LOCALES, PLANNED_LOCALES, type SupportedLocale } from './locales'
