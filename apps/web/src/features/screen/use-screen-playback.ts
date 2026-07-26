import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import throttle from 'lodash/throttle'

import {
  ANIMATION_CLASS_PREFIX,
  selectFormattedCurrentSlideAnimations,
} from '@mona/presentation-core'

import {
  type ScreenPresentationController,
  type ScreenSyncMessage,
} from '@/features/screen/screen-types'
import type { EditorNotificationService } from '@/features/editor/services/editor-notifications'
import { ScreenSyncChannel, type ScreenSyncEvent } from '@/features/screen/screen-sync'

export interface ScreenPlayback {
  animationIndex: number
  autoPlay: () => void
  autoPlayActive: boolean
  autoPlayInterval: number
  broadcastExit: () => void
  closeAutoPlay: () => void
  execNext: () => void
  execPrev: (broadcast?: boolean) => void
  laserPen: boolean
  loopPlay: boolean
  mousewheelListener: (event: WheelEvent | React.WheelEvent) => void
  restoreAnimationState: (targetIndex: number) => void
  setAnimationIndex: (index: number) => void
  setAutoPlayInterval: (interval: number) => void
  setLaserPen: (active: boolean) => void
  setLoopPlay: (active: boolean) => void
  touchEndListener: (event: React.TouchEvent) => void
  touchStartListener: (event: React.TouchEvent) => void
  turnNextSlide: () => void
  turnPrevSlide: () => void
  turnSlideToId: (id: string) => void
  turnSlideToIndex: (index: number) => void
}

export const useScreenPlayback = ({
  audience = false,
  controller,
  notify,
}: {
  audience?: boolean
  controller: ScreenPresentationController
  notify?: EditorNotificationService['notify']
}): ScreenPlayback => {
  const { t } = useTranslation()
  const { presentation, setSlideIndex } = controller
  const formattedAnimations = useMemo(
    () => selectFormattedCurrentSlideAnimations(presentation),
    [presentation],
  )
  const [animationIndex, setAnimationIndex] = useState(0)
  const [autoPlayActive, setAutoPlayActive] = useState(false)
  const [autoPlayInterval, setAutoPlayIntervalState] = useState(2500)
  const [loopPlay, setLoopPlayState] = useState(false)
  const [laserPen, setLaserPen] = useState(false)
  const channelRef = useRef<ScreenSyncChannel | null>(null)
  const autoPlayTimerRef = useRef<number | null>(null)
  const touchInfoRef = useRef<{ x: number; y: number } | null>(null)
  const lastWheelAtRef = useRef(0)
  const lastBoundaryNoticeAtRef = useRef(0)
  const presentationRef = useRef(presentation)
  const animationIndexRef = useRef(animationIndex)
  const formattedRef = useRef(formattedAnimations)
  const inAnimationRef = useRef(false)
  const playedSlidesMinIndexRef = useRef(presentation.slideIndex)
  const loopPlayRef = useRef(loopPlay)
  const execNextRef = useRef<() => void>(() => {})
  const execPrevRef = useRef<(broadcast?: boolean) => void>(() => {})
  const runAnimationRef = useRef<() => void>(() => {})

  useLayoutEffect(() => {
    presentationRef.current = presentation
    animationIndexRef.current = animationIndex
    formattedRef.current = formattedAnimations
    loopPlayRef.current = loopPlay
  }, [animationIndex, formattedAnimations, loopPlay, presentation])

  const setAnimationPosition = useCallback((index: number) => {
    animationIndexRef.current = index
    setAnimationIndex(index)
  }, [])
  const setAnimating = useCallback((active: boolean) => {
    inAnimationRef.current = active
  }, [])
  const closeAutoPlay = useCallback(() => {
    if (autoPlayTimerRef.current !== null) window.clearInterval(autoPlayTimerRef.current)
    autoPlayTimerRef.current = null
    setAutoPlayActive(false)
  }, [])
  const postBoundaryNotice = useCallback((text: string) => {
    const now = Date.now()
    if (now - lastBoundaryNoticeAtRef.current < 1000) return
    lastBoundaryNoticeAtRef.current = now
    notify?.({ text, type: 'success' })
  }, [notify])
  const postNotice = useCallback((text: string) => {
    notify?.({ text, type: 'success' })
  }, [notify])

  const animationElement = useCallback((elementId: string) => (
    document.querySelector<HTMLElement>(`#screen-element-${CSS.escape(elementId)} [data-element-id]`)
  ), [])

  const runAnimation = useCallback(() => {
    if (inAnimationRef.current) return
    const position = formattedRef.current[animationIndexRef.current]
    if (!position) return
    setAnimationPosition(animationIndexRef.current + 1)
    setAnimating(true)
    let ended = 0
    for (const animation of position.animations) {
      const element = animationElement(animation.elId)
      if (!element) {
        ended += 1
        continue
      }
      const animationName = `${ANIMATION_CLASS_PREFIX}${animation.effect}`
      element.style.removeProperty('--animate-duration')
      for (const className of [...element.classList]) {
        if (className.includes(ANIMATION_CLASS_PREFIX)) element.classList.remove(className, `${ANIMATION_CLASS_PREFIX}animated`)
      }
      element.style.setProperty('--animate-duration', `${animation.duration}ms`)
      element.classList.add(animationName, `${ANIMATION_CLASS_PREFIX}animated`)
      element.addEventListener('animationend', () => {
        if (animation.type !== 'out') {
          element.style.removeProperty('--animate-duration')
          element.classList.remove(animationName, `${ANIMATION_CLASS_PREFIX}animated`)
        }
        ended += 1
        if (ended === position.animations.length) {
          setAnimating(false)
          if (position.autoNext) runAnimationRef.current()
        }
      }, { once: true })
    }
  }, [animationElement, setAnimating, setAnimationPosition])

  const restoreAnimationState = useCallback((targetIndex: number) => {
    for (let index = 0; index < targetIndex && index < formattedRef.current.length; index += 1) {
      for (const animation of formattedRef.current[index]!.animations) {
        if (animation.type !== 'out') continue
        const element = animationElement(animation.elId)
        if (!element) continue
        element.style.setProperty('--animate-duration', '0ms')
        element.classList.add(`${ANIMATION_CLASS_PREFIX}${animation.effect}`, `${ANIMATION_CLASS_PREFIX}animated`)
      }
    }
  }, [animationElement])

  const revokeAnimation = useCallback(() => {
    const nextIndex = animationIndexRef.current - 1
    setAnimationPosition(nextIndex)
    const position = formattedRef.current[nextIndex]
    if (!position) return
    for (const animation of position.animations) {
      const element = animationElement(animation.elId)
      if (!element) continue
      element.style.removeProperty('--animate-duration')
      for (const className of [...element.classList]) {
        if (className.includes(ANIMATION_CLASS_PREFIX)) element.classList.remove(className, `${ANIMATION_CLASS_PREFIX}animated`)
      }
    }
    if (position.animations.every(item => item.type === 'attention')) execPrevRef.current(false)
  }, [animationElement, setAnimationPosition])

  const turnSlideToIndex = useCallback((index: number) => {
    channelRef.current?.postMessage({ type: 'TURN_TO_INDEX', index } satisfies ScreenSyncMessage)
    setSlideIndex(index)
    setAnimationPosition(0)
    // A jump mid-animation unmounts the animated elements, so their
    // animationend never fires; without this reset "next" wedges on any
    // slide that has animations. (Shared the source editor defect, fixed here.)
    inAnimationRef.current = false
  }, [setAnimationPosition, setSlideIndex])
  const turnSlideToId = useCallback((id: string) => {
    const index = presentationRef.current.slides.findIndex(slide => slide.id === id)
    if (index === -1) return
    channelRef.current?.postMessage({ type: 'TURN_TO_ID', id } satisfies ScreenSyncMessage)
    setSlideIndex(index)
    setAnimationPosition(0)
    inAnimationRef.current = false
  }, [setAnimationPosition, setSlideIndex])
  const turnPrevSlide = useCallback(() => {
    setSlideIndex(presentationRef.current.slideIndex - 1)
    setAnimationPosition(0)
  }, [setAnimationPosition, setSlideIndex])
  const turnNextSlide = useCallback(() => {
    setSlideIndex(presentationRef.current.slideIndex + 1)
    setAnimationPosition(0)
  }, [setAnimationPosition, setSlideIndex])

  const execPrev = useCallback((broadcast = true) => {
    if (broadcast) channelRef.current?.postMessage({ type: 'EXEC_PREV' } satisfies ScreenSyncMessage)
    const state = presentationRef.current
    if (formattedRef.current.length && animationIndexRef.current > 0) revokeAnimation()
    else if (state.slideIndex > 0) {
      const nextSlideIndex = state.slideIndex - 1
      setSlideIndex(nextSlideIndex)
      if (nextSlideIndex < playedSlidesMinIndexRef.current) {
        playedSlidesMinIndexRef.current = nextSlideIndex
        setAnimationPosition(0)
      }
      else {
        const nextState = { ...state, slideIndex: nextSlideIndex }
        setAnimationPosition(selectFormattedCurrentSlideAnimations(nextState).length)
      }
    }
    else if (loopPlayRef.current) turnSlideToIndex(state.slides.length - 1)
    else postBoundaryNotice(t('runtime.alreadyFirstSlide'))
    setAnimating(false)
  }, [postBoundaryNotice, revokeAnimation, setAnimating, setAnimationPosition, setSlideIndex, t, turnSlideToIndex])

  const execNext = useCallback(() => {
    channelRef.current?.postMessage({ type: 'EXEC_NEXT' } satisfies ScreenSyncMessage)
    const state = presentationRef.current
    if (formattedRef.current.length && animationIndexRef.current < formattedRef.current.length) runAnimation()
    else if (state.slideIndex < state.slides.length - 1) {
      setSlideIndex(state.slideIndex + 1)
      setAnimationPosition(0)
      setAnimating(false)
    }
    else if (loopPlayRef.current) turnSlideToIndex(0)
    else {
      postBoundaryNotice(t('runtime.alreadyLastSlide'))
      closeAutoPlay()
      setAnimating(false)
    }
  }, [closeAutoPlay, postBoundaryNotice, runAnimation, setAnimating, setAnimationPosition, setSlideIndex, t, turnSlideToIndex])
  useLayoutEffect(() => {
    execNextRef.current = execNext
    execPrevRef.current = execPrev
    runAnimationRef.current = runAnimation
  }, [execNext, execPrev, runAnimation])

  useEffect(() => {
    if (audience) return undefined
    const state = presentationRef.current
    const durationMs = state.slides[state.slideIndex]?.durationMs
    if (!durationMs) return undefined
    const timer = window.setTimeout(() => {
      const current = presentationRef.current
      if (current.slideIndex < current.slides.length - 1) turnSlideToIndex(current.slideIndex + 1)
      else if (loopPlayRef.current) turnSlideToIndex(0)
    }, durationMs)
    return () => window.clearTimeout(timer)
  }, [audience, presentation.slideIndex, presentation.slides, turnSlideToIndex])

  const autoPlay = useCallback(() => {
    closeAutoPlay()
    postNotice(t('runtime.autoPlayStarted'))
    autoPlayTimerRef.current = window.setInterval(() => execNextRef.current(), autoPlayInterval)
    setAutoPlayActive(true)
  }, [autoPlayInterval, closeAutoPlay, postNotice, t])
  const setAutoPlayInterval = useCallback((interval: number) => {
    closeAutoPlay()
    setAutoPlayIntervalState(interval)
    postNotice(t('runtime.autoPlayStarted'))
    autoPlayTimerRef.current = window.setInterval(() => execNextRef.current(), interval)
    setAutoPlayActive(true)
  }, [closeAutoPlay, postNotice, t])

  const mousewheelListener = useCallback((event: WheelEvent | React.WheelEvent) => {
    const now = Date.now()
    if (now - lastWheelAtRef.current < 500) return
    lastWheelAtRef.current = now
    if (event.deltaY < 0) execPrevRef.current()
    else if (event.deltaY > 0) execNextRef.current()
  }, [])
  const touchStartListener = useCallback((event: React.TouchEvent) => {
    const touch = event.changedTouches[0]
    if (touch) touchInfoRef.current = { x: touch.pageX, y: touch.pageY }
  }, [])
  const touchEndListener = useCallback((event: React.TouchEvent) => {
    const start = touchInfoRef.current
    const touch = event.changedTouches[0]
    if (!start || !touch) return
    const offsetX = Math.abs(start.x - touch.pageX)
    const offsetY = touch.pageY - start.y
    if (Math.abs(offsetY) > offsetX && Math.abs(offsetY) > 50) {
      touchInfoRef.current = null
      if (offsetY > 0) execPrevRef.current()
      else execNextRef.current()
    }
  }, [])

  useEffect(() => {
    if (audience) return undefined
    const channel = new ScreenSyncChannel()
    channelRef.current = channel
    channel.onmessage = ({ data }: ScreenSyncEvent) => {
      if (data.type !== 'REQUEST_STATE') return
      const state = presentationRef.current
      channel.postMessage({
        type: 'INIT_STATE',
        slideIndex: state.slideIndex,
        animationIndex: animationIndexRef.current,
        viewportSize: state.viewportSize,
        viewportRatio: state.viewportRatio,
        slides: structuredClone(state.slides),
      } satisfies ScreenSyncMessage)
    }
    return () => {
      channelRef.current = null
      channel.close()
    }
  }, [audience])

  useEffect(() => {
    if (audience) return undefined
    const keydown = throttle((event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('a, button, input, select, textarea, [contenteditable="true"], [role="menuitem"]')) return
      const key = event.key.toUpperCase()
      if (['ARROWUP', 'ARROWLEFT', 'PAGEUP'].includes(key)) execPrevRef.current()
      else if (['ARROWDOWN', 'ARROWRIGHT', ' ', 'ENTER', 'PAGEDOWN'].includes(key)) execNextRef.current()
    }, 500, { leading: true, trailing: false })
    document.addEventListener('keydown', keydown)
    return () => document.removeEventListener('keydown', keydown)
  }, [audience])

  useEffect(() => {
    if (!laserPen || audience) return undefined
    const move = throttle((event: MouseEvent) => {
      const slide = document.querySelector<HTMLElement>('.mona-screen-slide-list .mona-screen-slide-item.is-current .mona-screen-slide-content')
      if (!slide) return
      const rect = slide.getBoundingClientRect()
      channelRef.current?.postMessage({
        type: 'LASER_PEN_MOVE',
        x: (event.clientX - rect.left) / rect.width,
        y: (event.clientY - rect.top) / rect.height,
      } satisfies ScreenSyncMessage)
    }, 30, { leading: true, trailing: true })
    document.addEventListener('mousemove', move)
    return () => {
      document.removeEventListener('mousemove', move)
      channelRef.current?.postMessage({ type: 'LASER_PEN_OFF' } satisfies ScreenSyncMessage)
    }
  }, [audience, laserPen])

  useEffect(() => {
    const first = formattedRef.current[0]
    if (first?.animations.length && first.animations.every(item => item.trigger === 'auto' || item.trigger === 'meantime')) runAnimationRef.current()
    return closeAutoPlay
    // Playback initialization is intentionally one-shot, matching the mounted Vue hook.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    animationIndex,
    autoPlay,
    autoPlayActive,
    autoPlayInterval,
    broadcastExit: () => channelRef.current?.postMessage({ type: 'EXIT' } satisfies ScreenSyncMessage),
    closeAutoPlay,
    execNext,
    execPrev,
    laserPen,
    loopPlay,
    mousewheelListener,
    restoreAnimationState,
    setAnimationIndex: setAnimationPosition,
    setAutoPlayInterval,
    setLaserPen,
    setLoopPlay: active => {
      loopPlayRef.current = active
      setLoopPlayState(active)
    },
    touchEndListener,
    touchStartListener,
    turnNextSlide,
    turnPrevSlide,
    turnSlideToId,
    turnSlideToIndex,
  }
}
