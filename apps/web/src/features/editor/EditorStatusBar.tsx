import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import CommentIcon from '~icons/icon-park-outline/comment'
import FullScreenIcon from '~icons/icon-park-outline/full-screen'
import { CircleHelp, FileStack, Grid2X2, MonitorPlay, Pause, Play, RotateCcw, Timer } from 'lucide-react'
import { editorActions, selectPresentation, selectSession } from '@mona/editor-state'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Slider } from '@/components/ui/slider'
import { EditorPageSettings } from '@/features/editor/EditorPageSettings'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { useEditorApplication } from '@/features/editor/services/editor-application'
import { useEditorSelector } from '@/features/editor/use-editor-selector'

const formatElapsed = (milliseconds: number) => {
  const totalSeconds = Math.floor(milliseconds / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return hours
    ? [hours, minutes, seconds].map(value => String(value).padStart(2, '0')).join(':')
    : [minutes, seconds].map(value => String(value).padStart(2, '0')).join(':')
}

function EditorTimer() {
  const { t } = useTranslation()
  const [running, setRunning] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const startedAtRef = useRef(0)
  const baseElapsedRef = useRef(0)

  useEffect(() => {
    if (!running) return undefined
    const update = () => setElapsed(baseElapsedRef.current + performance.now() - startedAtRef.current)
    update()
    const interval = window.setInterval(update, 250)
    return () => window.clearInterval(interval)
  }, [running])

  const toggle = () => {
    if (running) {
      baseElapsedRef.current = elapsed
      setRunning(false)
    }
    else {
      startedAtRef.current = performance.now()
      setRunning(true)
    }
  }
  const reset = () => {
    baseElapsedRef.current = 0
    setElapsed(0)
    if (running) startedAtRef.current = performance.now()
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button aria-label={t('foundation.editor.statusBar.timer')} className={`mona-statusbar-item${running ? ' is-active' : ''}`} size="editor" type="button" variant="ghost">
          <Timer /><span>{running ? formatElapsed(elapsed) : t('foundation.editor.statusBar.timer')}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="mona-editor-timer" side="top" sideOffset={10}>
        <span>{t('foundation.editor.statusBar.presentationTimer')}</span>
        <output aria-live="off">{formatElapsed(elapsed)}</output>
        <div>
          <Button onClick={toggle} size="sm" type="button" variant="outline">
            {running ? <Pause /> : <Play />}
            {t(running ? 'foundation.editor.statusBar.pause' : 'foundation.editor.statusBar.start')}
          </Button>
          <Button onClick={reset} size="sm" type="button" variant="ghost"><RotateCcw />{t('foundation.editor.statusBar.reset')}</Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function PageNumberControl({
  current,
  runtime,
  total,
}: {
  current: number
  runtime: EditorRuntime
  total: number
}) {
  const { t } = useTranslation()
  const [pageInput, setPageInput] = useState(String(current))
  const commit = () => {
    const value = Number.parseInt(pageInput, 10)
    if (!Number.isFinite(value)) {
      setPageInput(String(current))
      return
    }
    const index = Math.min(total - 1, Math.max(0, value - 1))
    runtime.focusSlide(index)
    setPageInput(String(index + 1))
  }
  return (
    <form className="mona-page-number-control" onSubmit={event => {
      event.preventDefault()
      commit()
    }}>
      <Input
        aria-label={t('foundation.editor.statusBar.goToPage')}
        inputMode="numeric"
        max={total}
        min={1}
        onBlur={commit}
        onChange={event => setPageInput(event.target.value)}
        onFocus={event => event.currentTarget.select()}
        type="number"
        value={pageInput}
      />
      <span>/ {total}</span>
    </form>
  )
}

export function EditorStatusBar({ notesVisible, onToggleNotes, runtime }: {
  notesVisible: boolean
  onToggleNotes: () => void
  runtime: EditorRuntime
}) {
  const { t } = useTranslation()
  const { startPresentation } = useEditorApplication()
  const rootRef = useRef<HTMLDivElement>(null)
  const presentation = useEditorSelector(runtime.store, selectPresentation)
  const session = useEditorSelector(runtime.store, selectSession)
  const [fitScale, setFitScale] = useState(.9)
  const [menuOpen, setMenuOpen] = useState(false)

  // Mirror EditorCanvas's fit math on the real stage node so the displayed
  // percentage matches the rendered scale exactly.
  useLayoutEffect(() => {
    const deck = rootRef.current?.closest<HTMLElement>('.mona-editor-deck')
    const stage = deck?.querySelector<HTMLElement>('.mona-editor-stage')
    if (!stage) return undefined
    const update = () => {
      const rect = stage.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) return
      const widthConstrained = rect.height / rect.width > presentation.viewportRatio
      const nextFitScale = widthConstrained
        ? rect.width / presentation.viewportSize
        : rect.height / (presentation.viewportSize * presentation.viewportRatio)
      setFitScale(nextFitScale)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [presentation.viewportRatio, presentation.viewportSize])

  const canvasScale = fitScale * (session.canvasZoom / 100)
  const canvasScalePercentage = Math.round(canvasScale * 100)
  const setAbsoluteScale = (percentage: number) => {
    // Keep the established editor's percentage-to-scale conversion exactly:
    // canvasZoom is the viewport percentage, while the menu value is the
    // resulting CSS scale.
    const canvasZoom = Math.round(percentage / canvasScale * session.canvasZoom) / 100
    runtime.store.dispatch(editorActions.canvasZoomChanged(canvasZoom))
  }
  const resetView = () => {
    runtime.store.dispatch(editorActions.canvasZoomChanged(90))
    runtime.store.dispatch(editorActions.canvasPanChanged({ x: 0, y: 0 }))
  }
  const fillView = () => {
    const stage = rootRef.current?.closest<HTMLElement>('.mona-editor-deck')?.querySelector<HTMLElement>('.mona-editor-stage')
    const rect = stage?.getBoundingClientRect()
    if (!rect || rect.width < 1 || rect.height < 1) return
    const widthScale = rect.width / presentation.viewportSize
    const heightScale = rect.height / (presentation.viewportSize * presentation.viewportRatio)
    const zoom = Math.min(200, Math.max(30, Math.round(Math.max(widthScale, heightScale) / Math.min(widthScale, heightScale) * 100)))
    runtime.store.dispatch(editorActions.canvasZoomChanged(zoom))
    runtime.store.dispatch(editorActions.canvasPanChanged({ x: 0, y: 0 }))
  }
  const zoomPresets = [200, 150, 125, 100, 75, 50]
  const togglePages = () => {
    if (session.workspaceMode === 'page-grid') {
      runtime.store.dispatch(editorActions.workspaceModeChanged('canvas'))
      runtime.store.dispatch(editorActions.filmstripVisibilityChanged(true))
      return
    }
    runtime.store.dispatch(editorActions.filmstripVisibilityChanged(!session.filmstripVisible))
  }

  return (
    <div className="mona-editor-statusbar" ref={rootRef}>
      {/* aria-labels are explicit: the visible labels disappear under the
          status bar's narrow-width container query, and the buttons must keep
          their accessible names when only icons remain. */}
      <Button
        aria-label={t('foundation.editor.statusBar.pages')}
        aria-pressed={session.filmstripVisible && session.workspaceMode === 'canvas'}
        className={`mona-statusbar-item${session.filmstripVisible && session.workspaceMode === 'canvas' ? ' is-active' : ''}`}
        onClick={togglePages}
        size="editor"
        type="button"
        variant="ghost"
      ><FileStack /><span>{t('foundation.editor.statusBar.pages')}</span></Button>
      <Button
        aria-label={t('foundation.editor.statusBar.gridView')}
        aria-pressed={session.workspaceMode === 'page-grid'}
        className={`mona-statusbar-item${session.workspaceMode === 'page-grid' ? ' is-active' : ''}`}
        data-grid-view-trigger
        onClick={() => runtime.store.dispatch(editorActions.workspaceModeChanged(session.workspaceMode === 'page-grid' ? 'canvas' : 'page-grid'))}
        size="editor"
        type="button"
        variant="ghost"
      ><Grid2X2 /><span>{t('foundation.editor.statusBar.gridView')}</span></Button>
      <Button
        aria-label={t('foundation.editor.statusBar.notes')}
        aria-pressed={notesVisible}
        className={`mona-statusbar-item${notesVisible ? ' is-active' : ''}`}
        onClick={onToggleNotes}
        size="editor"
        type="button"
        variant="ghost"
      ><CommentIcon /><span>{t('foundation.editor.statusBar.notes')}</span></Button>
      <EditorTimer />
      <EditorPageSettings key={presentation.slides[presentation.slideIndex]!.id} runtime={runtime} slide={presentation.slides[presentation.slideIndex]!} />
      <Popover>
        <PopoverTrigger asChild>
          <Button aria-label={t('foundation.editor.statusBar.help')} className="mona-statusbar-item" size="editor" type="button" variant="ghost"><CircleHelp /><span>{t('foundation.editor.statusBar.help')}</span></Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="mona-editor-shortcuts" side="top" sideOffset={10}>
          <strong>{t('foundation.editor.statusBar.shortcuts')}</strong>
          <dl>
            <div><dt>{t('foundation.editor.statusBar.present')}</dt><dd>F5</dd></div>
            <div><dt>{t('foundation.editor.thumbnails.newSlide')}</dt><dd>Enter</dd></div>
            <div><dt>{t('foundation.editor.contextual.duplicate')}</dt><dd>Ctrl D</dd></div>
            <div><dt>{t('foundation.editor.action.delete')}</dt><dd>Delete</dd></div>
            <div><dt>{t('foundation.editor.action.selectAll')}</dt><dd>Ctrl A</dd></div>
          </dl>
        </PopoverContent>
      </Popover>
      <div className="mona-statusbar-spacer" />
      <Slider
        aria-label={t('foundation.editor.canvasTool.zoomIn')}
        className="mona-statusbar-zoom-slider"
        max={200}
        min={30}
        onValueChange={([value]) => {
          if (value !== undefined) runtime.store.dispatch(editorActions.canvasZoomChanged(value))
        }}
        step={5}
        value={[session.canvasZoom]}
      />
      <Popover onOpenChange={setMenuOpen} open={menuOpen}>
        <PopoverTrigger asChild>
          <Button className="mona-canvas-zoom-text" size="editor" type="button" variant="ghost">{canvasScalePercentage}%</Button>
        </PopoverTrigger>
        <PopoverContent align="center" className="w-auto mona-canvas-tool-popover" side="top" sideOffset={10}>
          <div className="mona-canvas-tool-menu is-zoom-menu">
            {zoomPresets.map(value => (
              <Button className="mona-canvas-tool-menu-item" key={value} onClick={() => {
                setAbsoluteScale(value)
                setMenuOpen(false)
              }} size="editor" type="button" variant="ghost">{value}%</Button>
            ))}
            <Button className="mona-canvas-tool-menu-item" onClick={() => {
              resetView()
              setMenuOpen(false)
            }} size="editor" type="button" variant="ghost">{t('foundation.editor.canvasTool.fit')}</Button>
            <Button className="mona-canvas-tool-menu-item" onClick={() => {
              fillView()
              setMenuOpen(false)
            }} size="editor" type="button" variant="ghost">{t('foundation.editor.canvasTool.fill')}</Button>
          </div>
        </PopoverContent>
      </Popover>
      <div aria-hidden="true" className="mona-zoombar-divider" />
      <PageNumberControl
        current={presentation.slideIndex + 1}
        key={presentation.slideIndex}
        runtime={runtime}
        total={presentation.slides.length}
      />
      <Button aria-label={t('foundation.editor.canvasTool.fit')} className="mona-statusbar-icon" onClick={resetView} size="editor-icon" type="button" variant="ghost"><FullScreenIcon /></Button>
      <Button aria-label={t('foundation.editor.statusBar.present')} className="mona-statusbar-icon" onClick={() => startPresentation({ fromStart: false })} size="editor-icon" type="button" variant="ghost"><MonitorPlay /></Button>
    </div>
  )
}
