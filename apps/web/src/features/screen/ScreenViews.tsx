/* oxlint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- the slideshow canvas is an application focus target: Enter/arrow playback and Shift+F10 context-menu commands intentionally live on the canvas while nested slide links remain independently focusable. */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  Monitor,
  PanelBottom,
  PanelRight,
  Pen,
  Power,
  Presentation,
  Repeat,
  Timer,
} from 'lucide-react'

import type { PresentationState } from '@mona/presentation-core'

import FullscreenIcon from '~icons/icon-park-outline/full-screen-one'
import LaserIcon from '~icons/icon-park-outline/magic'
import ListIcon from '~icons/icon-park-outline/list-view'
import MinusIcon from '~icons/icon-park-outline/minus'
import OffscreenIcon from '~icons/icon-park-outline/off-screen-one'
import PenIcon from '~icons/icon-park-outline/write'
import PeopleIcon from '~icons/icon-park-outline/peoples-two'
import PlusIcon from '~icons/icon-park-outline/plus'
import PowerIcon from '~icons/icon-park-outline/power'
import StopwatchIcon from '~icons/icon-park-outline/stopwatch-start'
import LeftIcon from '~icons/custom/left'
import RightIcon from '~icons/custom/right'

import { Button } from '@/components/ui/button'
import { ScreenContextMenu, type ScreenContextMenuItem } from '@/features/screen/ScreenContextMenu'
import { ScreenCountdownTimer } from '@/features/screen/ScreenCountdownTimer'
import { SCREEN_LASER_POINTER } from '@/features/screen/screen-assets'
import { ScreenSlideList } from '@/features/screen/ScreenSlideList'
import { ScreenAllSlides, ScreenBottomThumbnails, ScreenPresenterThumbnails } from '@/features/screen/ScreenThumbnails'
import { ScreenTooltip } from '@/features/screen/ScreenTooltip'
import { ScreenWritingBoard } from '@/features/screen/ScreenWritingBoard'
import type { ScreenPresentationController } from '@/features/screen/screen-types'
import type { ScreenPlayback } from '@/features/screen/use-screen-playback'
import { useScreenSlideSize } from '@/features/screen/use-screen-slide-size'

interface CommonViewProps {
  controller: ScreenPresentationController
  enterFullscreen: () => void
  fullscreen: boolean
  manualExitFullscreen: () => void
  onExit: () => void
  openAudience: () => void
  playback: ScreenPlayback
  presentation: PresentationState
}

const useReturnFocusWhenClosed = <T extends HTMLElement>(
  open: boolean,
  targetRef: React.RefObject<T | null>,
) => {
  const wasOpenRef = useRef(false)
  useLayoutEffect(() => {
    if (open) {
      wasOpenRef.current = true
      return
    }
    if (!wasOpenRef.current) return
    wasOpenRef.current = false
    targetRef.current?.focus()
  }, [open, targetRef])
}

export function ScreenBaseView({
  controller,
  enterFullscreen,
  fullscreen,
  manualExitFullscreen,
  onExit,
  openAudience,
  playback,
  presentation,
  setViewMode,
}: CommonViewProps & { setViewMode: (mode: 'base' | 'presenter') => void }) {
  const { t } = useTranslation()
  const { height: slideHeight, width: slideWidth } = useScreenSlideSize(presentation.viewportRatio)
  const [rightToolsVisible, setRightToolsVisible] = useState(false)
  const [writingVisible, setWritingVisible] = useState(false)
  const [timerVisible, setTimerVisible] = useState(false)
  const [allSlidesVisible, setAllSlidesVisible] = useState(false)
  const [bottomThumbnailsVisible, setBottomThumbnailsVisible] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const allSlidesButtonRef = useRef<HTMLButtonElement>(null)
  const nextButtonRef = useRef<HTMLButtonElement>(null)
  const penButtonRef = useRef<HTMLButtonElement>(null)
  const previousButtonRef = useRef<HTMLButtonElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const timerButtonRef = useRef<HTMLButtonElement>(null)
  const currentSlide = presentation.slides[presentation.slideIndex]!
  useReturnFocusWhenClosed(allSlidesVisible, allSlidesButtonRef)
  useReturnFocusWhenClosed(writingVisible, penButtonRef)
  useReturnFocusWhenClosed(timerVisible, timerButtonRef)
  useReturnFocusWhenClosed(Boolean(contextMenu), surfaceRef)
  const toolbarButton = (label: string, icon: React.ReactNode, onClick: () => void, active = false, buttonRef?: React.Ref<HTMLButtonElement>) => (
    <ScreenTooltip content={label}>
      <Button
        aria-label={label}
        aria-pressed={active || undefined}
        className={`mona-screen-tool-button${active ? ' is-active' : ''}`}
        onClick={onClick}
        ref={buttonRef}
        size={null}
        type="button"
        variant={null}
      >{icon}</Button>
    </ScreenTooltip>
  )
  useEffect(() => {
    const target = presentation.slideIndex < presentation.slides.length - 1
      ? nextButtonRef.current
      : previousButtonRef.current
    target?.focus()
    // Focus is assigned only when this view mounts; slide changes retain the
    // user's current toolbar or slide-link focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const exit = () => {
    playback.broadcastExit()
    onExit()
  }
  const closeAllSlides = useCallback(() => {
    setAllSlidesVisible(false)
  }, [])
  const closeWriting = useCallback(() => {
    setWritingVisible(false)
  }, [])
  const closeTimer = useCallback(() => {
    setTimerVisible(false)
  }, [])
  const openContextMenuFromKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    setContextMenu({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
  }
  const menu: ScreenContextMenuItem[] = [
    { action: 'previous', disabled: presentation.slideIndex <= 0, handler: playback.turnPrevSlide, icon: ChevronLeft, label: t('screen.previousSlide'), shortcut: '↑ ←' },
    { action: 'next', disabled: presentation.slideIndex >= presentation.slides.length - 1, handler: playback.turnNextSlide, icon: ChevronRight, label: t('screen.nextSlide'), shortcut: '↓ →' },
    { action: 'first', disabled: presentation.slideIndex === 0, handler: () => playback.turnSlideToIndex(0), icon: ChevronFirst, label: t('screen.firstSlide') },
    { action: 'last', disabled: presentation.slideIndex === presentation.slides.length - 1, handler: () => playback.turnSlideToIndex(presentation.slides.length - 1), icon: ChevronLast, label: t('screen.lastSlide') },
    { divider: true },
    {
      action: 'autoplay',
      children: [2500, 5000, 7500, 10000].map(interval => ({
        action: `autoplay-${interval}`,
        checked: playback.autoPlayInterval === interval,
        handler: () => playback.setAutoPlayInterval(interval),
        label: t('screen.seconds', { value: interval / 1000 }),
      })),
      handler: playback.autoPlayActive ? playback.closeAutoPlay : playback.autoPlay,
      icon: Timer,
      label: t(playback.autoPlayActive ? 'screen.cancelAutoPlay' : 'screen.autoPlay'),
    },
    { action: 'loop', checked: playback.loopPlay, handler: () => playback.setLoopPlay(!playback.loopPlay), icon: Repeat, label: t('screen.loopSlideshow') },
    { divider: true },
    { action: 'show-toolbar', handler: () => setRightToolsVisible(true), icon: PanelRight, label: t('screen.showToolbar') },
    { action: 'all-slides', handler: () => setAllSlidesVisible(true), icon: LayoutGrid, label: t('screen.allSlides') },
    { action: 'bottom-thumbnails', checked: bottomThumbnailsVisible, handler: () => setBottomThumbnailsVisible(current => !current), icon: PanelBottom, label: t('screen.bottomThumbnails') },
    { action: 'pen', handler: () => setWritingVisible(true), icon: Pen, label: t('screen.penTools') },
    { action: 'presenter', handler: () => setViewMode('presenter'), icon: Presentation, label: t('screen.presenterView') },
    { divider: true },
    { action: 'exit', handler: exit, icon: Power, label: t('screen.endSlideshow'), shortcut: 'ESC' },
  ]

  return (
    <div className={`mona-screen-base${playback.laserPen ? ' is-laser-pen' : ''}`} style={playback.laserPen ? { cursor: `url(${SCREEN_LASER_POINTER}) 20 20, default` } : undefined}>
      <div
        aria-label={t('screen.slideshowCanvas')}
        className="mona-screen-main-surface"
        onContextMenu={(event: MouseEvent) => {
          event.preventDefault(); setContextMenu({ x: event.clientX, y: event.clientY }) 
        }}
        onKeyDown={openContextMenuFromKeyboard}
        onTouchEnd={playback.touchEndListener}
        onTouchStart={playback.touchStartListener}
        onWheel={playback.mousewheelListener}
        ref={surfaceRef}
        role="application"
        tabIndex={0}
      >
        <ScreenSlideList animationIndex={playback.animationIndex} manualExitFullscreen={manualExitFullscreen} presentation={presentation} slideHeight={slideHeight} slideWidth={slideWidth} turnSlideToId={playback.turnSlideToId} />
      </div>
      {allSlidesVisible ? <ScreenAllSlides onClose={closeAllSlides} presentation={presentation} turnSlideToIndex={playback.turnSlideToIndex} /> : null}
      {writingVisible ? <ScreenWritingBoard onClose={closeWriting} slideHeight={slideHeight} slideId={currentSlide.id} slideWidth={slideWidth} /> : null}
      {timerVisible ? <ScreenCountdownTimer onClose={closeTimer} /> : null}
      <div className="mona-screen-tools-left">
        <Button aria-label={t('screen.previousSlide')} disabled={presentation.slideIndex <= 0} onClick={() => playback.execPrev()} ref={previousButtonRef} size={null} type="button" variant={null}><LeftIcon /></Button>
        <Button aria-label={t('screen.nextSlide')} disabled={presentation.slideIndex >= presentation.slides.length - 1} onClick={playback.execNext} ref={nextButtonRef} size={null} type="button" variant={null}><RightIcon /></Button>
      </div>
      <div className={`mona-screen-tools-right${rightToolsVisible ? ' is-visible' : ''}`} onMouseEnter={() => setRightToolsVisible(true)} onMouseLeave={() => setRightToolsVisible(false)}>
        <div className="mona-screen-tools-right-content">
          <Button aria-label={t('screen.allSlides')} className="mona-screen-tool-button mona-screen-page-number" onClick={() => setAllSlidesVisible(true)} ref={allSlidesButtonRef} size={null} type="button" variant={null}>{t('screen.slideNumber', { current: presentation.slideIndex + 1, total: presentation.slides.length })}</Button>
          {toolbarButton(t('screen.penTools'), <PenIcon />, () => setWritingVisible(true), writingVisible, penButtonRef)}
          {toolbarButton(t('screen.laserPointer'), <LaserIcon />, () => playback.setLaserPen(!playback.laserPen), playback.laserPen)}
          {toolbarButton(t('screen.timer'), <StopwatchIcon />, () => setTimerVisible(current => !current), timerVisible, timerButtonRef)}
          {toolbarButton(t('screen.presenterView'), <ListIcon />, () => setViewMode('presenter'))}
          {toolbarButton(t('screen.audienceView'), <PeopleIcon />, openAudience)}
          {fullscreen
            ? toolbarButton(t('screen.exitFullscreen'), <OffscreenIcon />, manualExitFullscreen)
            : toolbarButton(t('screen.enterFullscreen'), <FullscreenIcon />, enterFullscreen)}
          {toolbarButton(t('screen.endSlideshow'), <PowerIcon />, exit)}
        </div>
      </div>
      {bottomThumbnailsVisible ? <ScreenBottomThumbnails controller={controller} turnSlideToIndex={playback.turnSlideToIndex} /> : null}
      {contextMenu ? <ScreenContextMenu items={menu} onDismiss={() => setContextMenu(null)} position={contextMenu} /> : null}
    </div>
  )
}

const parseRemark = (remark?: string) => {
  if (!remark) return ''
  return remark.replace(/[\n\r]+/g, '<br>').split('<br>').filter(Boolean).map(paragraph => `<div>${paragraph}</div>`).join('')
}

export function ScreenPresenterView({
  enterFullscreen,
  fullscreen,
  manualExitFullscreen,
  onExit,
  openAudience,
  playback,
  presentation,
  setViewMode,
}: CommonViewProps & { setViewMode: (mode: 'base' | 'presenter') => void }) {
  const { t } = useTranslation()
  const slideWrapRef = useRef<HTMLDivElement>(null)
  const { height: slideHeight, width: slideWidth } = useScreenSlideSize(presentation.viewportRatio, slideWrapRef)
  const [writingVisible, setWritingVisible] = useState(false)
  const [timerVisible, setTimerVisible] = useState(false)
  const [remarkFontSize, setRemarkFontSize] = useState(16)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const normalViewButtonRef = useRef<HTMLButtonElement>(null)
  const penButtonRef = useRef<HTMLButtonElement>(null)
  const timerButtonRef = useRef<HTMLButtonElement>(null)
  const currentSlide = presentation.slides[presentation.slideIndex]!
  useReturnFocusWhenClosed(writingVisible, penButtonRef)
  useReturnFocusWhenClosed(timerVisible, timerButtonRef)
  useReturnFocusWhenClosed(Boolean(contextMenu), slideWrapRef)
  const remark = parseRemark(currentSlide.remark)
  const exit = () => {
    playback.broadcastExit(); onExit() 
  }
  const menu: ScreenContextMenuItem[] = [
    { action: 'previous', disabled: presentation.slideIndex <= 0, handler: playback.turnPrevSlide, icon: ChevronLeft, label: t('screen.previousSlide'), shortcut: '↑ ←' },
    { action: 'next', disabled: presentation.slideIndex >= presentation.slides.length - 1, handler: playback.turnNextSlide, icon: ChevronRight, label: t('screen.nextSlide'), shortcut: '↓ →' },
    { action: 'first', disabled: presentation.slideIndex === 0, handler: () => playback.turnSlideToIndex(0), icon: ChevronFirst, label: t('screen.firstSlide') },
    { action: 'last', disabled: presentation.slideIndex === presentation.slides.length - 1, handler: () => playback.turnSlideToIndex(presentation.slides.length - 1), icon: ChevronLast, label: t('screen.lastSlide') },
    { divider: true },
    { action: 'pen', handler: () => setWritingVisible(true), icon: Pen, label: t('screen.penTools') },
    { action: 'normal', handler: () => setViewMode('base'), icon: Monitor, label: t('screen.normalView') },
    { divider: true },
    { action: 'exit', handler: exit, icon: Power, label: t('screen.endSlideshow'), shortcut: 'ESC' },
  ]

  const tool = (active: boolean, icon: React.ReactNode, label: string, onClick: () => void, buttonRef?: React.Ref<HTMLButtonElement>) => (
    <Button
      aria-pressed={active || undefined}
      className={`mona-screen-presenter-tool${active ? ' is-active' : ''}`}
      onClick={onClick}
      ref={buttonRef}
      size={null}
      type="button"
      variant={null}
    >{icon}<span>{label}</span></Button>
  )
  useEffect(() => normalViewButtonRef.current?.focus(), [])
  const closeWriting = useCallback(() => {
    setWritingVisible(false)
  }, [])
  const closeTimer = useCallback(() => {
    setTimerVisible(false)
  }, [])
  const openContextMenuFromKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    setContextMenu({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
  }
  return (
    <div className="mona-screen-presenter">
      <div className="mona-screen-presenter-toolbar">
        {tool(false, <ListIcon />, t('screen.normalView'), () => setViewMode('base'), normalViewButtonRef)}
        {tool(false, <PeopleIcon />, t('screen.audienceView'), openAudience)}
        {tool(writingVisible, <PenIcon />, t('screen.pen'), () => setWritingVisible(current => !current), penButtonRef)}
        {tool(playback.laserPen, <LaserIcon />, t('screen.laserPointer'), () => playback.setLaserPen(!playback.laserPen))}
        {tool(timerVisible, <StopwatchIcon />, t('screen.timer'), () => setTimerVisible(current => !current), timerButtonRef)}
        {tool(false, fullscreen ? <OffscreenIcon /> : <FullscreenIcon />, t(fullscreen ? 'screen.exitFullscreen' : 'screen.enterFullscreen'), fullscreen ? manualExitFullscreen : enterFullscreen)}
        <div className="mona-screen-presenter-divider" />
        {tool(false, <PowerIcon />, t('screen.endSlideshow'), exit)}
      </div>
      <div className="mona-screen-presenter-content">
        <div
          aria-label={t('screen.slideshowCanvas')}
          className={`mona-screen-presenter-slide-wrap${playback.laserPen ? ' is-laser-pen' : ''}`}
          onContextMenu={event => {
            event.preventDefault(); setContextMenu({ x: event.clientX, y: event.clientY }) 
          }}
          onKeyDown={openContextMenuFromKeyboard}
          onTouchEnd={playback.touchEndListener}
          onTouchStart={playback.touchStartListener}
          onWheel={playback.mousewheelListener}
          ref={slideWrapRef}
          role="application"
          style={playback.laserPen ? { cursor: `url(${SCREEN_LASER_POINTER}) 20 20, default` } : undefined}
          tabIndex={0}
        >
          <ScreenSlideList animationIndex={playback.animationIndex} manualExitFullscreen={manualExitFullscreen} presentation={presentation} slideHeight={slideHeight} slideWidth={slideWidth} turnSlideToId={playback.turnSlideToId} />
          {writingVisible ? <ScreenWritingBoard left={-365} onClose={closeWriting} slideHeight={slideHeight} slideId={currentSlide.id} slideWidth={slideWidth} top={-155} /> : null}
          {timerVisible ? <ScreenCountdownTimer left={75} onClose={closeTimer} /> : null}
        </div>
        <ScreenPresenterThumbnails presentation={presentation} turnSlideToIndex={playback.turnSlideToIndex} />
      </div>
      <div className="mona-screen-presenter-remark">
        <div className="mona-screen-presenter-remark-header"><span>{t('screen.speakerNotes')}</span><span>P {presentation.slideIndex + 1} / {presentation.slides.length}</span></div>
        <div className={`mona-screen-presenter-remark-content ProseMirror-static${remark ? '' : ' is-empty'}`} dangerouslySetInnerHTML={{ __html: remark || t('screen.noNotes') }} style={{ fontSize: remarkFontSize }} />
        <div className="mona-screen-presenter-remark-scale">
          <Button aria-label={t('common.decrease')} disabled={remarkFontSize === 12} onClick={() => setRemarkFontSize(value => Math.max(12, value - 2))} size={null} type="button" variant={null}><MinusIcon /></Button>
          <Button aria-label={t('common.increase')} disabled={remarkFontSize === 40} onClick={() => setRemarkFontSize(value => Math.min(40, value + 2))} size={null} type="button" variant={null}><PlusIcon /></Button>
        </div>
      </div>
      {contextMenu ? <ScreenContextMenu items={menu} onDismiss={() => setContextMenu(null)} position={contextMenu} /> : null}
    </div>
  )
}
