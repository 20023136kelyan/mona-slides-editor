import { LanguagesIcon, SettingsIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  LOCALES,
  isSupportedLocale,
  setLocale,
  type SupportedLocale,
} from '@/i18n'

export function SettingsMenu() {
  const { i18n, t } = useTranslation()
  const resolvedLanguage = i18n.resolvedLanguage ?? ''
  const activeLocale: SupportedLocale = isSupportedLocale(resolvedLanguage)
    ? resolvedLanguage
    : 'en-US'

  const handleLocaleChange = (locale: string) => {
    if (isSupportedLocale(locale)) void setLocale(locale)
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          aria-label={t('header.settings')}
          size="icon-sm"
          variant="ghost"
        >
          <SettingsIcon aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <PopoverHeader>
          <PopoverTitle className="flex items-center gap-2">
            <SettingsIcon aria-hidden="true" />
            {t('header.settings')}
          </PopoverTitle>
        </PopoverHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-muted-foreground">
            <LanguagesIcon aria-hidden="true" />
            <span>{t('locale.language')}</span>
          </div>
          <Select value={activeLocale} onValueChange={handleLocaleChange}>
            <SelectTrigger aria-label={t('locale.language')} size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end" position="popper">
              <SelectGroup>
                {LOCALES.map((locale) => (
                  <SelectItem key={locale.code} value={locale.code}>
                    {t(locale.labelKey)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </PopoverContent>
    </Popover>
  )
}
