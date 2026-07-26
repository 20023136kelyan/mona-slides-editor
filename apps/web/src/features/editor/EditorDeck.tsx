/* oxlint-disable jsx-a11y/prefer-tag-over-role -- the shadcn Sidebar primitives render divs; landmark roles are applied explicitly on them. */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { editorActions, selectCurrentSlide, selectPresentation, selectSession } from '@mona/editor-state'
import type { EditorToolbarState } from '@mona/editor-state'
import { createPresentationId, DEFAULT_TEMPLATE_CATALOG, DEFAULT_TEMPLATE_PROVIDERS, type PresentationState } from '@mona/presentation-core'
import type { PPTAudioElement, PPTChartElement, PPTImageElement, PPTLatexElement, PPTLineElement, PPTShapeElement, PPTTableElement, PPTTextElement, PPTVideoElement } from '@mona/presentation-core/model'


import { SidebarContent, SidebarHeader, SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EditorCanvas } from '@/features/editor/EditorCanvas'
import { EditorContextToolbar } from '@/features/editor/EditorContextToolbar'
import { EditorHeader, EditorSkipLink } from '@/features/editor/EditorHeader'
import { EditorPageGrid } from '@/features/editor/EditorPageGrid'
import { EditorPanelContext, type EditorPanelContextValue } from '@/features/editor/panel/editor-panel-context'
import { EDITOR_PANEL_REGISTRY } from '@/features/editor/panel/editor-panel-registry'
import { PanelBody, PanelChrome } from '@/features/editor/panel/EditorPanelPrimitives'
import { EditorRail } from '@/features/editor/EditorRailNavigation'
import { EditorStatusBar } from '@/features/editor/EditorStatusBar'
import { createEditorRuntime, type EditorRuntime } from '@/features/editor/editor-runtime'
import { useEdgeFade } from '@/features/editor/use-edge-fade'
import { useEditorSelector } from '@/features/editor/use-editor-selector'
import type { EditorCreateTool } from '@/features/editor/editor-create-tool'
import { fitImageToPresentation, getImageSize } from '@/features/editor/editor-image'
import { createTableElement } from '@/features/editor/editor-table'
import { createChartElement, type CreateChartElementOptions } from '@/features/editor/editor-chart'
import type { LatexRenderResult } from '@/features/editor/editor-latex'
import { createLatexElement } from '@/features/editor/editor-latex-element'
import { EditorErrorBoundary } from '@/features/editor/EditorErrorBoundary'
import { EditorThumbnails } from '@/features/editor/EditorThumbnails'
import { EditorRemark } from '@/features/editor/EditorRemark'
import { createDrawingStore } from '@/features/editor/drawing/drawing-store'
import type { SketchAgentHandoff } from '@/features/editor/drawing/drawing-serialization'
import { isPersistenceEnabled } from '@/features/editor/editor-persistence'
import { useEditorApplication } from '@/features/editor/services/editor-application'
import { EditorShellProvider } from '@/features/editor/shell/EditorShellProvider'
import { useEditorShell, type EditorElementCategory, type EditorTaskPanelRoute } from '@/features/editor/shell/editor-shell'

const EditorAgentDock = lazy(async () => {
  const module = await import('@/features/editor/EditorAgentDock')
  return { default: module.EditorAgentDock }
})
const EditorRailDrawer = lazy(async () => ({
  default: (await import('@/features/editor/EditorRail')).EditorRailDrawer,
}))

// Closed task panels and modal editors do not participate in the canvas'
// first paint. Each feature loads at its real entry point, keeping behavior
// colocated while avoiding one monolithic desktop-editor chunk.
// Related panels share a dynamic entry so the browser fetches one deferred
// feature bundle instead of dozens of tiny shared icon/helper chunks.
const loadInspectorPanels = () => import('@/features/editor/EditorInspectorPanels')
const loadSecondarySurfaces = () => import('@/features/editor/EditorSecondarySurfaces')
const AudioStylePanel = lazy(async () => ({ default: (await loadInspectorPanels()).AudioStylePanel }))
const ChartStylePanel = lazy(async () => ({ default: (await loadInspectorPanels()).ChartStylePanel }))
const ElementAnimationPanel = lazy(async () => ({ default: (await loadInspectorPanels()).ElementAnimationPanel }))
const ElementPositionPanel = lazy(async () => ({ default: (await loadInspectorPanels()).ElementPositionPanel }))
const ImageStylePanel = lazy(async () => ({ default: (await loadInspectorPanels()).ImageStylePanel }))
const LatexStylePanel = lazy(async () => ({ default: (await loadInspectorPanels()).LatexStylePanel }))
const LineStylePanel = lazy(async () => ({ default: (await loadInspectorPanels()).LineStylePanel }))
const MultiPositionPanel = lazy(async () => ({ default: (await loadInspectorPanels()).MultiPositionPanel }))
const MultiStylePanel = lazy(async () => ({ default: (await loadInspectorPanels()).MultiStylePanel }))
const ShapeStylePanel = lazy(async () => ({ default: (await loadInspectorPanels()).ShapeStylePanel }))
const SlideAnimationPanel = lazy(async () => ({ default: (await loadInspectorPanels()).SlideAnimationPanel }))
const SlideDesignPanel = lazy(async () => ({ default: (await import('@/features/editor/SlideDesignPanel')).SlideDesignPanel }))
const TableStylePanel = lazy(async () => ({ default: (await loadInspectorPanels()).TableStylePanel }))
const TextStylePanel = lazy(async () => ({ default: (await loadInspectorPanels()).TextStylePanel }))
const VideoStylePanel = lazy(async () => ({ default: (await loadInspectorPanels()).VideoStylePanel }))
const EditorChartDataEditor = lazy(async () => ({ default: (await loadSecondarySurfaces()).EditorChartDataEditor }))
const EditorCommentsPanel = lazy(async () => ({ default: (await loadSecondarySurfaces()).EditorCommentsPanel }))
const EditorLatexEditor = lazy(async () => ({ default: (await import('@/features/editor/EditorLatexEditor')).EditorLatexEditor }))
const EditorLayersPanel = lazy(async () => ({ default: (await loadSecondarySurfaces()).EditorLayersPanel }))
const EditorSearchPanel = lazy(async () => ({ default: (await loadSecondarySurfaces()).EditorSearchPanel }))
const EditorSemanticsPanel = lazy(async () => ({ default: (await loadSecondarySurfaces()).EditorSemanticsPanel }))
const EditorSvgPathEditor = lazy(async () => ({ default: (await loadSecondarySurfaces()).EditorSvgPathEditor }))

interface EditorDeckProps {
  banner?: ReactNode
  presentation: PresentationState
  runtime?: EditorRuntime
}

// A side-panel region whose *width* animates open/closed, so the canvas (its
// flex sibling) resizes continuously instead of snapping. The fixed-width panel
// sits inside, clipped, so its content never squishes; the panel stays mounted
// through the closing transition, then unmounts on transitionend.
function CollapsiblePanelRegion({ children, className, open }: {
  children: ReactNode
  className: string
  open: boolean
}) {
  const [rendered, setRendered] = useState(open)
  useEffect(() => {
    if (open) {
      setRendered(true)
      return undefined
    }
    // If width never transitions (e.g. reduced-motion / already closed), still
    // unmount after the nominal animation window so close is not stuck.
    const timeout = window.setTimeout(() => setRendered(false), 280)
    return () => window.clearTimeout(timeout)
  }, [open])
  return (
    <div
      className={className}
      data-open={open ? 'true' : undefined}
      onTransitionEnd={event => {
        if (event.target === event.currentTarget && event.propertyName === 'width' && !open) setRendered(false)
      }}
    >
      {/* Mount immediately on open (so panel effects attach without a frame's
          delay); keep mounted through the closing width transition. */}
      {open || rendered ? children : null}
    </div>
  )
}

export function EditorDeck(props: EditorDeckProps) {
  return (
    <EditorShellProvider>
      <EditorDeckContent {...props} />
    </EditorShellProvider>
  )
}

function EditorDeckContent({
  banner,
  presentation: initialPresentation,
  runtime: externalRuntime,
}: EditorDeckProps) {
  const { t } = useTranslation()
  const {
    agentOpen,
    openAgent,
    startPresentation,
    subscribeToPresentationStart,
  } = useEditorApplication()
  const {
    closeTaskPanel,
    openTaskPanel,
    taskPanelRoute,
    toggleTaskPanel,
  } = useEditorShell()
  const [ownedRuntime] = useState(() => externalRuntime ?? createEditorRuntime(initialPresentation))
  const runtime = externalRuntime ?? ownedRuntime
  const [createTool, setCreateTool] = useState<EditorCreateTool | null>(null)
  // Owned here because the rail selects the pool and the drawer renders it.
  const [elementCategory, setElementCategory] = useState<EditorElementCategory>('shapes')
  const [pathEditorOpen, setPathEditorOpen] = useState(false)
  const [editingChartId, setEditingChartId] = useState<string | null>(null)
  const [latexEditorTarget, setLatexEditorTarget] = useState<{ id: string; kind: 'edit' } | { kind: 'create' } | null>(null)
  const [agentSketchHandoff, setAgentSketchHandoff] = useState<SketchAgentHandoff | null>(null)
  const [drawingStore] = useState(() => createDrawingStore({
    persistenceEnabled: isPersistenceEnabled(),
  }))

  useEffect(() => {
    void drawingStore.hydrate()
    return () => {
      void drawingStore.stop()
    }
  }, [drawingStore])

  useEffect(() => {
    let slideIds = new Set(runtime.store.getState().presentation.slides.map(slide => slide.id))
    drawingStore.prune(slideIds)
    return runtime.store.subscribe(() => {
      const nextSlideIds = new Set(runtime.store.getState().presentation.slides.map(slide => slide.id))
      if (
        nextSlideIds.size === slideIds.size
        && [...nextSlideIds].every(id => slideIds.has(id))
      ) return
      slideIds = nextSlideIds
      drawingStore.prune(slideIds)
    })
  }, [drawingStore, runtime])

  // Portaled modals escape the hidden <Activity> wrapper during slideshows;
  // close them when screening starts.
  useEffect(() => {
    return subscribeToPresentationStart(() => {
      setPathEditorOpen(false)
      setEditingChartId(null)
      setLatexEditorTarget(null)
      runtime.store.dispatch(editorActions.drawingModeChanged(false))
      closeTaskPanel({ restoreFocus: false })
    })
  }, [closeTaskPanel, runtime, subscribeToPresentationStart])

  const presentation = useEditorSelector(runtime.store, selectPresentation)
  const currentSlide = useEditorSelector(runtime.store, selectCurrentSlide)
  const session = useEditorSelector(runtime.store, selectSession)
  const handleElement = currentSlide?.elements.find(element => element.id === session.handleElementId)
  const handleImage = currentSlide?.elements.find((element): element is PPTImageElement => (
    element.id === session.handleElementId && element.type === 'image'
  ))
  const handleText = currentSlide?.elements.find((element): element is PPTTextElement => (
    element.id === session.handleElementId && element.type === 'text'
  ))
  const handleShape = currentSlide?.elements.find((element): element is PPTShapeElement => (
    element.id === session.handleElementId && element.type === 'shape'
  ))
  const handleLine = currentSlide?.elements.find((element): element is PPTLineElement => (
    element.id === session.handleElementId && element.type === 'line'
  ))
  const handleTable = currentSlide?.elements.find((element): element is PPTTableElement => (
    element.id === session.handleElementId && element.type === 'table'
  ))
  const handleChart = currentSlide?.elements.find((element): element is PPTChartElement => (
    element.id === session.handleElementId && element.type === 'chart'
  ))
  const handleLatex = currentSlide?.elements.find((element): element is PPTLatexElement => (
    element.id === session.handleElementId && element.type === 'latex'
  ))
  const handleAudio = currentSlide?.elements.find((element): element is PPTAudioElement => (
    element.id === session.handleElementId && element.type === 'audio'
  ))
  const handleVideo = currentSlide?.elements.find((element): element is PPTVideoElement => (
    element.id === session.handleElementId && element.type === 'video'
  ))
  const editingChart = currentSlide?.elements.find((element): element is PPTChartElement => (
    element.id === editingChartId && element.type === 'chart'
  ))
  const editingLatex = latexEditorTarget?.kind === 'edit'
    ? currentSlide?.elements.find((element): element is PPTLatexElement => element.id === latexEditorTarget.id && element.type === 'latex')
    : undefined
  const currentTabs = useMemo<Array<{ key: EditorToolbarState; label: string }>>(() => (
    session.activeElementIds.length === 0
      ? [
        { key: 'slideDesign', label: t('foundation.editor.toolbar.design') },
        { key: 'slideAnimation', label: t('foundation.editor.toolbar.transition') },
        { key: 'elAnimation', label: t('foundation.editor.text.animation') },
      ]
      : session.activeElementIds.length > 1 && !session.activeGroupElementId
        ? [
          { key: 'multiStyle', label: t('foundation.editor.toolbar.multiStyle') },
          { key: 'multiPosition', label: t('foundation.editor.toolbar.multiPosition') },
          { key: 'elAnimation', label: t('foundation.editor.text.animation') },
        ]
        : [
          { key: 'elStyle', label: t('foundation.editor.text.style') },
          { key: 'elPosition', label: t('foundation.editor.text.position') },
          { key: 'elAnimation', label: t('foundation.editor.text.animation') },
        ]
  ), [session.activeElementIds.length, session.activeGroupElementId, t])
  const openSpeakerNotes = useCallback(() => {
    openTaskPanel('speakerNotes')
  }, [openTaskPanel])
  const startSlideshow = useCallback((fromCurrent: boolean) => {
    startPresentation({ fromStart: !fromCurrent })
  }, [startPresentation])

  useEffect(() => {
    if (currentTabs.some(tab => tab.key === session.toolbarState)) return
    runtime.store.dispatch(editorActions.toolbarStateChanged(currentTabs[0]!.key))
  }, [currentTabs, runtime, session.toolbarState])

  const railPanel = taskPanelRoute
  // Routes whose panel is rendered as `secondaryContent` inside the drawer
  // rather than by the drawer's own branches.
  const SECONDARY_PANEL_ROUTES = ['comments', 'layers', 'search', 'semantics', 'speakerNotes'] as const
  const changeRailPanel = useCallback((panel: EditorTaskPanelRoute | null, trigger?: HTMLElement | null) => {
    if (panel) {
      runtime.store.dispatch(editorActions.drawingModeChanged(false))
      openTaskPanel(panel, trigger)
    }
    else closeTaskPanel()
  }, [closeTaskPanel, openTaskPanel, runtime])

  const openContextualInspector = useCallback((toolbarState: EditorToolbarState) => {
    runtime.store.dispatch(editorActions.toolbarStateChanged(toolbarState))
    openTaskPanel('properties')
  }, [openTaskPanel, runtime])
  const inspectorScrollRef = useRef<HTMLDivElement>(null)
  // Fade the top/bottom edge wherever inspector content is cut off.
  useEdgeFade(inspectorScrollRef, 'y', `${railPanel}:${session.toolbarState}:${session.handleElementId ?? ''}`)
  const drawerOpen = Boolean(railPanel)
  // The border pill CLOSES the panel outright — nothing is kept in the
  // background to restore, so it only renders while a panel is open.
  const closeDrawer = () => {
    closeTaskPanel()
  }

  useEffect(() => runtime.store.subscribe(() => {
    setEditingChartId(current => {
      if (!current) return current
      const state = runtime.store.getState()
      const slide = state.presentation.slides[state.presentation.slideIndex]
      return slide?.elements.some(element => element.id === current && element.type === 'chart') ? current : null
    })
    setLatexEditorTarget(current => {
      if (!current || current.kind === 'create') return current
      const state = runtime.store.getState()
      const slide = state.presentation.slides[state.presentation.slideIndex]
      return slide?.elements.some(element => element.id === current.id && element.type === 'latex') ? current : null
    })
  }), [runtime])

  const previousSelectionRef = useRef(session.activeElementIds)
  useEffect(() => {
    const previous = previousSelectionRef.current
    previousSelectionRef.current = session.activeElementIds
    const selectionChanged = previous.length !== session.activeElementIds.length
      || previous.some((id, index) => id !== session.activeElementIds[index])
    if (!selectionChanged || !taskPanelRoute) return
    if (['design', 'elements', 'text', 'uploads', 'videos', 'audio', 'photos', 'charts'].includes(taskPanelRoute)) {
      closeTaskPanel({ restoreFocus: false })
    }
  }, [closeTaskPanel, session.activeElementIds, taskPanelRoute])

  const changeCreateTool = (tool: EditorCreateTool | null) => {
    setCreateTool(tool)
    runtime.store.dispatch(editorActions.activeToolChanged(tool?.key ?? null))
    if (tool) {
      runtime.store.dispatch(editorActions.creatingCustomShapeChanged(false))
      runtime.store.dispatch(editorActions.drawingModeChanged(false))
    }
  }
  const toggleDrawingMode = () => {
    const next = !runtime.store.getState().session.drawingMode
    closeTaskPanel({ restoreFocus: false })
    setCreateTool(null)
    runtime.store.dispatch(editorActions.activeToolChanged(null))
    runtime.store.dispatch(editorActions.creatingCustomShapeChanged(false))
    runtime.store.dispatch(editorActions.drawingModeChanged(next))
    if (next) runtime.store.dispatch(editorActions.sketchesVisibilityChanged(true))
  }
  const buildFromSketch = (handoff: SketchAgentHandoff) => {
    setAgentSketchHandoff(handoff)
    openAgent()
  }

  const insertSvgPath = (path: string) => {
    const width = 400
    const height = 400
    const themeColor = presentation.theme.themeColors[0]!
    const closed = /z\s*$/i.test(path)
    const element: PPTShapeElement = {
      type: 'shape',
      id: createPresentationId(10),
      left: (presentation.viewportSize - width) / 2,
      top: (presentation.viewportSize * presentation.viewportRatio - height) / 2,
      width,
      height,
      viewBox: [width, height],
      path,
      fill: closed ? themeColor : 'rgba(0, 0, 0, 0)',
      fixedRatio: false,
      rotate: 0,
      ...(closed ? {} : {
        outline: {
          width: 2,
          color: themeColor,
          style: 'solid' as const,
        },
      }),
    }
    if (!runtime.commit('Create shape', [{ type: 'element.add', elements: element }])) return
    runtime.store.dispatch(editorActions.selectionChanged([element.id]))
    runtime.store.dispatch(editorActions.canvasFocusChanged(true))
    setPathEditorOpen(false)
  }

  const insertImageSource = async (src: string) => {
    const position = fitImageToPresentation(presentation, await getImageSize(src))
    const element: PPTImageElement = {
      type: 'image',
      id: createPresentationId(10),
      src,
      ...position,
      fixedRatio: true,
      rotate: 0,
    }
    if (!runtime.commit('Create image', [{ type: 'element.add', elements: element }])) return
    runtime.store.dispatch(editorActions.selectionChanged([element.id]))
    runtime.store.dispatch(editorActions.canvasFocusChanged(true))
  }

  const insertTable = (rows: number, columns: number) => {
    const element = createTableElement({
      rows,
      columns,
      fontColor: presentation.theme.fontColor,
      fontName: presentation.theme.fontName,
      themeColor: presentation.theme.themeColors[0]!,
      viewportHeight: presentation.viewportSize * presentation.viewportRatio,
      viewportWidth: presentation.viewportSize,
    })
    if (!runtime.commit('Create table', [{ type: 'element.add', elements: element }])) return
    runtime.store.dispatch(editorActions.selectionChanged([element.id]))
    runtime.store.dispatch(editorActions.canvasFocusChanged(true))
  }

  const insertChart = (spec: CreateChartElementOptions & { openDataEditor?: boolean }) => {
    const element = createChartElement(spec, presentation.theme, {
      category: number => t('foundation.editor.chartData.category', { number }),
      coordinate: number => t('foundation.editor.chartData.coordinate', { number }),
      series: number => t('foundation.editor.chartData.series', { number }),
      value: t('foundation.editor.chartData.value'),
    })
    if (!runtime.commit('Create chart', [{ type: 'element.add', elements: element }])) return
    runtime.store.dispatch(editorActions.selectionChanged([element.id]))
    runtime.store.dispatch(editorActions.canvasFocusChanged(true))
    if (spec.openDataEditor) setEditingChartId(element.id)
  }

  const insertVideo = ({ ext, poster, src }: { ext?: string; poster?: string; src: string }) => {
    const element: PPTVideoElement = {
      type: 'video',
      id: createPresentationId(10),
      width: 500,
      height: 300,
      rotate: 0,
      left: (presentation.viewportSize - 500) / 2,
      top: (presentation.viewportSize * presentation.viewportRatio - 300) / 2,
      src,
      ...(poster ? { poster } : {}),
      autoplay: false,
      ...(ext ? { ext } : {}),
    }
    if (!runtime.commit('Create video', [{ type: 'element.add', elements: element }])) return
    runtime.store.dispatch(editorActions.selectionChanged([element.id]))
    runtime.store.dispatch(editorActions.canvasFocusChanged(true))
  }

  const insertAudio = ({ ext, src }: { ext?: string; src: string }) => {
    const element: PPTAudioElement = {
      type: 'audio',
      id: createPresentationId(10),
      width: 50,
      height: 50,
      rotate: 0,
      left: (presentation.viewportSize - 50) / 2,
      top: (presentation.viewportSize * presentation.viewportRatio - 50) / 2,
      loop: false,
      autoplay: false,
      fixedRatio: true,
      color: presentation.theme.themeColors[0]!,
      src,
      ...(ext ? { ext } : {}),
    }
    if (!runtime.commit('Create audio', [{ type: 'element.add', elements: element }])) return
    runtime.store.dispatch(editorActions.selectionChanged([element.id]))
    runtime.store.dispatch(editorActions.canvasFocusChanged(true))
  }

  const saveLatex = (result: LatexRenderResult) => {
    if (latexEditorTarget?.kind === 'edit') {
      if (!editingLatex) return
      runtime.commit('Update equation', [{
        type: 'element.update',
        payload: {
          id: editingLatex.id,
          props: {
            path: result.path,
            latex: result.latex,
            fallbackImage: undefined,
            width: result.w,
            height: result.h,
            viewBox: [result.w, result.h],
          },
        },
      }])
      return
    }
    const element = createLatexElement(presentation, result)
    if (!runtime.commit('Create equation', [{ type: 'element.add', elements: element }])) return
    runtime.store.dispatch(editorActions.selectionChanged([element.id]))
    runtime.store.dispatch(editorActions.canvasFocusChanged(true))
  }

  const insertSymbol = (value: string) => {
    if ((handleElement?.type === 'text' || handleElement?.type === 'shape') && runtime.richText.execute(handleElement.id, { command: 'insert', value })) return
    if (handleElement?.type === 'table') {
      const activeCell = document.querySelector<HTMLElement>('[data-element-id="' + CSS.escape(handleElement.id) + '"] .mona-table-cell-text.is-active')
      if (activeCell) {
        activeCell.focus()
        document.execCommand('insertText', false, value)
        return
      }
    }
    const element: PPTTextElement = {
      type: 'text',
      id: createPresentationId(10),
      left: 0,
      top: 0,
      width: 200,
      height: 50,
      content: value,
      rotate: 0,
      defaultFontName: presentation.theme.fontName,
      defaultColor: presentation.theme.fontColor,
      vertical: false,
    }
    if (!runtime.commit('Create symbol text', [{ type: 'element.add', elements: element }])) return
    runtime.store.dispatch(editorActions.selectionChanged([element.id]))
    runtime.store.dispatch(editorActions.canvasFocusChanged(true))
    requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-element-id="' + CSS.escape(element.id) + '"] .ProseMirror')?.focus())
  }

  const taskPanelTitle = taskPanelRoute
    ? t(`foundation.editor.taskPanels.${taskPanelRoute}`, {
        number: presentation.slideIndex + 1,
        selected: session.activeElementIds.length,
        total: currentSlide?.elements.length ?? 0,
      })
    : ''
  // These five predate the panel contract and render bare roots, so the chrome
  // is applied here rather than editing each one: PanelBody restores the 12px
  // padding and scrolling they used to inherit from `.mona-inspector-content`,
  // and text-[13px] the base size they were laid out against.
  // The one place the drawer's panels are wired to the deck. Registry entries
  // pull what they need from here, so a new category adds no props anywhere.
  const panelContext: EditorPanelContextValue = {
    actions: {
      createTool: changeCreateTool,
      drawCustomShape: () => {
        changeCreateTool(null)
        runtime.store.dispatch(editorActions.creatingCustomShapeChanged(true))
      },
      insertAudio,
      insertChart,
      insertImageSource: src => void insertImageSource(src),
      insertSymbol,
      insertTable,
      insertTemplateAll: (slides, theme) => runtime.insertTemplateSlides(slides, theme),
      insertTemplateOne: slide => runtime.createSlideFromTemplate(slide),
      insertVideo,
      openLatexEditor: () => setLatexEditorTarget({ kind: 'create' }),
      openPathEditor: () => setPathEditorOpen(true),
    },
    categoryIcon: taskPanelRoute ? EDITOR_PANEL_REGISTRY[taskPanelRoute]?.icon : undefined,
    elementCategory,
    templateProviders: DEFAULT_TEMPLATE_PROVIDERS,
    // The catalogue is app configuration, not deck content. `presentation`
    // carries a `templates` array that gets persisted with each saved deck,
    // which freezes the catalogue at the moment that deck was created — a deck
    // saved today would never see a provider added tomorrow. Read the live
    // catalogue instead; the state field remains for the command/state shape.
    templates: DEFAULT_TEMPLATE_CATALOG,
    theme: presentation.theme,
  }

  const secondaryTaskPanel = SECONDARY_PANEL_ROUTES.includes(taskPanelRoute as never) ? (
    <PanelChrome className="mona-secondary-panel">
      <PanelBody className="pt-3 text-[13px]">
        <EditorErrorBoundary key={taskPanelRoute ?? 'closed'}>
          <Suspense fallback={<div className="mona-agent-loading grid h-full place-items-center text-xs text-muted-foreground" role="status">{t('common.loading')}</div>}>
          {taskPanelRoute === 'speakerNotes' ? <EditorRemark runtime={runtime} /> : null}
          {taskPanelRoute === 'comments' ? <EditorCommentsPanel runtime={runtime} /> : null}
          {taskPanelRoute === 'search' ? <EditorSearchPanel runtime={runtime} /> : null}
          {taskPanelRoute === 'layers' ? <EditorLayersPanel runtime={runtime} /> : null}
          {taskPanelRoute === 'semantics' ? <EditorSemanticsPanel runtime={runtime} /> : null}
          </Suspense>
        </EditorErrorBoundary>
      </PanelBody>
    </PanelChrome>
  ) : null

  return (
    <main
      className="mona-readonly-deck mona-editor-deck"
      data-testid="editor-deck"
      onFocusCapture={event => {
        const target = event.target as Element
        if (target.closest('.mona-thumbnail-rail')) {
          runtime.store.dispatch(editorActions.thumbnailsFocusChanged(true))
          runtime.store.dispatch(editorActions.canvasFocusChanged(false))
        }
        else if (target.closest('.mona-page-grid-workspace')) {
          runtime.store.dispatch(editorActions.canvasFocusChanged(false))
        }
      }}
      onPointerDownCapture={event => {
        const target = event.target as Element
        // React portals retain their logical ancestry. These editor-owned
        // overlays live under document.body, but the source editor does not treat their
        // pointer activity as leaving the editor-area focus scope.
        if (target.closest([
          '[data-slot="dropdown-menu-content"]',
          '[data-slot="dialog-overlay"]',
          '[data-slot="select-content"]',
          '.mona-editor-notice',
          '.mona-svg-path-modal',
          '.mona-remark-menu',
        ].join(','))) return
        if (target.closest('.mona-thumbnail-rail')) {
          runtime.store.dispatch(editorActions.thumbnailsFocusChanged(true))
          runtime.store.dispatch(editorActions.canvasFocusChanged(false))
        }
        else if (target.closest('.mona-page-grid-workspace')) {
          // Grid selection is document state shared by its cards and header
          // actions. Moving focus to Duplicate/Hide/Delete must not clear the
          // selected block before that action reads it.
          runtime.store.dispatch(editorActions.canvasFocusChanged(false))
        }
        else if (target.closest('.mona-editor-stage')) {
          runtime.store.dispatch(editorActions.thumbnailsFocusChanged(false))
        }
        else {
          runtime.store.dispatch(editorActions.thumbnailsFocusChanged(false))
          runtime.store.dispatch(editorActions.canvasFocusChanged(false))
        }
      }}
    >
      <div className="mona-editor-shell w-full">
      <EditorSkipLink />
      <SidebarProvider className="mona-editor-workspace">
      <EditorRail
        activePanel={railPanel}
        activeTool={createTool}
        elementCategory={elementCategory}
        onCreateToolChange={changeCreateTool}
        onElementCategoryChange={setElementCategory}
        onPanelChange={changeRailPanel}
      />
      <CollapsiblePanelRegion className="mona-panel-region mona-drawer-region bg-sidebar" open={drawerOpen}>
      <Suspense fallback={(
        <div aria-label={taskPanelTitle || t('foundation.editor.inspector')} className="mona-editor-drawer mona-agent-loading grid h-full w-[22rem] shrink-0 place-items-center overflow-hidden text-xs text-muted-foreground" role="status">
          {t('common.loading')}
        </div>
      )}>
      <EditorPanelContext value={panelContext}>
      <EditorRailDrawer
        activePanel={railPanel === 'properties' ? null : railPanel}
        contextualHeader={(
          <SidebarHeader className="mona-inspector-tabs-header min-w-0 flex-1 border-b-0 p-0">
            <Tabs onValueChange={value => openContextualInspector(value as EditorToolbarState)} value={session.toolbarState}>
              <TabsList className="w-full">
                {currentTabs.map(tab => <TabsTrigger className="px-1 text-xs" key={tab.key} onClick={() => openContextualInspector(tab.key)} value={tab.key}>{tab.label}</TabsTrigger>)}
              </TabsList>
            </Tabs>
          </SidebarHeader>
        )}
        contextualOpen={railPanel === 'properties'}
        onClose={closeDrawer}
        panelTitle={taskPanelTitle}
        secondaryContent={secondaryTaskPanel}
      >
        <SidebarContent className="mona-inspector-content" ref={inspectorScrollRef}>
            {/* A crash in one panel resets when the user switches tab/element. */}
            <EditorErrorBoundary key={`${session.toolbarState}:${session.handleElementId ?? ''}`}>
            <Suspense fallback={<div className="mona-agent-loading grid h-full place-items-center text-xs text-muted-foreground" role="status">{t('common.loading')}</div>}>
            {session.toolbarState === 'elStyle' && handleText ? <TextStylePanel element={handleText} presentation={presentation} runtime={runtime} /> : null}
            {session.toolbarState === 'elStyle' && handleShape ? <ShapeStylePanel element={handleShape} presentation={presentation} runtime={runtime} /> : null}
            {session.toolbarState === 'elStyle' && handleLine ? <LineStylePanel element={handleLine} presentation={presentation} runtime={runtime} /> : null}
            {session.toolbarState === 'elStyle' && handleImage ? <ImageStylePanel element={handleImage} presentation={presentation} runtime={runtime} /> : null}
            {session.toolbarState === 'elStyle' && handleTable ? <TableStylePanel element={handleTable} presentation={presentation} runtime={runtime} selectedCells={session.selectedTableCells} /> : null}
            {session.toolbarState === 'elStyle' && handleChart ? <ChartStylePanel element={handleChart} onEditData={() => setEditingChartId(handleChart.id)} presentation={presentation} runtime={runtime} /> : null}
            {session.toolbarState === 'elStyle' && handleLatex ? <LatexStylePanel element={handleLatex} onEdit={() => setLatexEditorTarget({ id: handleLatex.id, kind: 'edit' })} runtime={runtime} /> : null}
            {session.toolbarState === 'elStyle' && handleAudio ? <AudioStylePanel element={handleAudio} runtime={runtime} /> : null}
            {session.toolbarState === 'elStyle' && handleVideo ? <VideoStylePanel element={handleVideo} runtime={runtime} /> : null}
            {session.toolbarState === 'elPosition' && handleElement ? (
              <ElementPositionPanel activeElementIds={session.activeElementIds} element={handleElement} presentation={presentation} runtime={runtime} />
            ) : null}
            {session.toolbarState === 'elAnimation' ? <ElementAnimationPanel element={handleElement} key={handleElement?.id || 'no-element'} runtime={runtime} /> : null}
            {session.toolbarState === 'slideAnimation' ? <SlideAnimationPanel runtime={runtime} /> : null}
            {session.toolbarState === 'slideDesign' ? <SlideDesignPanel runtime={runtime} /> : null}
            {session.toolbarState === 'multiStyle' ? <MultiStylePanel activeElementIds={session.activeElementIds} presentation={presentation} runtime={runtime} /> : null}
            {session.toolbarState === 'multiPosition' ? <MultiPositionPanel activeElementIds={session.activeElementIds} handleElementId={session.handleElementId} presentation={presentation} runtime={runtime} /> : null}
            </Suspense>
            </EditorErrorBoundary>
        </SidebarContent>
      </EditorRailDrawer>
      </EditorPanelContext>
      </Suspense>
      </CollapsiblePanelRegion>
      {/* Rail, task drawer, and agent dock all span the full height as siblings.
          The header lives between them and flexes, so opening any side surface
          narrows the header and the canvas together. */}
      <div className="mona-editor-main flex min-w-0 flex-1 flex-col">
      <EditorHeader onToggleDrawing={toggleDrawingMode} runtime={runtime} />
      <SidebarInset className="mona-editor-inset bg-transparent!" data-testid="mona-editor-surface" id="mona-editor-surface">
      {session.workspaceMode === 'page-grid' ? (
        <EditorErrorBoundary>
          <EditorPageGrid runtime={runtime} />
        </EditorErrorBoundary>
      ) : (
        <>
      <EditorContextToolbar
        activeMode={session.drawingMode ? 'draw' : createTool || session.creatingCustomShape ? 'create' : 'select'}
        currentSlide={currentSlide}
        onEditChart={setEditingChartId}
        onEditLatex={id => setLatexEditorTarget({ id, kind: 'edit' })}
        onOpenInspector={openContextualInspector}
        presentation={presentation}
        runtime={runtime}
        session={session}
      />
      <EditorErrorBoundary>
        <EditorCanvas
          activeCreateTool={createTool}
          customShapeActive={session.creatingCustomShape}
          drawingStore={drawingStore}
          onBuildSketch={buildFromSketch}
          onCreateToolChange={changeCreateTool}
          onCustomShapeChange={active => runtime.store.dispatch(editorActions.creatingCustomShapeChanged(active))}
          onDrawingModeChange={active => runtime.store.dispatch(editorActions.drawingModeChanged(active))}
          onEditChart={id => setEditingChartId(id)}
          onEditLatex={id => setLatexEditorTarget({ id, kind: 'edit' })}
          onSketchVisibilityChange={visible => runtime.store.dispatch(editorActions.sketchesVisibilityChanged(visible))}
          runtime={runtime}
        />
      </EditorErrorBoundary>
        </>
      )}
      {session.workspaceMode === 'canvas' && session.filmstripVisible ? (
      <div className="mona-editor-bottombar">
        <EditorErrorBoundary>
          <EditorThumbnails
            onOpenNotes={openSpeakerNotes}
            onOpenTransition={slideIndex => {
              runtime.focusSlide(slideIndex)
              openContextualInspector('slideAnimation')
            }}
            onStartSlideshow={startSlideshow}
            runtime={runtime}
          />
        </EditorErrorBoundary>
      </div>
      ) : null}
      {/* Footer and filmstrip live inside the canvas column, so they flex with
          the canvas as the sidebars open and close. */}
      <EditorStatusBar
        notesVisible={railPanel === 'speakerNotes'}
        onToggleNotes={() => toggleTaskPanel('speakerNotes')}
        runtime={runtime}
      />
      {banner}
      </SidebarInset>
      </div>
      <CollapsiblePanelRegion className="mona-panel-region mona-dock-region" open={agentOpen}>
        {agentOpen ? (
          <Suspense fallback={<aside className="mona-agent-dock grid h-full w-[var(--dock-w)] shrink-0 place-items-center overflow-hidden border-l border-sidebar-border bg-sidebar text-xs text-muted-foreground" role="status">{t('foundation.editor.agent.loading')}</aside>}>
            <EditorAgentDock handoff={agentSketchHandoff} key={agentSketchHandoff?.updatedAt ?? 'text-only'} runtime={runtime} />
          </Suspense>
        ) : null}
      </CollapsiblePanelRegion>
      </SidebarProvider>
      </div>
      <Suspense fallback={null}>
      {pathEditorOpen ? <EditorSvgPathEditor onClose={() => setPathEditorOpen(false)} onInsert={insertSvgPath} /> : null}
      {latexEditorTarget && (latexEditorTarget.kind === 'create' || editingLatex) ? (
        <EditorLatexEditor initialValue={editingLatex?.latex} onClose={() => setLatexEditorTarget(null)} onSave={saveLatex} />
      ) : null}
      {editingChart ? (
        <EditorChartDataEditor
          element={editingChart}
          key={editingChart.id}
          onClose={() => setEditingChartId(null)}
          onSave={({ data, type }) => {
            runtime.commit('Update chart data', [{ type: 'element.update', payload: { id: editingChart.id, props: { data, chartType: type } } }])
            setEditingChartId(null)
          }}
        />
      ) : null}
      </Suspense>
    </main>
  )
}
