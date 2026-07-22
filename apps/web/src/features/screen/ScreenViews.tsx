/* oxlint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- the slideshow chrome mirrors PPTist's pointer-first full-screen controls. */
import { useRef, useState, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'

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

const replaceLegacy = (message: string, values: Record<string, number | string>) => Object.entries(values).reduce(
  (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
  message,
)

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
  const currentSlide = presentation.slides[presentation.slideIndex]!

  const exit = () => {
    playback.broadcastExit()
    onExit()
  }
  const menu: ScreenContextMenuItem[] = [
    { action: 'previous', disabled: presentation.slideIndex <= 0, handler: playback.turnPrevSlide, label: t('screen.previousSlide'), shortcut: '↑ ←' },
    { action: 'next', disabled: presentation.slideIndex >= presentation.slides.length - 1, handler: playback.turnNextSlide, label: t('screen.nextSlide'), shortcut: '↓ →' },
    { action: 'first', disabled: presentation.slideIndex === 0, handler: () => playback.turnSlideToIndex(0), label: t('screen.firstSlide') },
    { action: 'last', disabled: presentation.slideIndex === presentation.slides.length - 1, handler: () => playback.turnSlideToIndex(presentation.slides.length - 1), label: t('screen.lastSlide') },
    { divider: true },
    {
      action: 'autoplay',
      children: [2500, 5000, 7500, 10000].map(interval => ({
        action: `autoplay-${interval}`,
        handler: () => playback.setAutoPlayInterval(interval),
        label: replaceLegacy(t('screen.seconds'), { value: interval / 1000 }),
        shortcut: playback.autoPlayInterval === interval ? '√' : '',
      })),
      handler: playback.autoPlayActive ? playback.closeAutoPlay : playback.autoPlay,
      label: t(playback.autoPlayActive ? 'screen.cancelAutoPlay' : 'screen.autoPlay'),
    },
    { action: 'loop', handler: () => playback.setLoopPlay(!playback.loopPlay), label: t('screen.loopSlideshow'), shortcut: playback.loopPlay ? '√' : '' },
    { divider: true },
    { action: 'show-toolbar', handler: () => setRightToolsVisible(true), label: t('screen.showToolbar') },
    { action: 'all-slides', handler: () => setAllSlidesVisible(true), label: t('screen.allSlides') },
    { action: 'bottom-thumbnails', handler: () => setBottomThumbnailsVisible(current => !current), label: t('screen.bottomThumbnails'), shortcut: bottomThumbnailsVisible ? '√' : '' },
    { action: 'pen', handler: () => setWritingVisible(true), label: t('screen.penTools') },
    { action: 'presenter', handler: () => setViewMode('presenter'), label: t('screen.presenterView') },
    { divider: true },
    { action: 'exit', handler: exit, label: t('screen.endSlideshow'), shortcut: 'ESC' },
  ]

  return (
    <div className={`mona-screen-base${playback.laserPen ? ' is-laser-pen' : ''}`} style={playback.laserPen ? { cursor: `url(${SCREEN_LASER_POINTER}) 20 20, default` } : undefined}>
      <div
        className="mona-screen-main-surface"
        onContextMenu={(event: MouseEvent) => {
          event.preventDefault(); setContextMenu({ x: event.clientX, y: event.clientY }) 
        }}
        onTouchEnd={playback.touchEndListener}
        onTouchStart={playback.touchStartListener}
        onWheel={playback.mousewheelListener}
      >
        <ScreenSlideList animationIndex={playback.animationIndex} manualExitFullscreen={manualExitFullscreen} presentation={presentation} slideHeight={slideHeight} slideWidth={slideWidth} turnSlideToId={playback.turnSlideToId} />
      </div>
      {allSlidesVisible ? <ScreenAllSlides onClose={() => setAllSlidesVisible(false)} presentation={presentation} turnSlideToIndex={playback.turnSlideToIndex} /> : null}
      {writingVisible ? <ScreenWritingBoard onClose={() => setWritingVisible(false)} slideHeight={slideHeight} slideId={currentSlide.id} slideWidth={slideWidth} /> : null}
      {timerVisible ? <ScreenCountdownTimer onClose={() => setTimerVisible(false)} /> : null}
      <div className="mona-screen-tools-left"><LeftIcon onClick={() => playback.execPrev()} /><RightIcon onClick={playback.execNext} /></div>
      <div className={`mona-screen-tools-right${rightToolsVisible ? ' is-visible' : ''}`} onMouseEnter={() => setRightToolsVisible(true)} onMouseLeave={() => setRightToolsVisible(false)}>
        <div className="mona-screen-tools-right-content">
          <div className="mona-screen-tool-button mona-screen-page-number" onClick={() => setAllSlidesVisible(true)}>{replaceLegacy(t('screen.slideNumber'), { current: presentation.slideIndex + 1, total: presentation.slides.length })}</div>
          <ScreenTooltip content={t('screen.penTools')}><PenIcon className="mona-screen-tool-button" onClick={() => setWritingVisible(true)} /></ScreenTooltip>
          <ScreenTooltip content={t('screen.laserPointer')}><LaserIcon className={`mona-screen-tool-button${playback.laserPen ? ' is-active' : ''}`} onClick={() => playback.setLaserPen(!playback.laserPen)} /></ScreenTooltip>
          <ScreenTooltip content={t('screen.timer')}><StopwatchIcon className={`mona-screen-tool-button${timerVisible ? ' is-active' : ''}`} onClick={() => setTimerVisible(current => !current)} /></ScreenTooltip>
          <ScreenTooltip content={t('screen.presenterView')}><ListIcon className="mona-screen-tool-button" onClick={() => setViewMode('presenter')} /></ScreenTooltip>
          <ScreenTooltip content={t('screen.audienceView')}><PeopleIcon className="mona-screen-tool-button" onClick={openAudience} /></ScreenTooltip>
          {fullscreen ? <ScreenTooltip content={t('screen.exitFullscreen')}><OffscreenIcon className="mona-screen-tool-button" onClick={manualExitFullscreen} /></ScreenTooltip> : <ScreenTooltip content={t('screen.enterFullscreen')}><FullscreenIcon className="mona-screen-tool-button" onClick={enterFullscreen} /></ScreenTooltip>}
          <ScreenTooltip content={t('screen.endSlideshow')}><PowerIcon className="mona-screen-tool-button" onClick={exit} /></ScreenTooltip>
        </div>
      </div>
      {bottomThumbnailsVisible ? <ScreenBottomThumbnails controller={controller} /> : null}
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
  const currentSlide = presentation.slides[presentation.slideIndex]!
  const remark = parseRemark(currentSlide.remark)
  const exit = () => {
    playback.broadcastExit(); onExit() 
  }
  const menu: ScreenContextMenuItem[] = [
    { action: 'previous', disabled: presentation.slideIndex <= 0, handler: playback.turnPrevSlide, label: t('screen.previousSlide'), shortcut: '↑ ←' },
    { action: 'next', disabled: presentation.slideIndex >= presentation.slides.length - 1, handler: playback.turnNextSlide, label: t('screen.nextSlide'), shortcut: '↓ →' },
    { action: 'first', disabled: presentation.slideIndex === 0, handler: () => playback.turnSlideToIndex(0), label: t('screen.firstSlide') },
    { action: 'last', disabled: presentation.slideIndex === presentation.slides.length - 1, handler: () => playback.turnSlideToIndex(presentation.slides.length - 1), label: t('screen.lastSlide') },
    { divider: true },
    { action: 'pen', handler: () => setWritingVisible(true), label: t('screen.penTools') },
    { action: 'normal', handler: () => setViewMode('base'), label: t('screen.normalView') },
    { divider: true },
    { action: 'exit', handler: exit, label: t('screen.endSlideshow'), shortcut: 'ESC' },
  ]

  const tool = (active: boolean, icon: React.ReactNode, label: string, onClick: () => void) => <div className={`mona-screen-presenter-tool${active ? ' is-active' : ''}`} onClick={onClick}>{icon}<span>{label}</span></div>
  return (
    <div className="mona-screen-presenter">
      <div className="mona-screen-presenter-toolbar">
        {tool(false, <ListIcon />, t('screen.normalView'), () => setViewMode('base'))}
        {tool(false, <PeopleIcon />, t('screen.audienceView'), openAudience)}
        {tool(writingVisible, <PenIcon />, t('screen.pen'), () => setWritingVisible(current => !current))}
        {tool(playback.laserPen, <LaserIcon />, t('screen.laserPointer'), () => playback.setLaserPen(!playback.laserPen))}
        {tool(timerVisible, <StopwatchIcon />, t('screen.timer'), () => setTimerVisible(current => !current))}
        {tool(false, fullscreen ? <OffscreenIcon /> : <FullscreenIcon />, t(fullscreen ? 'screen.exitFullscreen' : 'screen.enterFullscreen'), fullscreen ? manualExitFullscreen : enterFullscreen)}
        <div className="mona-screen-presenter-divider" />
        {tool(false, <PowerIcon />, t('screen.endSlideshow'), exit)}
      </div>
      <div className="mona-screen-presenter-content">
        <div
          className={`mona-screen-presenter-slide-wrap${playback.laserPen ? ' is-laser-pen' : ''}`}
          onContextMenu={event => {
            event.preventDefault(); setContextMenu({ x: event.clientX, y: event.clientY }) 
          }}
          onTouchEnd={playback.touchEndListener}
          onTouchStart={playback.touchStartListener}
          onWheel={playback.mousewheelListener}
          ref={slideWrapRef}
          style={playback.laserPen ? { cursor: `url(${SCREEN_LASER_POINTER}) 20 20, default` } : undefined}
        >
          <ScreenSlideList animationIndex={playback.animationIndex} manualExitFullscreen={manualExitFullscreen} presentation={presentation} slideHeight={slideHeight} slideWidth={slideWidth} turnSlideToId={playback.turnSlideToId} />
          {writingVisible ? <ScreenWritingBoard left={-365} onClose={() => setWritingVisible(false)} slideHeight={slideHeight} slideId={currentSlide.id} slideWidth={slideWidth} top={-155} /> : null}
          {timerVisible ? <ScreenCountdownTimer left={75} onClose={() => setTimerVisible(false)} /> : null}
        </div>
        <ScreenPresenterThumbnails presentation={presentation} turnSlideToIndex={playback.turnSlideToIndex} />
      </div>
      <div className="mona-screen-presenter-remark">
        <div className="mona-screen-presenter-remark-header"><span>{t('screen.speakerNotes')}</span><span>P {presentation.slideIndex + 1} / {presentation.slides.length}</span></div>
        <div className={`mona-screen-presenter-remark-content ProseMirror-static${remark ? '' : ' is-empty'}`} dangerouslySetInnerHTML={{ __html: remark || t('screen.noNotes') }} style={{ fontSize: remarkFontSize }} />
        <div className="mona-screen-presenter-remark-scale">
          <div className={remarkFontSize === 12 ? 'is-disabled' : ''} onClick={() => setRemarkFontSize(value => Math.max(12, value - 2))}><MinusIcon /></div>
          <div className={remarkFontSize === 40 ? 'is-disabled' : ''} onClick={() => setRemarkFontSize(value => Math.min(40, value + 2))}><PlusIcon /></div>
        </div>
      </div>
      {contextMenu ? <ScreenContextMenu items={menu} onDismiss={() => setContextMenu(null)} position={contextMenu} /> : null}
    </div>
  )
}
