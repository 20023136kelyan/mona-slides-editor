import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'

import CloseIcon from '~icons/icon-park-outline/close'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ScreenMoveablePanel } from '@/features/screen/ScreenMoveablePanel'

const fillDigit = (value: number, length: number) => String(value).padStart(length, '0')

export function ScreenCountdownTimer({
  left = 5,
  onClose,
  top = 5,
}: {
  left?: number
  onClose: () => void
  top?: number
}) {
  const { t } = useTranslation()
  const [timing, setTiming] = useState(false)
  const [countdown, setCountdown] = useState(false)
  const [time, setTime] = useState(0)
  const timerRef = useRef<number | null>(null)
  const startButtonRef = useRef<HTMLButtonElement | null>(null)
  const timeRef = useRef(0)
  const minute = Math.floor(time / 60)
  const second = time % 60
  const inputsDisabled = !countdown || timing

  const clearTimer = () => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current)
    timerRef.current = null
  }
  const pause = () => {
    clearTimer()
    setTiming(false)
  }
  const updateTime = (value: number) => {
    timeRef.current = value
    setTime(value)
  }
  const reset = () => {
    clearTimer()
    setTiming(false)
    updateTime(countdown ? 600 : 0)
  }
  const start = () => {
    clearTimer()
    timerRef.current = window.setInterval(() => {
      const next = timeRef.current + (countdown ? -1 : 1)
      updateTime(next)
      if (countdown && next <= 0) {
        clearTimer()
        setTiming(false)
        updateTime(600)
      }
      else if (!countdown && next > 36000) pause()
    }, 1000)
    setTiming(true)
  }
  const toggleCountdown = () => {
    clearTimer()
    setTiming(false)
    const next = !countdown
    setCountdown(next)
    updateTime(next ? 600 : 0)
  }
  const changeTime = (event: FocusEvent<HTMLInputElement> | KeyboardEvent<HTMLInputElement>, type: 'minute' | 'second') => {
    const input = event.currentTarget
    let value = input.value
    if (/^(\d)+$/.test(value)) {
      if (type === 'second' && Number(value) >= 60) value = '59'
      updateTime(type === 'minute' ? Number(value) * 60 + second : Number(value) + minute * 60)
    }
    else input.value = type === 'minute' ? fillDigit(minute, 2) : fillDigit(second, 2)
  }
  useEffect(() => clearTimer, [])
  useEffect(() => startButtonRef.current?.focus(), [])
  const inputKeyDown = (event: KeyboardEvent<HTMLInputElement>, type: 'minute' | 'second') => {
    event.stopPropagation()
    if (event.key === 'Enter') changeTime(event, type)
  }

  return (
    <ScreenMoveablePanel ariaLabel={t('screen.timer')} className="shadow-[0_4px_6px_-1px_rgb(0_0_0/10%),0_2px_4px_-2px_rgb(0_0_0/10%)] select-none" height={110} left={left} onEscape={onClose} top={top} width={180}>
      <div className="mb-4 flex h-4 items-center text-control [&>button]:mr-2 [&>button]:border-0 [&>button]:bg-transparent [&>button]:p-0 [&>button]:text-inherit [&>button:hover]:text-editor-selection [&>button:focus-visible]:text-editor-selection">
        <Button onClick={() => timing ? pause() : start()} ref={startButtonRef} size={null} type="button" variant={null}>{t(timing ? 'timer.pause' : 'timer.start')}</Button>
        <Button onClick={reset} size={null} type="button" variant={null}>{t('common.reset')}</Button>
        <Button aria-pressed={countdown} className={cn(countdown && 'text-editor-selection')} onClick={toggleCountdown} size={null} type="button" variant={null}>{t('timer.countdown')}</Button>
      </div>
      <div className="flex justify-between px-1.25">
        <div className="size-13.5 overflow-hidden rounded-pill bg-editor-selection-subtle [&_input]:box-content [&_input]:size-full [&_input]:border-0 [&_input]:bg-transparent [&_input]:px-0.5 [&_input]:py-px [&_input]:text-center [&_input]:text-[22px] [&_input]:outline-0">
          <input aria-label={t('timer.minutes')} disabled={inputsDisabled} key={`minute-${minute}-${inputsDisabled}`} maxLength={3} onBlur={event => changeTime(event, 'minute')} onKeyDown={event => inputKeyDown(event, 'minute')} onMouseDown={event => event.stopPropagation()} type="text" defaultValue={fillDigit(minute, 2)} />
        </div>
        <div className="h-13.5 text-[22px] leading-[54px]">:</div>
        <div className="size-13.5 overflow-hidden rounded-pill bg-editor-selection-subtle [&_input]:box-content [&_input]:size-full [&_input]:border-0 [&_input]:bg-transparent [&_input]:px-0.5 [&_input]:py-px [&_input]:text-center [&_input]:text-[22px] [&_input]:outline-0">
          <input aria-label={t('timer.seconds')} disabled={inputsDisabled} key={`second-${second}-${inputsDisabled}`} maxLength={3} onBlur={event => changeTime(event, 'second')} onKeyDown={event => inputKeyDown(event, 'second')} onMouseDown={event => event.stopPropagation()} type="text" defaultValue={fillDigit(second, 2)} />
        </div>
      </div>
      <Button aria-label={t('common.close')} className="absolute top-0 right-0 border-0 bg-transparent p-2.5 leading-none text-inherit hover:text-editor-selection focus-visible:text-editor-selection" onClick={onClose} size={null} type="button" variant={null}><CloseIcon /></Button>
    </ScreenMoveablePanel>
  )
}
