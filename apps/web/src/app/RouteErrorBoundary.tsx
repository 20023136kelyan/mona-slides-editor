import { useTranslation } from 'react-i18next'
import { useRouteError } from 'react-router'

export function RouteErrorBoundary() {
  useRouteError()
  const { t } = useTranslation()

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/30 p-8">
      <section className="flex max-w-md flex-col gap-2 rounded-lg border bg-background p-6 shadow-sm">
        <h1 className="text-lg font-semibold">{t('foundation.errorTitle')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('foundation.errorDescription')}
        </p>
      </section>
    </main>
  )
}
