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
import { statusBarItemClassName } from '@/features/editor/editor-statusbar-chrome'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { useEditorApplication } from '@/features/editor/services/editor-application'
import { useEditorSelector } from '@/features/editor/use-editor-selector'
import { cn } from '@/lib/utils'

const formatTimer = (milliseconds: number) => {
  const totalSeconds = Math.ceil(milliseconds / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return hours
    ? [hours, minutes, seconds].map(value => String(value).padStart(2, '0')).join(':')
    : [minutes, seconds].map(value => String(value).padStart(2, '0')).join(':')
}

const DEFAULT_TIMER_MS = 5 * 60 * 1000
const clampTimer = (milliseconds: number) => Math.min(99 * 60 * 1000 + 59_000, Math.max(0, milliseconds))

function EditorTimer() {
  const { t } = useTranslation()
  const [running, setRunning] = useState(false)
  const [remaining, setRemaining] = useState(DEFAULT_TIMER_MS)
  const deadlineRef = useRef(0)

  useEffect(() => {
    if (!running) return undefined
    const update = () => {
      const next = Math.max(0, deadlineRef.current - performance.now())
      setRemaining(next)
      if (next <= 0) setRunning(false)
    }
    update()
    const interval = window.setInterval(update, 250)
    return () => window.clearInterval(interval)
  }, [running])

  const toggle = () => {
    if (running) {
      setRunning(false)
    }
    else {
      const next = remaining > 0 ? remaining : DEFAULT_TIMER_MS
      setRemaining(next)
      deadlineRef.current = performance.now() + next
      setRunning(true)
    }
  }
  const reset = () => {
    setRunning(false)
    setRemaining(DEFAULT_TIMER_MS)
  }
  const setDuration = (milliseconds: number) => {
    const next = clampTimer(milliseconds)
    setRemaining(next)
    if (running) deadlineRef.current = performance.now() + next
  }
  const totalSeconds = Math.ceil(remaining / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button aria-label={t('foundation.editor.statusBar.timer')} className={statusBarItemClassName(running)} size="editor" type="button" variant="ghost">
          <Timer /><span>{running ? formatTimer(remaining) : t('foundation.editor.statusBar.timer')}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        aria-label={t('foundation.editor.statusBar.presentationTimer')}
        align="start"
        className="mona-editor-timer flex w-57.5 flex-col gap-2.5"
        side="top"
        sideOffset={10}
      >
        <span className="text-xs text-muted-foreground">{t('foundation.editor.statusBar.presentationTimer')}</span>
        <div className="mona-editor-timer-adjust grid grid-cols-[40px_minmax(0,1fr)_40px] items-center gap-1.5">
          <Button aria-label={t('foundation.editor.statusBar.subtractMinute')} onClick={() => setDuration(remaining - 60_000)} size="editor-icon" type="button" variant="ghost">−</Button>
          <div className="mona-editor-timer-fields grid grid-cols-[1fr_auto_1fr] items-start gap-1">
            <label className="grid gap-0.5 text-center text-mini text-muted-foreground">
              <Input
                aria-label={t('foundation.editor.statusBar.minutes')}
                className="h-9.5 px-1 text-center tabular-nums"
                max={99}
                min={0}
                onChange={event => setDuration(Number(event.target.value) * 60_000 + seconds * 1000)}
                type="number"
                value={minutes}
              />
              <span>{t('foundation.editor.statusBar.minutesShort')}</span>
            </label>
            <span aria-hidden="true">:</span>
            <label className="grid gap-0.5 text-center text-mini text-muted-foreground">
              <Input
                aria-label={t('foundation.editor.statusBar.seconds')}
                className="h-9.5 px-1 text-center tabular-nums"
                max={59}
                min={0}
                onChange={event => setDuration(minutes * 60_000 + Number(event.target.value) * 1000)}
                type="number"
                value={seconds}
              />
              <span>{t('foundation.editor.statusBar.secondsShort')}</span>
            </label>
          </div>
          <Button aria-label={t('foundation.editor.statusBar.addMinute')} onClick={() => setDuration(remaining + 60_000)} size="editor-icon" type="button" variant="ghost">+</Button>
        </div>
        <output className="text-center text-[32px] font-[650] tracking-[-0.03em] tabular-nums" aria-live="off">{formatTimer(remaining)}</output>
        <div className="mona-editor-timer-actions flex gap-1.5 [&_button]:flex-1">
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
    <form
      className="mona-page-number-control flex h-7 shrink-0 items-center gap-1 whitespace-nowrap text-xs font-semibold text-ink/70"
      onSubmit={event => {
        event.preventDefault()
        commit()
      }}
    >
      <Input
        aria-label={t('foundation.editor.statusBar.goToPage')}
        className="h-7 w-9.5 appearance-none border-0 bg-transparent px-0.75 text-right font-semibold shadow-none [appearance:textfield] focus-visible:border-transparent focus-visible:ring-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
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
    const zoom = Math.min(300, Math.max(10, Math.round(Math.max(widthScale, heightScale) / Math.min(widthScale, heightScale) * 100)))
    runtime.store.dispatch(editorActions.canvasZoomChanged(zoom))
    runtime.store.dispatch(editorActions.canvasPanChanged({ x: 0, y: 0 }))
  }
  const zoomPresets = [300, 200, 125, 100, 75, 50, 25, 10]
  const togglePages = () => {
    if (session.workspaceMode === 'page-grid') {
      runtime.store.dispatch(editorActions.workspaceModeChanged('canvas'))
      runtime.store.dispatch(editorActions.filmstripVisibilityChanged(true))
      return
    }
    runtime.store.dispatch(editorActions.filmstripVisibilityChanged(!session.filmstripVisible))
  }
  const pagesActive = session.filmstripVisible && session.workspaceMode === 'canvas'
  const gridActive = session.workspaceMode === 'page-grid'
  const zoomMenuItemClass = cn(
    'mona-canvas-tool-menu-item',
    'flex min-w-20 justify-center rounded-control border-0 bg-transparent px-4 py-2 text-inherit text-foreground hover:bg-[#f1f1f1]',
  )

  return (
    <div
      className="mona-editor-statusbar @container flex h-11.5 flex-none items-center gap-2 bg-transparent px-3 backdrop-blur-[18px] backdrop-saturate-[1.7]"
      ref={rootRef}
    >
      {/* aria-labels are explicit: the visible labels disappear under the
          status bar's narrow-width container query, and the buttons must keep
          their accessible names when only icons remain. */}
      <Button
        aria-label={t('foundation.editor.statusBar.pages')}
        aria-pressed={pagesActive}
        className={statusBarItemClassName(pagesActive)}
        onClick={togglePages}
        size="editor"
        type="button"
        variant="ghost"
      ><FileStack /><span>{t('foundation.editor.statusBar.pages')}</span></Button>
      <Button
        aria-label={t('foundation.editor.statusBar.gridView')}
        aria-pressed={gridActive}
        className={statusBarItemClassName(gridActive)}
        data-grid-view-trigger
        onClick={() => runtime.store.dispatch(editorActions.workspaceModeChanged(session.workspaceMode === 'page-grid' ? 'canvas' : 'page-grid'))}
        size="editor"
        type="button"
        variant="ghost"
      ><Grid2X2 /><span>{t('foundation.editor.statusBar.gridView')}</span></Button>
      <Button
        aria-label={t('foundation.editor.statusBar.notes')}
        aria-pressed={notesVisible}
        className={statusBarItemClassName(notesVisible)}
        onClick={onToggleNotes}
        size="editor"
        type="button"
        variant="ghost"
      ><CommentIcon /><span>{t('foundation.editor.statusBar.notes')}</span></Button>
      <EditorTimer />
      <EditorPageSettings key={presentation.slides[presentation.slideIndex]!.id} runtime={runtime} slide={presentation.slides[presentation.slideIndex]!} />
      <Popover>
        <PopoverTrigger asChild>
          <Button aria-label={t('foundation.editor.statusBar.help')} className={statusBarItemClassName()} size="editor" type="button" variant="ghost"><CircleHelp /><span>{t('foundation.editor.statusBar.help')}</span></Button>
        </PopoverTrigger>
        <PopoverContent aria-label={t('foundation.editor.statusBar.help')} align="start" className="mona-editor-shortcuts w-62.5" side="top" sideOffset={10}>
          <strong className="mb-2 block">{t('foundation.editor.statusBar.shortcuts')}</strong>
          <dl className="grid gap-0.5">
            <div className="flex min-h-7.5 items-center justify-between gap-5">
              <dt className="text-xs text-muted-foreground">{t('foundation.editor.statusBar.present')}</dt>
              <dd className="flex-none rounded-detail border border-border bg-muted px-1.5 py-0.5 text-mini whitespace-nowrap">F5</dd>
            </div>
            <div className="flex min-h-7.5 items-center justify-between gap-5">
              <dt className="text-xs text-muted-foreground">{t('foundation.editor.thumbnails.newSlide')}</dt>
              <dd className="flex-none rounded-detail border border-border bg-muted px-1.5 py-0.5 text-mini whitespace-nowrap">Enter</dd>
            </div>
            <div className="flex min-h-7.5 items-center justify-between gap-5">
              <dt className="text-xs text-muted-foreground">{t('foundation.editor.contextual.duplicate')}</dt>
              <dd className="flex-none rounded-detail border border-border bg-muted px-1.5 py-0.5 text-mini whitespace-nowrap">Ctrl D</dd>
            </div>
            <div className="flex min-h-7.5 items-center justify-between gap-5">
              <dt className="text-xs text-muted-foreground">{t('foundation.editor.action.delete')}</dt>
              <dd className="flex-none rounded-detail border border-border bg-muted px-1.5 py-0.5 text-mini whitespace-nowrap">Delete</dd>
            </div>
            <div className="flex min-h-7.5 items-center justify-between gap-5">
              <dt className="text-xs text-muted-foreground">{t('foundation.editor.action.selectAll')}</dt>
              <dd className="flex-none rounded-detail border border-border bg-muted px-1.5 py-0.5 text-mini whitespace-nowrap">Ctrl A</dd>
            </div>
          </dl>
        </PopoverContent>
      </Popover>
      <div className="mona-statusbar-spacer flex-1" />
      <Slider
        aria-label={t('foundation.editor.canvasTool.zoomIn')}
        className={cn(
          'mona-statusbar-zoom-slider',
          'w-27.5 min-w-14 grow-0 shrink basis-auto',
          '[&_[data-slot=slider-track]]:h-1 [&_[data-slot=slider-track]]:bg-[#e2e4e9]',
          '[&_[data-slot=slider-range]]:bg-[#b9bdc7]',
          '[&_[data-slot=slider-thumb]]:size-3.5 [&_[data-slot=slider-thumb]]:border-ink/15 [&_[data-slot=slider-thumb]]:bg-white [&_[data-slot=slider-thumb]]:shadow-[0_1px_3px_rgb(0_0_0/15%)]',
        )}
        max={300}
        min={10}
        onValueChange={([value]) => {
          if (value !== undefined) runtime.store.dispatch(editorActions.canvasZoomChanged(value))
        }}
        step={5}
        value={[session.canvasZoom]}
      />
      <Popover onOpenChange={setMenuOpen} open={menuOpen}>
        <PopoverTrigger asChild>
          <Button
            className="mona-canvas-zoom-text inline-block w-11 cursor-pointer p-0 text-center text-xs text-foreground"
            size="editor"
            type="button"
            variant="ghost"
          >{canvasScalePercentage}%</Button>
        </PopoverTrigger>
        <PopoverContent
          aria-label={t('foundation.editor.canvasTool.zoomIn')}
          align="center"
          className="mona-canvas-tool-popover z-[120] w-auto rounded-control border border-[#e5e7eb] bg-white p-2.5 text-control leading-normal text-foreground shadow-md"
          side="top"
          sideOffset={10}
        >
          <div className="mona-canvas-tool-menu is-zoom-menu flex flex-col gap-0.5">
            {zoomPresets.map(value => (
              <Button className={zoomMenuItemClass} key={value} onClick={() => {
                setAbsoluteScale(value)
                setMenuOpen(false)
              }} size="editor" type="button" variant="ghost">{value}%</Button>
            ))}
            <Button className={zoomMenuItemClass} onClick={() => {
              resetView()
              setMenuOpen(false)
            }} size="editor" type="button" variant="ghost">{t('foundation.editor.canvasTool.fit')}</Button>
            <Button className={zoomMenuItemClass} onClick={() => {
              fillView()
              setMenuOpen(false)
            }} size="editor" type="button" variant="ghost">{t('foundation.editor.canvasTool.fill')}</Button>
          </div>
        </PopoverContent>
      </Popover>
      <div aria-hidden="true" className="mona-zoombar-divider mx-1 h-4 w-px flex-none bg-border max-[1000px]:hidden" />
      <PageNumberControl
        current={presentation.slideIndex + 1}
        key={presentation.slideIndex}
        runtime={runtime}
        total={presentation.slides.length}
      />
      <Button
        aria-label={t('foundation.editor.canvasTool.fit')}
        className="mona-statusbar-icon size-8 rounded-action text-field text-ink/70 [&_svg]:size-3.75"
        onClick={resetView}
        size="editor-icon"
        type="button"
        variant="ghost"
      ><FullScreenIcon /></Button>
      <Button
        aria-label={t('foundation.editor.statusBar.present')}
        className="mona-statusbar-icon size-8 rounded-action text-field text-ink/70 [&_svg]:size-3.75"
        onClick={() => startPresentation({ fromStart: false })}
        size="editor-icon"
        type="button"
        variant="ghost"
      ><MonitorPlay /></Button>
    </div>
  )
}
