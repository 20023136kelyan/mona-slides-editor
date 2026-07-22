import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { editorActions, selectCurrentSlide, selectPresentation, selectSession } from '@mona/editor-state'
import type { EditorRootState, EditorToolbarState } from '@mona/editor-state'
import { createPresentationId, type PresentationState } from '@mona/presentation-core'
import type { ChartType, PPTAudioElement, PPTChartElement, PPTImageElement, PPTLatexElement, PPTLineElement, PPTShapeElement, PPTTableElement, PPTTextElement, PPTVideoElement } from '@mona/presentation-core/model'

import { EditorCanvas } from '@/features/editor/EditorCanvas'
import { EditorCanvasTool } from '@/features/editor/EditorCanvasTool'
import { createEditorRuntime, type EditorRuntime } from '@/features/editor/editor-runtime'
import { useEditorSelector } from '@/features/editor/use-editor-selector'
import type { EditorCreateTool } from '@/features/editor/editor-create-tool'
import { fileToDataUrl, fitImageToPresentation, getImageSize } from '@/features/editor/editor-image'
import { createTableElement } from '@/features/editor/editor-table'
import { createChartElement } from '@/features/editor/editor-chart'
import { createLatexElement, type LatexRenderResult } from '@/features/editor/editor-latex'
import { EditorThumbnails } from '@/features/editor/EditorThumbnails'
import { EditorRemark } from '@/features/editor/EditorRemark'
import { SlideDesignPanel } from '@/features/editor/SlideDesignPanel'
import {
  AudioStylePanel,
  ChartStylePanel,
  ElementAnimationPanel,
  ElementPositionPanel,
  ImageStylePanel,
  LatexStylePanel,
  LineStylePanel,
  MultiPositionPanel,
  MultiStylePanel,
  ShapeStylePanel,
  SlideAnimationPanel,
  TableStylePanel,
  TextStylePanel,
  VideoStylePanel,
} from '@/features/editor/EditorInspectorPanels'
import {
  EditorChartDataEditor,
  EditorImageLibraryPanel,
  EditorMarkupPanel,
  EditorNotesPanel,
  EditorSearchPanel,
  EditorSelectionPanel,
  EditorSvgPathEditor,
  EditorSymbolPanel,
} from '@/features/editor/EditorSecondarySurfaces'
import { EditorLatexEditor } from '@/features/editor/EditorLatexEditor'

interface MonaReactTestBridge {
  getHistoryState: EditorRuntime['getHistoryState']
  getRichTextState: EditorRuntime['richText']['getSnapshot']
  getShapeFormatPainterState: EditorRuntime['shapeFormatPainter']['getSnapshot']
  getState: () => EditorRootState
  isReady: () => boolean
}

declare global {
  interface Window {
    __MONA_REACT_TEST__?: MonaReactTestBridge
  }
}

export function EditorDeck({
  presentation: initialPresentation,
  runtime: externalRuntime,
}: {
  presentation: PresentationState
  runtime?: EditorRuntime
}) {
  const { t } = useTranslation()
  const [ownedRuntime] = useState(() => externalRuntime ?? createEditorRuntime(initialPresentation))
  const runtime = externalRuntime ?? ownedRuntime
  const [createTool, setCreateTool] = useState<EditorCreateTool | null>(null)
  const [pathEditorOpen, setPathEditorOpen] = useState(false)
  const [imageLibraryOpen, setImageLibraryOpen] = useState(false)
  const [editingChartId, setEditingChartId] = useState<string | null>(null)
  const [latexEditorTarget, setLatexEditorTarget] = useState<{ id: string; kind: 'edit' } | { kind: 'create' } | null>(null)
  const [symbolPanelOpen, setSymbolPanelOpen] = useState(false)
  const [remarkHeight, setRemarkHeight] = useState(40)

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
        ]
        : [
          { key: 'elStyle', label: t('foundation.editor.text.style') },
          { key: 'elPosition', label: t('foundation.editor.text.position') },
          { key: 'elAnimation', label: t('foundation.editor.text.animation') },
        ]
  ), [session.activeElementIds.length, session.activeGroupElementId, t])
  const openNotes = useCallback(() => {
    runtime.store.dispatch(editorActions.panelVisibilityChanged({ open: true, panel: 'notes' }))
  }, [runtime])
  const startSlideshow = useCallback((fromCurrent: boolean) => {
    window.dispatchEvent(new CustomEvent('mona:screening-request', { detail: { fromStart: !fromCurrent } }))
  }, [])

  useEffect(() => {
    if (!import.meta.env.DEV) return undefined
    const bridge = Object.freeze({
      getHistoryState: runtime.getHistoryState,
      getRichTextState: runtime.richText.getSnapshot,
      getShapeFormatPainterState: runtime.shapeFormatPainter.getSnapshot,
      // Match the Vue development bridge's serializable-state contract exactly.
      // JSON cloning intentionally drops undefined object properties and turns
      // undefined array entries into null, which is also what consumers receive
      // when this state crosses a JSON/process boundary.
      getState: () => JSON.parse(JSON.stringify(runtime.store.getState())) as EditorRootState,
      isReady: () => true,
    } satisfies MonaReactTestBridge)
    window.__MONA_REACT_TEST__ = bridge
    return () => {
      if (window.__MONA_REACT_TEST__ === bridge) delete window.__MONA_REACT_TEST__
    }
  }, [runtime])

  useEffect(() => {
    if (currentTabs.some(tab => tab.key === session.toolbarState)) return
    runtime.store.dispatch(editorActions.toolbarStateChanged(currentTabs[0]!.key))
  }, [currentTabs, runtime, session.toolbarState])

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

  const changeCreateTool = (tool: EditorCreateTool | null) => {
    setCreateTool(tool)
    runtime.store.dispatch(editorActions.activeToolChanged(tool?.key ?? null))
    if (tool) runtime.store.dispatch(editorActions.creatingCustomShapeChanged(false))
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

  const insertImage = async (file: File) => insertImageSource(await fileToDataUrl(file))

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

  const insertChart = (type: ChartType) => {
    const element = createChartElement(type, presentation.theme, {
      category: number => t('foundation.editor.chartData.category', { number }),
      coordinate: number => t('foundation.editor.chartData.coordinate', { number }),
      series: number => t('foundation.editor.chartData.series', { number }),
      value: t('foundation.editor.chartData.value'),
    })
    if (!runtime.commit('Create chart', [{ type: 'element.add', elements: element }])) return
    runtime.store.dispatch(editorActions.selectionChanged([element.id]))
    runtime.store.dispatch(editorActions.canvasFocusChanged(true))
  }

  const insertVideo = ({ ext, src }: { ext?: string; src: string }) => {
    const element: PPTVideoElement = {
      type: 'video',
      id: createPresentationId(10),
      width: 500,
      height: 300,
      rotate: 0,
      left: (presentation.viewportSize - 500) / 2,
      top: (presentation.viewportSize * presentation.viewportRatio - 300) / 2,
      src,
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

  return (
    <main
      className="mona-readonly-deck mona-editor-deck"
      data-testid="editor-deck"
      style={{ gridTemplateRows: `40px minmax(0, 1fr) ${remarkHeight}px` }}
      onFocusCapture={event => {
        const target = event.target as Element
        if (target.closest('.mona-thumbnail-rail')) {
          runtime.store.dispatch(editorActions.thumbnailsFocusChanged(true))
          runtime.store.dispatch(editorActions.canvasFocusChanged(false))
        }
      }}
      onPointerDownCapture={event => {
        const target = event.target as Element
        // React portals retain their logical ancestry. These editor-owned
        // overlays live under document.body, but PPTist does not treat their
        // pointer activity as leaving the editor-area focus scope.
        if (target.closest([
          '.mona-editor-context-menu',
          '.mona-editor-context-menu-mask',
          '.mona-link-dialog-backdrop',
          '.mona-link-select-popover',
          '.mona-editor-notice',
          '.mona-svg-path-modal',
          '.mona-chart-data-modal',
          '.mona-chart-theme-modal',
          '.mona-latex-modal',
          '.mona-symbol-panel',
          '.mona-moveable-panel',
          '.mona-remark-menu',
        ].join(','))) return
        if (target.closest('.mona-thumbnail-rail')) {
          runtime.store.dispatch(editorActions.thumbnailsFocusChanged(true))
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
      <EditorThumbnails
        onOpenNotes={openNotes}
        onStartSlideshow={startSlideshow}
        runtime={runtime}
      />
      <EditorCanvasTool
        activeTool={createTool}
        customShapeActive={session.creatingCustomShape}
        onCreateToolChange={changeCreateTool}
        onDrawCustomShape={() => {
          changeCreateTool(null)
          runtime.store.dispatch(editorActions.creatingCustomShapeChanged(true))
        }}
        onInsertAudio={insertAudio}
        onInsertImage={file => void insertImage(file)}
        onInsertChart={insertChart}
        onInsertTable={insertTable}
        onInsertVideo={insertVideo}
        onOpenImageLibrary={() => setImageLibraryOpen(true)}
        onOpenLatexEditor={() => setLatexEditorTarget({ kind: 'create' })}
        onOpenPathEditor={() => setPathEditorOpen(true)}
        onToggleSymbolPanel={() => setSymbolPanelOpen(open => !open)}
        presentation={presentation}
        runtime={runtime}
        symbolPanelOpen={symbolPanelOpen}
      />
      <EditorCanvas activeCreateTool={createTool} customShapeActive={session.creatingCustomShape} onCreateToolChange={changeCreateTool} onCustomShapeChange={active => runtime.store.dispatch(editorActions.creatingCustomShapeChanged(active))} onEditChart={id => setEditingChartId(id)} onEditLatex={id => setLatexEditorTarget({ id, kind: 'edit' })} runtime={runtime} />
      <EditorRemark height={remarkHeight} onHeightChange={setRemarkHeight} runtime={runtime} />
      <aside aria-label={t('foundation.editor.inspector')} className="mona-render-inspector">
        <div className="mona-element-inspector">
          <div className="mona-inspector-tabs" role="tablist">
            {currentTabs.map(tab => (
              <button
                aria-selected={session.toolbarState === tab.key}
                className={session.toolbarState === tab.key ? 'is-active' : ''}
                key={tab.key}
                onClick={() => runtime.store.dispatch(editorActions.toolbarStateChanged(tab.key))}
                role="tab"
                type="button"
              >{tab.label}</button>
            ))}
          </div>
          <div className="mona-inspector-content">
            <Suspense fallback={null}>
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
          </div>
        </div>
      </aside>
      <Suspense fallback={null}>
      {pathEditorOpen ? <EditorSvgPathEditor onClose={() => setPathEditorOpen(false)} onInsert={insertSvgPath} /> : null}
      {imageLibraryOpen ? (
        <EditorImageLibraryPanel
          onClose={() => setImageLibraryOpen(false)}
          onInsert={src => void insertImageSource(src)}
        />
      ) : null}
      {symbolPanelOpen ? <EditorSymbolPanel onClose={() => setSymbolPanelOpen(false)} onSelect={insertSymbol} /> : null}
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
      {session.openPanels.includes('notes') ? (
        <EditorNotesPanel
          onClose={() => runtime.store.dispatch(editorActions.panelVisibilityChanged({ open: false, panel: 'notes' }))}
          runtime={runtime}
        />
      ) : null}
      {session.openPanels.includes('selection') ? (
        <EditorSelectionPanel
          onClose={() => runtime.store.dispatch(editorActions.panelVisibilityChanged({ open: false, panel: 'selection' }))}
          runtime={runtime}
        />
      ) : null}
      {session.openPanels.includes('markup') ? (
        <EditorMarkupPanel
          onClose={() => runtime.store.dispatch(editorActions.panelVisibilityChanged({ open: false, panel: 'markup' }))}
          runtime={runtime}
        />
      ) : null}
      {session.openPanels.includes('search') ? (
        <EditorSearchPanel
          onClose={() => runtime.store.dispatch(editorActions.panelVisibilityChanged({ open: false, panel: 'search' }))}
          runtime={runtime}
        />
      ) : null}
      </Suspense>
    </main>
  )
}
