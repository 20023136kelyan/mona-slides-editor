/* oxlint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/media-has-caption, jsx-a11y/no-static-element-interactions, jsx-a11y/prefer-tag-over-role -- user media may be captionless and the composite player surface contains nested controls. */
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type Ref } from 'react'
import { useTranslation } from 'react-i18next'

import PauseIcon from '~icons/icon-park-outline/pause'
import PlayIcon from '~icons/icon-park-outline/play-one'
import VolumeMuteIcon from '~icons/icon-park-outline/volume-mute'
import VolumeNoticeIcon from '~icons/icon-park-outline/volume-notice'
import VolumeSmallIcon from '~icons/icon-park-outline/volume-small'
import type { PPTAudioElement, PPTVideoElement } from '@mona/presentation-core/model'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useOptionalEditorApplication } from '@/features/editor/services/editor-application'
import { cn } from '@/lib/utils'

// Player controls sit on video, so they stay white-on-transparent with the
// dimmed-until-hover treatment the bar has always used.
const PLAYER_ICON = 'relative flex h-full w-9 items-center border-0 bg-transparent p-0 text-start text-xl text-white [&>span]:text-white [&>span]:opacity-80 [&>span]:transition-all hover:[&>span]:opacity-100 [&_svg]:block [&_svg]:size-[1em]'

export interface MediaElementEditor {
  active: boolean
  onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void
  onPointerDown: (event: ReactPointerEvent<HTMLElement>, canMove: boolean) => void
  scale: number
  viewportRatio: number
  viewportSize: number
}

export interface MediaElementScreen {
  active: boolean
  scale: number
  viewportRatio: number
  viewportSize: number
}

interface AudioPlayerHandle {
  toggle: () => void
}

const secondToTime = (second = 0) => {
  if (second === 0 || Number.isNaN(second)) return '00:00'
  const pad = (value: number) => value < 10 ? `0${value}` : String(value)
  const hour = Math.floor(second / 3600)
  const minute = Math.floor((second - hour * 3600) / 60)
  const seconds = Math.floor(second - hour * 3600 - minute * 60)
  return (hour > 0 ? [hour, minute, seconds] : [minute, seconds]).map(pad).join(':')
}

const mediaEventClientX = (event: MouseEvent | TouchEvent) => 'clientX' in event
  ? event.clientX
  : event.changedTouches[0]?.clientX || 0

function StaticVideoIcon() {
  return <PlayIcon aria-hidden="true" className="mona-video-icon" />
}

function StaticVolumeIcon() {
  return <VolumeNoticeIcon aria-hidden="true" className="mona-audio-icon" />
}

// React 19: ref is a regular prop, no forwardRef wrapper needed.
function AudioPlayer({ autoplay = false, element, ref, scale, style }: { autoplay?: boolean; element: PPTAudioElement; ref?: Ref<AudioPlayerHandle>; scale: number; style: React.CSSProperties }) {
  const { t } = useTranslation()
  const application = useOptionalEditorApplication()
  const audioRef = useRef<HTMLAudioElement>(null)

  // Effects detach when <Activity> hides the surface (display:none does not
  // stop media): playing editor audio must not keep sounding behind a
  // slideshow. Also covers real unmounts.
  useEffect(() => () => {
    audioRef.current?.pause()
  }, [])
  const playBarRef = useRef<HTMLDivElement>(null)
  const volumeBarRef = useRef<HTMLDivElement>(null)
  const [volume, setVolumeState] = useState(.5)
  const [paused, setPaused] = useState(true)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [loaded, setLoaded] = useState(0)
  const [barHover, setBarHover] = useState({ left: 0, time: '00:00', visible: false })

  useLayoutEffect(() => {
    const audio = audioRef.current
    if (!audio || element.src) return
    // the source editor renders an explicit empty src attribute. Preserve that observable
    // media/error lifecycle without asking React to render src="" (which emits
    // a React-only warning before the DOM reaches the source state).
    audio.setAttribute('src', '')
    audio.load()
  }, [element.src])

  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1

  const seek = (time: number) => {
    const audio = audioRef.current
    if (!audio) return
    const next = Math.max(0, Math.min(time, duration))
    audio.currentTime = next
    setCurrentTime(next)
  }
  const play = () => {
    const audio = audioRef.current
    if (!audio) return
    setPaused(false)
    void audio.play().catch(() => {})
  }
  const pause = () => {
    setPaused(true)
    audioRef.current?.pause()
  }
  const toggle = () => paused ? play() : pause()
  useImperativeHandle(ref, () => ({ toggle }))
  const setVolume = (percentage: number) => {
    const audio = audioRef.current
    if (!audio) return
    const next = Math.max(0, Math.min(percentage, 1))
    audio.volume = next
    if (audio.muted && next !== 0) audio.muted = false
    setVolumeState(next)
  }
  const toggleVolume = () => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.muted) {
      audio.muted = false
      setVolume(.5)
    }
    else {
      audio.muted = true
      setVolume(0)
    }
  }
  const beginPlaybarDrag = () => {
    const move = (event: MouseEvent | TouchEvent) => {
      const bar = playBarRef.current
      if (!bar) return
      seek(((mediaEventClientX(event) - bar.getBoundingClientRect().left) / bar.clientWidth) * duration)
    }
    const up = (event: MouseEvent | TouchEvent) => {
      move(event)
      document.removeEventListener('mousemove', move)
      document.removeEventListener('touchmove', move)
      document.removeEventListener('mouseup', up)
      document.removeEventListener('touchend', up)
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('touchmove', move)
    document.addEventListener('mouseup', up)
    document.addEventListener('touchend', up)
  }
  const beginVolumeDrag = () => {
    const move = (event: MouseEvent | TouchEvent) => {
      const bar = volumeBarRef.current
      if (bar) setVolume((mediaEventClientX(event) - bar.getBoundingClientRect().left) / 45)
    }
    const up = () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('touchmove', move)
      document.removeEventListener('mouseup', up)
      document.removeEventListener('touchend', up)
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('touchmove', move)
    document.addEventListener('mouseup', up)
    document.addEventListener('touchend', up)
  }
  return (
    <div className="mona-audio-player" onPointerDown={event => event.stopPropagation()} style={{ ...style, transform: `scale(${1 / safeScale})` }}>
      <audio
        className="mona-audio-native"
        onDurationChange={event => setDuration(event.currentTarget.duration || 0)}
        onEnded={() => element.loop ? (seek(0), play()) : pause()}
        onError={event => {
          event.stopPropagation()
          application?.notifications.notify({ text: t('player.loadFailed'), type: 'error' })
        }}
        onPlay={() => setPaused(false)}
        onProgress={event => {
          const audio = event.currentTarget
          setLoaded(audio.buffered.length ? audio.buffered.end(audio.buffered.length - 1) : 0)
        }}
        onTimeUpdate={event => setCurrentTime(event.currentTarget.currentTime || 0)}
        ref={audioRef}
        autoPlay={autoplay}
        src={element.src || undefined}
      />
      <div className="mona-audio-controller">
        <div className="absolute bottom-0 left-3.5 flex h-9.5 items-center">
          <Button aria-label={paused ? 'Play' : 'Pause'} className={cn(PLAYER_ICON, 'text-[26px]')} onClick={toggle} size={null} type="button" variant={null}><span>{paused ? <PlayIcon /> : <PauseIcon />}</span></Button>
          <div className="relative flex h-full cursor-pointer items-center">
            <Button aria-label="Volume" className={PLAYER_ICON} onClick={toggleVolume} size={null} type="button" variant={null}><span>{volume === 0 ? <VolumeMuteIcon /> : volume === 1 ? <VolumeNoticeIcon /> : <VolumeSmallIcon />}</span></Button>
            <div className="mona-player-volume-wrap" onClick={event => {
              const bar = volumeBarRef.current
              if (bar) setVolume((event.clientX - bar.getBoundingClientRect().left) / 45)
            }} onMouseDown={beginVolumeDrag} onTouchStart={beginVolumeDrag}>
              <div className="mona-player-volume-bar" ref={volumeBarRef}><div className="mona-player-volume-inner" style={{ width: `${volume * 100}%` }}><span /></div></div>
            </div>
          </div>
        </div>
        <span className="mona-audio-time"><span>{secondToTime(currentTime)}</span> / <span>{secondToTime(duration)}</span></span>
        <div
          className="mona-player-bar-wrap"
          onMouseDown={beginPlaybarDrag}
          onTouchStart={beginPlaybarDrag}
          onMouseEnter={() => setBarHover(value => ({ ...value, visible: true }))}
          onMouseLeave={() => setBarHover(value => ({ ...value, visible: false }))}
          onMouseMove={event => {
            const bar = playBarRef.current
            if (!bar || !duration) return
            const x = event.clientX - bar.getBoundingClientRect().left
            if (x < 0 || x > bar.offsetWidth) return
            const time = duration * (x / bar.offsetWidth)
            setBarHover({ left: x - (time >= 3600 ? 25 : 20), time: secondToTime(time), visible: true })
          }}
          ref={playBarRef}
        >
          <div className={`mona-player-bar-time${barHover.visible ? '' : ' is-hidden'}`} style={{ left: barHover.left }}>{barHover.time}</div>
          <div className="mona-player-bar"><div className="mona-player-loaded" style={{ width: `${duration ? loaded / duration * 100 : 0}%` }} /><div className="mona-player-played" style={{ width: `${duration ? currentTime / duration * 100 : 0}%` }}><span /></div></div>
        </div>
      </div>
    </div>
  )
}

function VideoPlayer({ autoplay = false, element, scale }: { autoplay?: boolean; element: PPTVideoElement; scale: number }) {
  const { t } = useTranslation()
  const videoRef = useRef<HTMLVideoElement>(null)

  // See AudioPlayer: pause when <Activity> hides the surface.
  useEffect(() => () => {
    videoRef.current?.pause()
  }, [])
  const backgroundCanvasRef = useRef<HTMLCanvasElement>(null)
  const playBarRef = useRef<HTMLDivElement>(null)
  const volumeBarRef = useRef<HTMLDivElement>(null)
  const hideTimerRef = useRef<number | undefined>(undefined)
  const [volume, setVolumeState] = useState(.5)
  const [paused, setPaused] = useState(true)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [loaded, setLoaded] = useState(0)
  const [loop, setLoop] = useState(false)
  const [rate, setRate] = useState(1)
  const [rateMenu, setRateMenu] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [bezel, setBezel] = useState(false)
  const [controllerHidden, setControllerHidden] = useState(false)
  const [barHover, setBarHover] = useState({ left: 0, time: '00:00', visible: false })
  const rates = [2, 1.5, 1.25, 1, .75, .5]

  useLayoutEffect(() => {
    const video = videoRef.current
    if (!video || element.src) return
    // See AudioPlayer: the empty attribute is source behaviour and is also
    // what drives the established editor's failed-media state for an empty fixture URL.
    video.setAttribute('src', '')
    video.load()
  }, [element.src])

  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1

  useEffect(() => () => window.clearTimeout(hideTimerRef.current), [])
  useEffect(() => {
    const video = videoRef.current
    if (!video) return undefined
    const sourceType = /m3u8(#|\?|$)/i.test(element.src) ? 'hls' : /\.flv(#|\?|$)/i.test(element.src) ? 'flv' : 'normal'
    const mediaWindow = window as Window & {
      Hls?: { isSupported: () => boolean; new(): { attachMedia: (media: HTMLVideoElement) => void; destroy?: () => void; loadSource: (source: string) => void } }
      flvjs?: { createPlayer: (options: { type: 'flv'; url: string }) => { attachMediaElement: (media: HTMLVideoElement) => void; destroy?: () => void; load: () => void }; isSupported: () => boolean }
    }
    if (sourceType === 'hls' && !(video.canPlayType('application/x-mpegURL') || video.canPlayType('application/vnd.apple.mpegURL'))) {
      const Hls = mediaWindow.Hls
      if (Hls?.isSupported()) {
        const player = new Hls()
        player.loadSource(element.src)
        player.attachMedia(video)
        return () => player.destroy?.()
      }
    }
    else if (sourceType === 'flv' && mediaWindow.flvjs?.isSupported()) {
      const player = mediaWindow.flvjs.createPlayer({ type: 'flv', url: element.src })
      player.attachMediaElement(video)
      player.load()
      return () => player.destroy?.()
    }
    return undefined
  }, [element.src])
  const showController = () => {
    setControllerHidden(false)
    window.clearTimeout(hideTimerRef.current)
    hideTimerRef.current = window.setTimeout(() => {
      if (videoRef.current?.played.length) setControllerHidden(true)
    }, 3000)
  }
  const seek = (time: number) => {
    const video = videoRef.current
    if (!video) return
    const next = Math.max(0, Math.min(time, duration))
    video.currentTime = next
    setCurrentTime(next)
  }
  const play = () => {
    const video = videoRef.current
    if (!video) return
    setPaused(false)
    setBezel(true)
    void video.play().catch(() => {})
  }
  const pause = () => {
    setPaused(true)
    setBezel(true)
    videoRef.current?.pause()
  }
  const toggle = () => paused ? play() : pause()
  const setVolume = (percentage: number) => {
    const video = videoRef.current
    if (!video) return
    const next = Math.max(0, Math.min(percentage, 1))
    video.volume = next
    if (video.muted && next !== 0) video.muted = false
    setVolumeState(next)
  }
  const toggleVolume = () => {
    const video = videoRef.current
    if (!video) return
    if (video.muted) {
      video.muted = false
      setVolume(.5)
    }
    else {
      video.muted = true
      setVolume(0)
    }
  }
  const beginPlaybarDrag = () => {
    const move = (event: MouseEvent | TouchEvent) => {
      const bar = playBarRef.current
      if (bar) seek(((mediaEventClientX(event) - bar.getBoundingClientRect().left) / bar.clientWidth) * duration)
    }
    const up = (event: MouseEvent | TouchEvent) => {
      move(event)
      document.removeEventListener('mousemove', move)
      document.removeEventListener('touchmove', move)
      document.removeEventListener('mouseup', up)
      document.removeEventListener('touchend', up)
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('touchmove', move)
    document.addEventListener('mouseup', up)
    document.addEventListener('touchend', up)
  }
  const beginVolumeDrag = () => {
    const move = (event: MouseEvent | TouchEvent) => {
      const bar = volumeBarRef.current
      if (bar) setVolume((mediaEventClientX(event) - bar.getBoundingClientRect().left) / 45)
    }
    const up = () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('touchmove', move)
      document.removeEventListener('mouseup', up)
      document.removeEventListener('touchend', up)
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('touchmove', move)
    document.addEventListener('mouseup', up)
    document.addEventListener('touchend', up)
  }
  return (
    <div
      className={`mona-video-player${controllerHidden ? ' is-controller-hidden' : ''}`}
      onClick={showController}
      onMouseMove={showController}
      style={{ width: element.width * safeScale, height: element.height * safeScale, transform: `scale(${1 / safeScale})` }}
    >
      <div className="mona-video-wrap" onClick={toggle}>
        {loadError ? <div className="mona-video-load-error">{t('foundation.editor.media.loadFailed')}</div> : null}
        <canvas className="mona-video-bg-canvas" ref={backgroundCanvasRef} />
        <video
          className="mona-video-native"
          crossOrigin="anonymous"
          onDurationChange={event => setDuration(event.currentTarget.duration || 0)}
          onEnded={() => loop ? (seek(0), play()) : pause()}
          onError={event => {
            event.stopPropagation()
            setLoadError(true)
          }}
          onPause={showController}
          onPlay={() => {
            showController(); setPaused(false)
          }}
          onProgress={event => {
            const video = event.currentTarget
            setLoaded(video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0)
          }}
          onLoadedMetadata={event => {
            const video = event.currentTarget
            video.requestVideoFrameCallback(() => {
              const canvas = backgroundCanvasRef.current
              const context = canvas?.getContext('2d')
              if (canvas && context) context.drawImage(video, 0, 0, canvas.width, canvas.height)
            })
          }}
          onTimeUpdate={event => setCurrentTime(event.currentTarget.currentTime || 0)}
          playsInline
          webkit-playsinline="true"
          poster={element.poster}
          ref={videoRef}
          autoPlay={autoplay}
          src={element.src || undefined}
        />
        <div className="mona-video-bezel"><span className={bezel ? 'is-active' : ''} onAnimationEnd={() => setBezel(false)}>{paused ? <PauseIcon /> : <PlayIcon />}</span></div>
      </div>
      <div className="mona-video-controller-mask" />
      <div className="mona-video-controller">
        <div className="absolute bottom-0 left-5 flex h-9.5 items-center">
          <Button aria-label={paused ? 'Play' : 'Pause'} className={cn(PLAYER_ICON, 'w-10 text-[26px]')} onClick={event => {
            event.stopPropagation(); toggle()
          }} size={null} type="button" variant={null}><span>{paused ? <PlayIcon /> : <PauseIcon />}</span></Button>
          <div className="relative flex h-full cursor-pointer items-center">
            <Button aria-label="Volume" className={cn(PLAYER_ICON, 'w-10')} onClick={event => {
              event.stopPropagation(); toggleVolume()
            }} size={null} type="button" variant={null}><span>{volume === 0 ? <VolumeMuteIcon /> : volume === 1 ? <VolumeNoticeIcon /> : <VolumeSmallIcon />}</span></Button>
            <div className="mona-player-volume-wrap" onClick={event => {
              event.stopPropagation()
              const bar = volumeBarRef.current
              if (bar) setVolume((event.clientX - bar.getBoundingClientRect().left) / 45)
            }} onMouseDown={beginVolumeDrag} onTouchStart={beginVolumeDrag}>
              <div className="mona-player-volume-bar" ref={volumeBarRef}><div className="mona-player-volume-inner" style={{ width: `${volume * 100}%` }}><span /></div></div>
            </div>
          </div>
          <span className="mona-video-time"><span>{secondToTime(currentTime)}</span> / <span>{secondToTime(duration)}</span></span>
        </div>
        <div className="absolute right-3.75 bottom-0 flex h-9.5 items-center">
          <div className="relative h-3">
            <DropdownMenu onOpenChange={setRateMenu} open={rateMenu}>
              <DropdownMenuTrigger asChild>
                <Button className={cn(PLAYER_ICON, 'w-10 text-xs')} onClick={event => event.stopPropagation()} size={null} type="button" variant={null}>
                  <span>{rate === 1 ? t('foundation.editor.media.speed') : `${rate}x`}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" className="w-auto min-w-17.5" side="top">
                {rates.map(value => (
                  <DropdownMenuItem className={cn('justify-center', value === rate && 'font-bold')} key={value} onSelect={() => {
                    if (videoRef.current) videoRef.current.playbackRate = value
                    setRate(value)
                  }}>{value}x</DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <Button className={cn(PLAYER_ICON, 'w-10 text-xs', loop && '[&>span]:opacity-100')} onClick={event => {
            event.stopPropagation(); setLoop(value => !value)
          }} size={null} type="button" variant={null}><span>{t('foundation.editor.media.loopStatus', { status: t(`foundation.editor.media.${loop ? 'on' : 'off'}`) })}</span></Button>
        </div>
        <div
          className="mona-player-bar-wrap"
          onClick={event => event.stopPropagation()}
          onMouseDown={beginPlaybarDrag}
          onTouchStart={beginPlaybarDrag}
          onMouseEnter={() => setBarHover(value => ({ ...value, visible: true }))}
          onMouseLeave={() => setBarHover(value => ({ ...value, visible: false }))}
          onMouseMove={event => {
            const bar = playBarRef.current
            if (!bar || !duration) return
            const x = event.clientX - bar.getBoundingClientRect().left
            if (x < 0 || x > bar.offsetWidth) return
            const time = duration * (x / bar.offsetWidth)
            setBarHover({ left: x - (time >= 3600 ? 25 : 20), time: secondToTime(time), visible: true })
          }}
          ref={playBarRef}
        >
          <div className={`mona-player-bar-time${barHover.visible ? '' : ' is-hidden'}`} style={{ left: barHover.left }}>{barHover.time}</div>
          <div className="mona-player-bar"><div className="mona-player-loaded" style={{ width: `${duration ? loaded / duration * 100 : 0}%` }} /><div className="mona-player-played" style={{ width: `${duration ? currentTime / duration * 100 : 0}%` }}><span /></div></div>
        </div>
      </div>
    </div>
  )
}

export function VideoElement({ editor, element, screen }: { editor?: MediaElementEditor; element: PPTVideoElement; screen?: MediaElementScreen }) {
  const { t } = useTranslation()
  return (
    <div
      className={`mona-element mona-video-element${element.lock ? ' is-locked' : ''}`}
      data-element-id={element.id}
      data-element-type="video"
      style={{ top: element.top, left: element.left, width: element.width, height: element.height }}
    >
      <div className="mona-rotate-wrapper" style={{ transform: `rotate(${element.rotate}deg)` }}>
        {screen ? (
          <div className="mona-video-screen-content">
            {screen.active ? <VideoPlayer autoplay={element.autoplay} element={element} scale={screen.scale} /> : null}
          </div>
        ) : editor ? (
          <div
            aria-label={t('foundation.editor.selectElement', { type: element.type, id: element.id })}
            className="mona-video-editor-content"
            onContextMenu={editor.onContextMenu}
            onPointerDown={event => editor.onPointerDown(event, false)}
            role="button"
            tabIndex={0}
          >
            <VideoPlayer element={element} scale={editor.scale} />
            {(['top', 'bottom', 'left', 'right'] as const).map(side => <span className={`mona-video-drag-border is-${side}`} key={side} onPointerDown={event => editor.onPointerDown(event, true)} />)}
          </div>
        ) : (
          <div className="mona-video-content" style={{ backgroundImage: element.poster ? `url(${element.poster})` : '' }}><StaticVideoIcon /></div>
        )}
      </div>
    </div>
  )
}

export function AudioElement({ editor, element, screen }: { editor?: MediaElementEditor; element: PPTAudioElement; screen?: MediaElementScreen }) {
  const { t } = useTranslation()
  const screenAudioRef = useRef<AudioPlayerHandle>(null)
  const size = Math.min(element.width, element.height)
  const mediaContext = screen || editor
  const mediaScale = mediaContext && Number.isFinite(mediaContext.scale) && mediaContext.scale > 0 ? mediaContext.scale : 1
  const audioWidth = mediaContext ? 280 / mediaScale : 0
  const audioHeight = mediaContext ? 50 / mediaScale : 0
  const playerPosition = mediaContext ? {
    left: element.left + audioWidth >= mediaContext.viewportSize ? element.width - audioWidth : 0,
    top: element.top + element.height + audioHeight >= mediaContext.viewportSize * mediaContext.viewportRatio ? -audioHeight : element.height,
  } : { left: 0, top: element.height }
  return (
    <div
      className={`mona-element mona-audio-element${element.lock ? ' is-locked' : ''}`}
      data-element-id={element.id}
      data-element-type="audio"
      style={{ top: element.top, left: element.left, width: element.width, height: element.height }}
    >
      <div className="mona-rotate-wrapper" style={{ transform: `rotate(${element.rotate}deg)` }}>
        <div
          aria-label={editor ? t('foundation.editor.selectElement', { type: element.type, id: element.id }) : undefined}
          className={`mona-audio-content${screen ? ' is-screen' : ''}`}
          onContextMenu={editor?.onContextMenu}
          onPointerDown={editor ? event => editor.onPointerDown(event, true) : undefined}
          role={editor ? 'button' : undefined}
          style={{ color: element.color }}
          tabIndex={editor ? 0 : undefined}
        >
          <span onClick={screen ? () => screenAudioRef.current?.toggle() : undefined} style={{ display: 'block', height: size, width: size }}><StaticVolumeIcon /></span>
          {screen?.active ? <AudioPlayer autoplay={element.autoplay} element={element} ref={screenAudioRef} scale={screen.scale} style={playerPosition} /> : editor?.active ? <AudioPlayer element={element} scale={editor.scale} style={playerPosition} /> : null}
        </div>
      </div>
    </div>
  )
}
