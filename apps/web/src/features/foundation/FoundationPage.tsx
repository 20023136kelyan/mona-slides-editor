import { lazy, startTransition, Suspense, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLoaderData } from 'react-router'

import type { PresentationState } from '@mona/presentation-core'

import { EditorDeck } from '@/features/editor/EditorDeck'
import type { ExportDialogType } from '@/features/editor/EditorExportDialog'
import { preloadDeckFonts } from '@/features/editor/editor-font-preload'
import { EditorFullscreenSpin } from '@/features/editor/EditorFullscreenSpin'
import { EditorHeader } from '@/features/editor/EditorHeader'
import { useEditorImport } from '@/features/editor/editor-import'
import { createEditorRuntime } from '@/features/editor/editor-runtime'
import { EditorErrorBoundary } from '@/features/editor/EditorErrorBoundary'
import { useEditorSelector } from '@/features/editor/use-editor-selector'
import { isMobileUserAgent } from '@/features/mobile/mobile-device'
import { MobileView } from '@/features/mobile/MobileView'
import { ScreenView } from '@/features/screen/ScreenView'

// The export stack (pptxgenjs, html-to-image) loads on first use, keeping it
// out of the editor's critical path.
const EditorExportFeature = lazy(async () => ({
  default: (await import('@/features/editor/EditorExportFeature')).EditorExportFeature,
}))

export function FoundationPage() {
  const { t } = useTranslation()
  const presentation = useLoaderData() as PresentationState
  const [runtime] = useState(() => createEditorRuntime(presentation))
  preloadDeckFonts(presentation)
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
      // Fullscreen must stay in the synchronous part of the user gesture.
      if (root.requestFullscreen) void root.requestFullscreen().catch(() => {})
      startTransition(() => setScreening(true))
    }
    window.addEventListener('mona:screening-request', openScreen)
    return () => window.removeEventListener('mona:screening-request', openScreen)
  }, [runtime])

  const exitScreening = () => startTransition(() => setScreening(false))

  // React 19 hoists <title> into the document head, so the tab tracks the
  // presentation title reactively in every mode.
  const documentTitle = <DocumentTitle runtime={runtime} />

  // Audience popups never need the editor tree at all.
  if (audienceMode) return <>{documentTitle}<EditorErrorBoundary><ScreenView onExit={exitScreening} runtime={runtime} /></EditorErrorBoundary></>
  if (isMobileUserAgent()) return <>{documentTitle}<MobileView runtime={runtime} /></>

  // Deliberately conditional (not <Activity mode="hidden">): the gate-6
  // slideshow contracts — like Vue — require the editor DOM to be absent
  // while presenting (a hidden editor duplicates video/media/thumbnail nodes
  // that the contracts and rasters locate). Revisit at quirk-retirement time.
  if (screening) return <>{documentTitle}<EditorErrorBoundary><ScreenView onExit={exitScreening} runtime={runtime} /></EditorErrorBoundary></>

  return (
    <>
      {documentTitle}
      <div
        aria-label={t('foundation.ariaLabel')}
        className="grid h-svh min-w-[960px] grid-rows-[40px_minmax(0,1fr)] overflow-hidden bg-muted/30"
      >
        <EditorHeader runtime={runtime} />
        <EditorDeck presentation={presentation} runtime={runtime} />
        <EditorFullscreenSpin loading={importing} tip={t('common.importing')} />
        {exportType ? <Suspense fallback={null}><EditorExportFeature onClose={() => setExportType(null)} openType={exportType} runtime={runtime} /></Suspense> : null}
      </div>
    </>
  )
}

function DocumentTitle({ runtime }: { runtime: ReturnType<typeof createEditorRuntime> }) {
  const title = useEditorSelector(runtime.store, state => state.presentation.title)
  return <title>{title ? `${title} - Mona Slides` : 'Mona Slides'}</title>
}
