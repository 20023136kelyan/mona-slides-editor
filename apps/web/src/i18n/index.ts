import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import enUS from '../../../../src/i18n/locales/en-US.json'
import foundationEnUS from '@/i18n/foundation/en-US.json'
import {
  DEFAULT_LOCALE,
  FALLBACK_LOCALE,
  LOCALES,
  LOCALE_STORAGE_KEY,
  detectInitialLocale,
  isSupportedLocale,
  type SupportedLocale,
} from '../../../../src/i18n/locales'

const enUSMessages = { ...enUS, foundation: foundationEnUS }

type MessageSchema = typeof enUSMessages

const localeLoaders: Record<SupportedLocale, () => Promise<{ default: MessageSchema }>> = {
  'en-US': () => Promise.resolve({ default: enUSMessages }),
  'zh-CN': async () => {
    const [shared, foundation] = await Promise.all([
      import('../../../../src/i18n/locales/zh-CN.json'),
      import('@/i18n/foundation/zh-CN.json'),
    ])
    return { default: { ...shared.default, foundation: foundation.default } }
  },
}

const loadedLocales = new Set<SupportedLocale>(['en-US'])

const loadLocale = async (locale: SupportedLocale) => {
  if (loadedLocales.has(locale)) return

  const messages = await localeLoaders[locale]()
  i18n.addResourceBundle(locale, 'translation', messages.default, true, true)
  loadedLocales.add(locale)
}

const updateDocumentLocale = (locale: SupportedLocale) => {
  const definition = LOCALES.find((item) => item.code === locale)
  document.documentElement.lang = locale
  document.documentElement.dir = definition?.direction ?? 'ltr'
}

const persistLocale = (locale: SupportedLocale) => {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  }
  catch {
    // The locale still works for this session when browser storage is unavailable.
  }
}

export const initializeI18n = async () => {
  if (!i18n.isInitialized) {
    const initialLocale = detectInitialLocale()
    const initialResources: Partial<Record<SupportedLocale, { translation: MessageSchema }>> = {
      'en-US': { translation: enUSMessages },
    }

    if (initialLocale !== 'en-US') {
      const messages = await localeLoaders[initialLocale]()
      initialResources[initialLocale] = { translation: messages.default }
      loadedLocales.add(initialLocale)
    }

    await i18n
      .use(initReactI18next)
      .init({
        resources: initialResources,
        lng: initialLocale,
        fallbackLng: FALLBACK_LOCALE,
        supportedLngs: LOCALES.map((locale) => locale.code),
        interpolation: { escapeValue: false },
        returnNull: false,
      })
  }

  const resolvedLanguage = i18n.resolvedLanguage ?? ''
  const activeLocale = isSupportedLocale(resolvedLanguage)
    ? resolvedLanguage
    : DEFAULT_LOCALE
  updateDocumentLocale(activeLocale)

  return i18n
}

export const setLocale = async (locale: SupportedLocale) => {
  await loadLocale(locale)
  await i18n.changeLanguage(locale)
  updateDocumentLocale(locale)
  persistLocale(locale)
}

export { i18n, LOCALES, isSupportedLocale, type SupportedLocale }
