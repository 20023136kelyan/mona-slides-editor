export const SUPPORTED_LOCALES = ['en-US', 'zh-CN'] as const

export type SupportedLocale = typeof SUPPORTED_LOCALES[number]

export interface LocaleDefinition {
  code: SupportedLocale
  labelKey: string
  direction: 'ltr' | 'rtl'
}

export const LOCALES: LocaleDefinition[] = [
  { code: 'en-US', labelKey: 'locale.english', direction: 'ltr' },
  { code: 'zh-CN', labelKey: 'locale.simplifiedChinese', direction: 'ltr' },
]

export const PLANNED_LOCALES = [
  { code: 'fr-FR', englishName: 'French' },
  { code: 'es-ES', englishName: 'Spanish' },
  { code: 'it-IT', englishName: 'Italian' },
  { code: 'de-DE', englishName: 'German' },
  { code: 'ja-JP', englishName: 'Japanese' },
] as const

export const DEFAULT_LOCALE: SupportedLocale = 'en-US'
export const FALLBACK_LOCALE: SupportedLocale = 'en-US'
export const LOCALE_STORAGE_KEY = 'mona:ui-locale'

const localeAliases: Record<string, SupportedLocale> = {
  en: 'en-US',
  'en-us': 'en-US',
  'en-gb': 'en-US',
  'en-au': 'en-US',
  zh: 'zh-CN',
  'zh-cn': 'zh-CN',
  'zh-sg': 'zh-CN',
  'zh-hans': 'zh-CN',
}

export const isSupportedLocale = (locale: string): locale is SupportedLocale => {
  return SUPPORTED_LOCALES.includes(locale as SupportedLocale)
}

export const matchSupportedLocale = (locale: string): SupportedLocale | null => {
  if (!locale) return null
  if (isSupportedLocale(locale)) return locale

  const normalized = locale.toLowerCase()
  if (localeAliases[normalized]) return localeAliases[normalized]

  const language = normalized.split('-')[0]
  return localeAliases[language] || null
}

const readSavedLocale = (): SupportedLocale | null => {
  try {
    return matchSupportedLocale(localStorage.getItem(LOCALE_STORAGE_KEY) || '')
  }
  catch {
    return null
  }
}

export const detectInitialLocale = (): SupportedLocale => {
  const savedLocale = readSavedLocale()
  if (savedLocale) return savedLocale

  for (const browserLocale of navigator.languages || [navigator.language]) {
    const locale = matchSupportedLocale(browserLocale)
    if (locale) return locale
  }

  return DEFAULT_LOCALE
}
