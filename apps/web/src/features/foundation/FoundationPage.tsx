import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLoaderData } from 'react-router'

import type { PresentationState } from '@mona/presentation-core'

import { EditorDeck } from '@/features/editor/EditorDeck'
import { EditorExportFeature } from '@/features/editor/EditorExportFeature'
import type { ExportDialogType } from '@/features/editor/EditorExportDialog'
import { EditorFullscreenSpin } from '@/features/editor/EditorFullscreenSpin'
import { EditorHeader } from '@/features/editor/EditorHeader'
import { useEditorImport } from '@/features/editor/editor-import'
import { createEditorRuntime } from '@/features/editor/editor-runtime'
import { isMobileUserAgent } from '@/features/mobile/mobile-device'
import { MobileView } from '@/features/mobile/MobileView'
import { ScreenView } from '@/features/screen/ScreenView'

export function FoundationPage() {
  const { t } = useTranslation()
  const presentation = useLoaderData() as PresentationState
  const [runtime] = useState(() => createEditorRuntime(presentation))
  const importing = useEditorImport(runtime, t)
  const [exportType, setExportType] = useState<ExportDialogType | null>(null)
  const audienceMode = new URLSearchParams(window.location.search).get('mode') === 'audience'
  const [screening, setScreening] = useState(audienceMode)

  useEffect(() => {
    const openExport = (event: Event) => {
      const detail = (event as CustomEvent<{ type?: ExportDialogType }>).detail
      setExportType(detail?.type || 'pptx')
    }
    window.addEventListener('mona:export-request', openExport)
    return () => window.removeEventListener('mona:export-request', openExport)
  }, [])

  useEffect(() => {
    const openScreen = (event: Event) => {
      const detail = (event as CustomEvent<{ fromStart?: boolean }>).detail
      if (detail?.fromStart) runtime.focusSlide(0)
      const root = document.documentElement
      if (root.requestFullscreen) void root.requestFullscreen().catch(() => {})
      setScreening(true)
    }
    window.addEventListener('mona:screening-request', openScreen)
    return () => window.removeEventListener('mona:screening-request', openScreen)
  }, [runtime])

  if (screening) return <ScreenView onExit={() => setScreening(false)} runtime={runtime} />
  if (isMobileUserAgent()) return <MobileView runtime={runtime} />

  return (
    <div
      aria-label={t('foundation.ariaLabel')}
      className="grid h-svh min-w-[960px] grid-rows-[40px_minmax(0,1fr)] overflow-hidden bg-muted/30"
    >
      <EditorHeader runtime={runtime} />
      <EditorDeck presentation={presentation} runtime={runtime} />
      <EditorFullscreenSpin loading={importing} tip={t('common.importing')} />
      {exportType ? <EditorExportFeature onClose={() => setExportType(null)} openType={exportType} runtime={runtime} /> : null}
    </div>
  )
}
