import { Activity, lazy, startTransition, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { useLoaderData } from 'react-router'

import type { EditorRootState } from '@mona/editor-state'
import type { PresentationState } from '@mona/presentation-core'

import { Button } from '@/components/ui/button'
import { EditorDeck } from '@/features/editor/EditorDeck'
import type { ExportType } from '@/features/editor/EditorExportPopover'
import {
  consumeRestoredDeckFlag,
  discardWorkingDeck,
  initDeckPersistence,
  isPersistenceEnabled,
  type DeckPersistence,
} from '@/features/editor/editor-persistence'
import { preloadDeckFonts } from '@/features/editor/editor-font-preload'
import { EditorFullscreenSpin } from '@/features/editor/EditorFullscreenSpin'
import { useEditorImport } from '@/features/editor/editor-import'
import { createEditorRuntime, type EditorRuntime } from '@/features/editor/editor-runtime'
import { EditorErrorBoundary } from '@/features/editor/EditorErrorBoundary'
import {
  EditorApplicationProvider,
} from '@/features/editor/services/EditorApplicationProvider'
import { EditorNotificationViewport } from '@/features/editor/services/EditorNotificationViewport'
import type { EditorApplication, StartPresentationOptions } from '@/features/editor/services/editor-application'
import { createEditorNotificationService } from '@/features/editor/services/editor-notifications'
import { useEditorSelector } from '@/features/editor/use-editor-selector'
import { isMobileUserAgent } from '@/features/foundation/mobile-device'
import { MobileComingSoon } from '@/features/foundation/MobileComingSoon'

// The slideshow surface is mutually exclusive with the desktop editor.
// Keeping it out of the editor route avoids parsing an interaction system
// the current session cannot use.
const ScreenView = lazy(async () => ({
  default: (await import('@/features/screen/ScreenView')).ScreenView,
}))

interface MonaTestBridge {
  getHistoryState: EditorRuntime['getHistoryState']
  getRichTextState: EditorRuntime['richText']['getSnapshot']
  getShapeFormatPainterState: EditorRuntime['shapeFormatPainter']['getSnapshot']
  getState: () => EditorRootState
  isReady: () => boolean
}

declare global {
  interface Window {
    __MONA_TEST__?: MonaTestBridge
  }
}

interface PersistenceSlot {
  getSnapshot: () => DeckPersistence | null
  set: (value: DeckPersistence | null) => void
  subscribe: (listener: () => void) => () => void
}

const createPersistenceSlot = (): PersistenceSlot => {
  let value: DeckPersistence | null = null
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    set: next => {
      if (next === value) return
      value = next
      for (const listener of listeners) listener()
    },
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export function FoundationPage() {
  const { t } = useTranslation()
  const presentation = useLoaderData() as PresentationState
  const [runtime] = useState(() => createEditorRuntime(presentation))
  const [notifications] = useState(createEditorNotificationService)
  preloadDeckFonts(presentation)
  const { importFiles, importing } = useEditorImport(runtime, t, notifications.notify)
  const [exportType, setExportType] = useState<ExportType | null>(null)
  const [agentDockOpen, setAgentDockOpen] = useState(false)
  const audienceMode = new URLSearchParams(window.location.search).get('mode') === 'audience'
  const [screening, setScreening] = useState(audienceMode)
  const [presentationLaunch, setPresentationLaunch] = useState<Pick<StartPresentationOptions, 'autoPlay' | 'viewMode'>>({})
  const presentationStartListenersRef = useRef(new Set<() => void>())
  const agentReturnFocusRef = useRef<HTMLElement | null>(null)
  const presentationReturnFocusRef = useRef<HTMLElement | null>(null)
  const closeAgent = useCallback(() => {
    const activeElement = document.activeElement
    const meaningfulOutsideFocus = activeElement instanceof HTMLElement
      && activeElement !== document.body
      && !activeElement.closest('.mona-agent-dock')
    const shouldRestoreFocus = !meaningfulOutsideFocus
    setAgentDockOpen(false)
    if (shouldRestoreFocus) {
      requestAnimationFrame(() => {
        const returnTarget = agentReturnFocusRef.current
        if (returnTarget?.isConnected) returnTarget.focus()
      })
    }
  }, [])
  // The export dropdown is a header popover; Radix returns focus to its
  // trigger on close, so no bespoke focus bookkeeping is needed here.
  const closeExport = useCallback(() => setExportType(null), [])
  const openAgent = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      agentReturnFocusRef.current = document.activeElement
    }
    setAgentDockOpen(true)
  }, [])
  const openExport = useCallback((type: ExportType = 'pptx') => setExportType(type), [])
  const subscribeToPresentationStart = useCallback((listener: () => void) => {
    presentationStartListenersRef.current.add(listener)
    return () => presentationStartListenersRef.current.delete(listener)
  }, [])
  const startPresentation = useCallback(({ autoPlay = false, fromStart, viewMode = 'base' }: StartPresentationOptions) => {
    if (document.activeElement instanceof HTMLElement) {
      presentationReturnFocusRef.current = document.activeElement
    }
    for (const listener of presentationStartListenersRef.current) listener()
    if (fromStart) {
      const slides = runtime.store.getState().presentation.slides
      const firstVisible = slides.findIndex(slide => !slide.hidden)
      runtime.focusSlide(firstVisible === -1 ? 0 : firstVisible)
    }
    // Portaled editor surfaces must never float over the presentation.
    setExportType(null)
    setAgentDockOpen(false)
    setPresentationLaunch({ autoPlay, viewMode })
    // Fullscreen remains in the synchronous user-gesture call stack.
    const root = document.documentElement
    if (root.requestFullscreen) void root.requestFullscreen().catch(() => {})
    startTransition(() => setScreening(true))
  }, [runtime])
  const exitPresentation = useCallback(() => startTransition(() => setScreening(false)), [])
  useEffect(() => {
    if (screening || !presentationReturnFocusRef.current) return
    const target = presentationReturnFocusRef.current
    presentationReturnFocusRef.current = null
    requestAnimationFrame(() => target.focus())
  }, [screening])

  // Working-copy autosave. The loader already consulted the slot before this
  // component rendered; here we only stream changes back out and surface the
  // one-time "restored" banner with an escape hatch.
  const [restoredBanner, setRestoredBanner] = useState(() => consumeRestoredDeckFlag())
  const [persistenceSlot] = useState(createPersistenceSlot)
  const persistence = useSyncExternalStore(
    persistenceSlot.subscribe,
    persistenceSlot.getSnapshot,
    persistenceSlot.getSnapshot,
  )
  useEffect(() => {
    if (!isPersistenceEnabled()) return undefined
    const service = initDeckPersistence(runtime)
    persistenceSlot.set(service)
    return () => {
      persistenceSlot.set(null)
      service.stop()
    }
  }, [persistenceSlot, runtime])
  const startFresh = () => {
    void discardWorkingDeck().finally(() => {
      window.location.replace(window.location.pathname)
    })
  }

  // The development/test bridge lives at the page level (not inside the
  // editor tree) so it reflects the runtime store across editor, slideshow,
  // and hidden-<Activity> phases alike.
  useEffect(() => {
    if (!import.meta.env.DEV) return undefined
    const bridge = Object.freeze({
      getHistoryState: runtime.getHistoryState,
      getRichTextState: runtime.richText.getSnapshot,
      getShapeFormatPainterState: runtime.shapeFormatPainter.getSnapshot,
      // Expose a serializable snapshot so browser tests observe the same data
      // shape that crosses a JSON or process boundary.
      getState: () => JSON.parse(JSON.stringify(runtime.store.getState())) as EditorRootState,
      isReady: () => true,
    } satisfies MonaTestBridge)
    window.__MONA_TEST__ = bridge
    return () => {
      if (window.__MONA_TEST__ === bridge) delete window.__MONA_TEST__
    }
  }, [runtime])

  // React 19 hoists <title> into the document head, so the tab tracks the
  // presentation title reactively in every mode.
  const documentTitle = <DocumentTitle runtime={runtime} />
  const application = useMemo<EditorApplication>(() => ({
    agentOpen: agentDockOpen,
    closeAgent,
    closeExport,
    exitPresentation,
    exportType,
    importFiles,
    importing,
    notifications,
    openAgent,
    openExport,
    persistence,
    presenting: screening,
    startPresentation,
    subscribeToPresentationStart,
  }), [
    agentDockOpen,
    closeAgent,
    closeExport,
    exitPresentation,
    exportType,
    importFiles,
    importing,
    notifications,
    openAgent,
    openExport,
    persistence,
    screening,
    startPresentation,
    subscribeToPresentationStart,
  ])

  return (
    <EditorApplicationProvider value={application}>
      {documentTitle}
      {audienceMode ? (
        <Suspense fallback={<EditorFullscreenSpin loading tip={t('common.loading')} />}>
          <EditorErrorBoundary><ScreenView initialAutoPlay={presentationLaunch.autoPlay} initialViewMode={presentationLaunch.viewMode} onExit={exitPresentation} runtime={runtime} /></EditorErrorBoundary>
        </Suspense>
      ) : isMobileUserAgent() ? (
        <MobileComingSoon />
      ) : (
        <>
          {/* Quirk-retirement decision (doc/QUIRK_RETIREMENT.md): the editor
              stays mounted-but-hidden while presenting, so exiting the slideshow
              is instant and open panels/local drafts survive. Contracts locate
              screen surfaces inside the screen root rather than page-wide. */}
          <Activity mode={screening ? 'hidden' : 'visible'}>
            <div
              aria-label={t('foundation.ariaLabel')}
              className="h-svh min-w-0 overflow-hidden bg-muted/30"
            >
              <EditorDeck
                banner={restoredBanner ? (
                  <output className="absolute bottom-37 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2.5 rounded-overlay border bg-popover py-1.5 pr-2.5 pl-3.5 text-sm text-foreground shadow-lg">
                    <span>{t('foundation.restoredWorkingCopy')}</span>
                    <Button className="border-foreground hover:bg-foreground hover:text-background" onClick={startFresh} size="sm" type="button" variant="outline">{t('foundation.startFresh')}</Button>
                    <Button aria-label={t('common.close')} className="text-base text-muted-foreground" onClick={() => setRestoredBanner(false)} size="icon-sm" type="button" variant="ghost">×</Button>
                  </output>
                ) : null}
                presentation={presentation}
                runtime={runtime}
              />
              <EditorFullscreenSpin loading={importing} tip={t('common.importing')} />
            </div>
          </Activity>
          {screening ? (
            <Suspense fallback={<EditorFullscreenSpin loading tip={t('common.loading')} />}>
              <EditorErrorBoundary><ScreenView initialAutoPlay={presentationLaunch.autoPlay} initialViewMode={presentationLaunch.viewMode} onExit={exitPresentation} runtime={runtime} /></EditorErrorBoundary>
            </Suspense>
          ) : null}
        </>
      )}
      <EditorNotificationViewport />
    </EditorApplicationProvider>
  )
}

function DocumentTitle({ runtime }: { runtime: ReturnType<typeof createEditorRuntime> }) {
  const title = useEditorSelector(runtime.store, state => state.presentation.title)
  return <title>{title ? `${title} - Mona` : 'Mona'}</title>
}
