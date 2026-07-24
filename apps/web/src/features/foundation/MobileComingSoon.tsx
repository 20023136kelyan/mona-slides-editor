import { useTranslation } from 'react-i18next'
import { Monitor } from 'lucide-react'

// Mobile is intentionally unimplemented for this version: the editor is a
// desktop-only surface, so phones get this notice instead of a degraded
// touch editor. A real mobile experience will be built from scratch later.
export function MobileComingSoon() {
  const { t } = useTranslation()
  return (
    <main className="flex h-svh flex-col items-center justify-center gap-4 bg-muted/30 px-8 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-background text-muted-foreground shadow-sm [&_svg]:size-6">
        <Monitor />
      </div>
      <div className="flex max-w-sm flex-col gap-2">
        <h1 className="text-lg font-semibold text-foreground">{t('mobile.comingSoonTitle')}</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">{t('mobile.comingSoonBody')}</p>
      </div>
    </main>
  )
}
