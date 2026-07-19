import { MenuIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { SettingsMenu } from '@/features/settings/SettingsMenu'

const FOUNDATION_DOCUMENT_TITLE = 'Untitled presentation'

export function FoundationPage() {
  const { t } = useTranslation()

  return (
    <div
      aria-label={t('foundation.ariaLabel')}
      className="grid h-svh min-w-[960px] grid-rows-[40px_1fr] overflow-hidden bg-muted/30"
    >
      <header className="flex items-center justify-between border-b bg-background px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Button aria-label="Menu" size="icon-sm" variant="ghost">
            <MenuIcon aria-hidden="true" />
          </Button>
          <span className="truncate text-sm font-medium">
            {FOUNDATION_DOCUMENT_TITLE}
          </span>
        </div>
        <SettingsMenu />
      </header>

      <main className="grid min-h-0 grid-cols-[160px_1fr_260px]">
        <aside aria-label="Slides" className="border-r bg-background" />
        <section className="flex min-w-0 items-center justify-center overflow-hidden p-8">
          <div className="flex aspect-video w-full max-w-[1000px] flex-col items-center justify-center gap-2 rounded-sm border bg-background shadow-sm">
            <p className="text-sm font-medium">{t('foundation.status')}</p>
            <p className="text-sm text-muted-foreground">
              {t('foundation.referenceNotice')}
            </p>
          </div>
        </section>
        <aside aria-label="Inspector" className="border-l bg-background" />
      </main>
    </div>
  )
}
