import { MenuIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useLoaderData } from 'react-router'

import type { PresentationState } from '@mona/presentation-core'

import { Button } from '@/components/ui/button'
import { ReadOnlyDeck } from '@/features/presentation-renderer/ReadOnlyDeck'
import { SettingsMenu } from '@/features/settings/SettingsMenu'

const FOUNDATION_DOCUMENT_TITLE = 'Untitled presentation'

export function FoundationPage() {
  const { t } = useTranslation()
  const presentation = useLoaderData() as PresentationState

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

      <ReadOnlyDeck presentation={presentation} />
    </div>
  )
}
