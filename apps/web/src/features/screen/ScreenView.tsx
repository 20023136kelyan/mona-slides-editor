import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { selectPresentation } from '@mona/editor-state'
import { createPresentationId, type PresentationState } from '@mona/presentation-core'

import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { useEditorApplication } from '@/features/editor/services/editor-application'
import { useEditorSelector } from '@/features/editor/use-editor-selector'
import { ScreenSlideList } from '@/features/screen/ScreenSlideList'
import { ScreenBaseView, ScreenPresenterView } from '@/features/screen/ScreenViews'
import { SCREEN_LASER_POINTER } from '@/features/screen/screen-assets'
import { projectPresentationForScreen, resolveSourceSlideIndex } from '@/features/screen/screen-presentation'
import type { ScreenPresentationController, ScreenSyncMessage, ScreenViewMode } from '@/features/screen/screen-types'
import { useScreenPlayback } from '@/features/screen/use-screen-playback'
import { useScreenSlideSize } from '@/features/screen/use-screen-slide-size'

import 'animate.css'
import '@/features/screen/screen.css'
import { ScreenSyncChannel, type ScreenSyncEvent } from '@/features/screen/screen-sync'
import { monaBridge } from '@/lib/mona-bridge'

type FullscreenDocument = Document & {
  mozCancelFullScreen?: () => void
  mozFullScreenElement?: Element | null
  msExitFullscreen?: () => void
  msFullscreenElement?: Element | null
  webkitCurrentFullScreenElement?: Element | null
  webkitExitFullscreen?: () => void
  webkitFullscreenElement?: Element | null
}
type FullscreenElement = HTMLElement & {
  mozRequestFullScreen?: () => void
  msRequestFullscreen?: () => void
  webkitRequestFullScreen?: () => void
}

const isFullscreen = () => {
  const documentWithVendors = document as FullscreenDocument
  return !!(document.fullscreenElement || documentWithVendors.mozFullScreenElement || documentWithVendors.webkitFullscreenElement || documentWithVendors.msFullscreenElement || documentWithVendors.webkitCurrentFullScreenElement)
}
const enterFullscreen = () => {
  const root = document.documentElement as FullscreenElement
  if (root.requestFullscreen) void root.requestFullscreen().catch(() => {})
  else if (root.mozRequestFullScreen) root.mozRequestFullScreen()
  else if (root.webkitRequestFullScreen) root.webkitRequestFullScreen()
  else root.msRequestFullscreen?.()
}
const exitFullscreen = () => {
  const documentWithVendors = document as FullscreenDocument
  if (document.exitFullscreen) void document.exitFullscreen().catch(() => {})
  else if (documentWithVendors.mozCancelFullScreen) documentWithVendors.mozCancelFullScreen()
  else if (documentWithVendors.webkitExitFullscreen) documentWithVendors.webkitExitFullscreen()
  else documentWithVendors.msExitFullscreen?.()
}

const useFullscreenLifecycle = (onExit: () => void) => {
  const [fullscreen, setFullscreen] = useState(isFullscreen)
  const escapeExitsRef = useRef(true)
  useEffect(() => {
    const changed = () => {
      const active = isFullscreen()
      setFullscreen(active)
      if (!active && escapeExitsRef.current) onExit()
      escapeExitsRef.current = true
    }
    document.addEventListener('fullscreenchange', changed)
    document.addEventListener('webkitfullscreenchange', changed)
    return () => {
      document.removeEventListener('fullscreenchange', changed)
      document.removeEventListener('webkitfullscreenchange', changed)
    }
  }, [onExit])
  const manualExitFullscreen = useCallback(() => {
    if (!isFullscreen()) return
    escapeExitsRef.current = false
    exitFullscreen()
  }, [])
  return { enterFullscreen, fullscreen, manualExitFullscreen }
}

function PresenterScreen({
  initialAutoPlay = false,
  initialViewMode = 'base',
  onExit,
  runtime,
}: {
  initialAutoPlay?: boolean
  initialViewMode?: ScreenViewMode
  onExit: () => void
  runtime: EditorRuntime
}) {
  const { notifications } = useEditorApplication()
  const sourcePresentation = useEditorSelector(runtime.store, selectPresentation)
  const presentation = useMemo(
    () => projectPresentationForScreen(sourcePresentation),
    [sourcePresentation],
  )
  const setSlideIndex = useCallback((index: number) => {
    const sourceIndex = resolveSourceSlideIndex(sourcePresentation, presentation, index)
    if (sourceIndex !== -1) runtime.focusSlide(sourceIndex)
  }, [presentation, runtime, sourcePresentation])
  const controller = useMemo<ScreenPresentationController>(() => ({
    presentation,
    setSlideIndex,
  }), [presentation, setSlideIndex])
  const [viewMode, setViewMode] = useState<ScreenViewMode>(initialViewMode)
  const changeViewMode = (mode: ScreenViewMode) => startTransition(() => setViewMode(mode))

  // Playback and fullscreen state live here so toggling base/presenter view
  // keeps autoplay, loop, and animation progress. (Vue re-created them per
  // view; deliberate improvement.)
  const playback = useScreenPlayback({ controller, notify: notifications.notify })
  const { autoPlay } = playback
  const autoPlayLaunchedRef = useRef(false)
  const fullscreen = useFullscreenLifecycle(onExit)
  // The shell puts it on the display the audience is looking at, fullscreen.
  const openAudience = () => {
    fullscreen.manualExitFullscreen()
    void monaBridge().screen.openAudience()
  }
  // Vue's exitScreening leaves browser fullscreen before unmounting the show.
  const exitShow = () => {
    fullscreen.manualExitFullscreen()
    onExit()
  }

  useEffect(() => {
    if (!initialAutoPlay || autoPlayLaunchedRef.current) return
    autoPlayLaunchedRef.current = true
    autoPlay()
  }, [autoPlay, initialAutoPlay])

  useEffect(() => {
    const channel = new ScreenSyncChannel()
    const keydown = (event: KeyboardEvent) => {
      if (event.key.toUpperCase() !== 'ESCAPE') return
      if (event.defaultPrevented) return
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('[role="dialog"], [role="menu"]')) return
      channel.postMessage({ type: 'EXIT' } satisfies ScreenSyncMessage)
      onExit()
    }
    document.addEventListener('keydown', keydown)
    return () => {
      document.removeEventListener('keydown', keydown)
      channel.close()
    }
  }, [onExit])

  return (
    <div className="mona-screen">
      {/* Deliberately conditional (not dual <Activity>): exactly one screen
          view may be mounted because keeping both in the DOM duplicates every
          #screen-element-* node.
          Playback/fullscreen state survives the toggle because it is hoisted
          here. */}
      {viewMode === 'base'
        ? <ScreenBaseView {...fullscreen} controller={controller} onExit={exitShow} openAudience={openAudience} playback={playback} presentation={presentation} setViewMode={changeViewMode} />
        : <ScreenPresenterView {...fullscreen} controller={controller} onExit={exitShow} openAudience={openAudience} playback={playback} presentation={presentation} setViewMode={changeViewMode} />}
    </div>
  )
}

function AudienceScreen({ initialPresentation }: { initialPresentation: PresentationState }) {
  const { notifications } = useEditorApplication()
  const [presentation, setPresentation] = useState<PresentationState>(() => ({
    ...structuredClone(initialPresentation),
    slideIndex: 0,
    slides: [{ id: createPresentationId(10), elements: [] }],
  }))
  const setSlideIndex = useCallback((index: number) => setPresentation(current => ({
    ...current,
    slideIndex: Math.max(0, Math.min(index, current.slides.length - 1)),
  })), [])
  const controller = useMemo<ScreenPresentationController>(() => ({
    presentation,
    setSlideIndex,
  }), [presentation, setSlideIndex])
  const playback = useScreenPlayback({ audience: true, controller, notify: notifications.notify })
  const { height: slideHeight, width: slideWidth } = useScreenSlideSize(presentation.viewportRatio)
  const [writing, setWriting] = useState({ blackboard: false, dataURL: '', visible: false })
  const [laser, setLaser] = useState({ visible: false, x: 0, y: 0 })

  const { execNext, execPrev, restoreAnimationState, setAnimationIndex, turnSlideToId, turnSlideToIndex } = playback
  useEffect(() => {
    const channel = new ScreenSyncChannel()
    channel.postMessage({ type: 'REQUEST_STATE' } satisfies ScreenSyncMessage)
    channel.postMessage({ type: 'REQUEST_WRITING_BOARD' } satisfies ScreenSyncMessage)
    channel.onmessage = ({ data }: ScreenSyncEvent) => {
      if (data.type === 'EXEC_NEXT') execNext()
      else if (data.type === 'EXEC_PREV') execPrev()
      else if (data.type === 'TURN_TO_INDEX') turnSlideToIndex(data.index)
      else if (data.type === 'TURN_TO_ID') turnSlideToId(data.id)
      else if (data.type === 'INIT_STATE') {
        setPresentation(current => ({
          ...current,
          slideIndex: data.slideIndex,
          slides: data.slides,
          viewportRatio: data.viewportRatio,
          viewportSize: data.viewportSize,
        }))
        setAnimationIndex(data.animationIndex)
        window.requestAnimationFrame(() => restoreAnimationState(data.animationIndex))
      }
      else if (data.type === 'WRITING_BOARD_UPDATE') setWriting({ blackboard: data.blackboard, dataURL: data.dataURL, visible: true })
      else if (data.type === 'WRITING_BOARD_CLOSE') setWriting({ blackboard: false, dataURL: '', visible: false })
      else if (data.type === 'LASER_PEN_MOVE') setLaser({ visible: true, x: data.x, y: data.y })
      else if (data.type === 'LASER_PEN_OFF') setLaser(current => ({ ...current, visible: false }))
      else if (data.type === 'EXIT') void monaBridge().screen.closeAudience()
    }
    return () => channel.close()
  }, [execNext, execPrev, restoreAnimationState, setAnimationIndex, turnSlideToId, turnSlideToIndex])

  return (
    <div className="mona-screen-audience">
      <ScreenSlideList animationIndex={playback.animationIndex} manualExitFullscreen={() => {}} presentation={presentation} slideHeight={slideHeight} slideWidth={slideWidth} turnSlideToId={playback.turnSlideToId} />
      {writing.visible ? (
        <div className="mona-screen-audience-writing-overlay">
          <div className="mona-screen-audience-writing-content" style={{ height: slideHeight, width: slideWidth }}>
            {writing.blackboard ? <div className="mona-screen-blackboard" /> : null}
            {writing.dataURL ? <img alt="" src={writing.dataURL} /> : null}
          </div>
        </div>
      ) : null}
      {laser.visible ? <div className="mona-screen-audience-laser" style={{ backgroundImage: `url(${SCREEN_LASER_POINTER})`, left: `calc(50% - ${slideWidth / 2}px + ${laser.x * slideWidth}px)`, top: `calc(50% - ${slideHeight / 2}px + ${laser.y * slideHeight}px)` }} /> : null}
    </div>
  )
}

export function ScreenView({
  initialAutoPlay,
  initialViewMode,
  onExit,
  runtime,
}: {
  initialAutoPlay?: boolean
  initialViewMode?: ScreenViewMode
  onExit: () => void
  runtime: EditorRuntime
}) {
  const initialPresentation = useEditorSelector(runtime.store, selectPresentation)
  const audience = new URLSearchParams(window.location.search).get('mode') === 'audience'
  return audience
    ? <div className="mona-screen"><AudienceScreen initialPresentation={initialPresentation} /></div>
    : <PresenterScreen initialAutoPlay={initialAutoPlay} initialViewMode={initialViewMode} onExit={onExit} runtime={runtime} />
}
