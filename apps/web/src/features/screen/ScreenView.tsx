import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { selectPresentation } from '@mona/editor-state'
import { createPresentationId, type PresentationState } from '@mona/presentation-core'

import { EditorNoticeStack, type EditorNoticeValue } from '@/features/editor/EditorContextMenu'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { useEditorSelector } from '@/features/editor/use-editor-selector'
import { ScreenSlideList } from '@/features/screen/ScreenSlideList'
import { ScreenBaseView, ScreenPresenterView } from '@/features/screen/ScreenViews'
import { SCREEN_LASER_POINTER } from '@/features/screen/screen-assets'
import { AUDIENCE_SYNC_CHANNEL, type ScreenPresentationController, type ScreenSyncMessage, type ScreenViewMode } from '@/features/screen/screen-types'
import { useScreenPlayback } from '@/features/screen/use-screen-playback'
import { useScreenSlideSize } from '@/features/screen/use-screen-slide-size'

import 'animate.css'
import '@/features/screen/screen.css'

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

function ScreenNotices() {
  const idRef = useRef(0)
  const [notices, setNotices] = useState<Array<EditorNoticeValue & { id: number }>>([])
  useEffect(() => {
    const listener = (event: Event) => {
      const notice = (event as CustomEvent<EditorNoticeValue | null>).detail
      if (notice) setNotices(current => [...current, { ...notice, id: ++idRef.current }])
    }
    window.addEventListener('mona:notice', listener)
    return () => window.removeEventListener('mona:notice', listener)
  }, [])
  return <EditorNoticeStack notices={notices} onClose={id => setNotices(current => current.filter(notice => notice.id !== id))} />
}

function PresenterScreen({ onExit, runtime }: { onExit: () => void; runtime: EditorRuntime }) {
  const presentation = useEditorSelector(runtime.store, selectPresentation)
  const setSlideIndex = useCallback((index: number) => runtime.focusSlide(index), [runtime])
  const controller = useMemo<ScreenPresentationController>(() => ({
    presentation,
    setSlideIndex,
  }), [presentation, setSlideIndex])
  const [viewMode, setViewMode] = useState<ScreenViewMode>('base')

  // Playback and fullscreen state live here so toggling base/presenter view
  // keeps autoplay, loop, and animation progress. (Vue re-created them per
  // view; deliberate improvement.)
  const playback = useScreenPlayback({ controller })
  const fullscreen = useFullscreenLifecycle(onExit)
  const openAudience = () => {
    fullscreen.manualExitFullscreen()
    window.open(`${location.origin}${location.pathname}?mode=audience`, 'pptist-audience', 'popup')
  }
  // Vue's exitScreening leaves browser fullscreen before unmounting the show.
  const exitShow = () => {
    fullscreen.manualExitFullscreen()
    onExit()
  }

  useEffect(() => {
    const channel = new BroadcastChannel(AUDIENCE_SYNC_CHANNEL)
    const keydown = (event: KeyboardEvent) => {
      if (event.key.toUpperCase() !== 'ESCAPE') return
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
    <div className="mona-pptist-screen">
      {viewMode === 'base'
        ? <ScreenBaseView {...fullscreen} controller={controller} onExit={exitShow} openAudience={openAudience} playback={playback} presentation={presentation} setViewMode={setViewMode} />
        : <ScreenPresenterView {...fullscreen} controller={controller} onExit={exitShow} openAudience={openAudience} playback={playback} presentation={presentation} setViewMode={setViewMode} />}
      <ScreenNotices />
    </div>
  )
}

function AudienceScreen({ initialPresentation }: { initialPresentation: PresentationState }) {
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
  const playback = useScreenPlayback({ audience: true, controller })
  const { height: slideHeight, width: slideWidth } = useScreenSlideSize(presentation.viewportRatio)
  const [writing, setWriting] = useState({ blackboard: false, dataURL: '', visible: false })
  const [laser, setLaser] = useState({ visible: false, x: 0, y: 0 })

  const { execNext, execPrev, restoreAnimationState, setAnimationIndex, turnSlideToId, turnSlideToIndex } = playback
  useEffect(() => {
    const channel = new BroadcastChannel(AUDIENCE_SYNC_CHANNEL)
    channel.postMessage({ type: 'REQUEST_STATE' } satisfies ScreenSyncMessage)
    channel.postMessage({ type: 'REQUEST_WRITING_BOARD' } satisfies ScreenSyncMessage)
    channel.onmessage = ({ data }: MessageEvent<ScreenSyncMessage>) => {
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
      else if (data.type === 'EXIT') window.close()
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

export function ScreenView({ onExit, runtime }: { onExit: () => void; runtime: EditorRuntime }) {
  const initialPresentation = useEditorSelector(runtime.store, selectPresentation)
  const audience = new URLSearchParams(window.location.search).get('mode') === 'audience'
  return audience
    ? <div className="mona-pptist-screen"><AudienceScreen initialPresentation={initialPresentation} /></div>
    : <PresenterScreen onExit={onExit} runtime={runtime} />
}
