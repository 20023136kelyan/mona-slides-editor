import { useTranslation } from 'react-i18next'

export function RouteHydrateFallback() {
  const { t } = useTranslation()

  return (
    <main
      aria-busy="true"
      className="flex min-h-svh items-center justify-center bg-muted/30 text-sm text-muted-foreground"
    >
      {t('common.loading')}
    </main>
  )
}
