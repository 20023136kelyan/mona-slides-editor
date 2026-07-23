import { useEffect, useRef, useState, type WheelEvent } from 'react'
import { useTranslation } from 'react-i18next'

import type { PresentationState } from '@mona/presentation-core'

import ArrowBackIcon from '~icons/icon-park-outline/arrow-circle-left'

import { Button } from '@/components/ui/button'
import { ScaledSlide } from '@/features/presentation-renderer/ScaledSlide'
import type { ScreenPresentationController } from '@/features/screen/screen-types'

const scrollActiveIntoCenter = (container: HTMLElement | null) => {
  if (!container) return
  const active = container.querySelector<HTMLElement>('.mona-screen-thumbnail.is-active')
  if (!active) return
  const left = active.offsetLeft + active.clientWidth / 2 - container.offsetWidth / 2
  container.scrollTo({ behavior: 'smooth', left })
}

const useSlidesLoadLimit = (slideCount: number) => {
  const [limit, setLimit] = useState(() => slideCount <= 50 ? 9999 : 50)
  useEffect(() => {
    if (slideCount <= limit) return undefined
    const timer = window.setTimeout(() => setLimit(current => {
      const next = current + 20
      return slideCount <= next ? 9999 : next
    }), 600)
    return () => window.clearTimeout(timer)
  }, [limit, slideCount])
  return limit
}

const useScrollActiveOnChange = (ref: React.RefObject<HTMLDivElement | null>, slideIndex: number) => {
  const previousSlideIndex = useRef(slideIndex)
  useEffect(() => {
    if (previousSlideIndex.current === slideIndex) return
    previousSlideIndex.current = slideIndex
    scrollActiveIntoCenter(ref.current)
  }, [ref, slideIndex])
}

const Thumbnail = ({
  active,
  onClick,
  presentation,
  size,
  slideIndex,
  visible,
}: {
  active: boolean
  onClick: () => void
  presentation: PresentationState
  size: number
  slideIndex: number
  visible: boolean
}) => {
  const { t } = useTranslation()
  return (
    <Button
      aria-current={active ? 'page' : undefined}
      aria-label={t('screen.slideNumber', { current: slideIndex + 1, total: presentation.slides.length })}
      className={`mona-screen-thumbnail${active ? ' is-active' : ''}`}
      data-slide-index={slideIndex}
      onClick={onClick}
      size={null}
      type="button"
      variant={null}
    >
      <ScaledSlide
        fixedWidth={size}
        slide={presentation.slides[slideIndex]!}
        sourcePackages={presentation.sourcePackages}
        theme={presentation.theme}
        thumbnail
        viewportRatio={presentation.viewportRatio}
        viewportSize={presentation.viewportSize}
        visible={visible}
      />
    </Button>
  )
}

export function ScreenBottomThumbnails({
  controller,
  turnSlideToIndex,
}: {
  controller: ScreenPresentationController
  // Quirk retired: the established editor's BottomThumbnails instantiated a second full
  // playback engine (extra keydown listener + broadcast posts) just to turn
  // slides. The bar now borrows the view's single hoisted playback.
  turnSlideToIndex: (index: number) => void
}) {
  const { presentation } = controller
  const ref = useRef<HTMLDivElement>(null)
  const slidesLoadLimit = useSlidesLoadLimit(presentation.slides.length)
  useScrollActiveOnChange(ref, presentation.slideIndex)
  const wheel = (event: WheelEvent) => {
    event.preventDefault()
    ref.current?.scrollBy(event.deltaY, 0)
  }
  return (
    <div className="mona-screen-bottom-thumbnails">
      <div className="mona-screen-bottom-thumbnail-list" onWheel={wheel} ref={ref}>
        {presentation.slides.map((slide, index) => (
          <Thumbnail active={index === presentation.slideIndex} key={slide.id} onClick={() => turnSlideToIndex(index)} presentation={presentation} size={100 / presentation.viewportRatio} slideIndex={index} visible={index < slidesLoadLimit} />
        ))}
      </div>
    </div>
  )
}

export function ScreenAllSlides({
  onClose,
  presentation,
  turnSlideToIndex,
}: {
  onClose: () => void
  presentation: PresentationState
  turnSlideToIndex: (index: number) => void
}) {
  const { t } = useTranslation()
  const rootRef = useRef<HTMLDialogElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const slidesLoadLimit = useSlidesLoadLimit(presentation.slides.length)
  useEffect(() => {
    closeRef.current?.focus()
    const root = rootRef.current
    if (!root) return undefined
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const controls = Array.from(root.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])'))
      if (!controls.length) return
      const first = controls[0]!
      const last = controls[controls.length - 1]!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      }
      else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    root.addEventListener('keydown', keydown)
    return () => root.removeEventListener('keydown', keydown)
  }, [onClose])
  return (
    <dialog aria-label={t('screen.allSlides')} className="mona-screen-all-slides" open ref={rootRef}>
      <div className="mona-screen-all-slides-return"><Button aria-label={t('common.close')} onClick={onClose} ref={closeRef} size={null} type="button" variant={null}><ArrowBackIcon /></Button></div>
      <div className="mona-screen-all-slides-content">
        {presentation.slides.map((slide, index) => (
          <Thumbnail active={index === presentation.slideIndex} key={slide.id} onClick={() => {
            turnSlideToIndex(index); onClose() 
          }} presentation={presentation} size={150} slideIndex={index} visible={index < slidesLoadLimit} />
        ))}
      </div>
    </dialog>
  )
}

export function ScreenPresenterThumbnails({
  presentation,
  turnSlideToIndex,
}: {
  presentation: PresentationState
  turnSlideToIndex: (index: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const slidesLoadLimit = useSlidesLoadLimit(presentation.slides.length)
  useScrollActiveOnChange(ref, presentation.slideIndex)
  return (
    <div className="mona-screen-presenter-thumbnails" onWheel={event => {
      event.preventDefault(); ref.current?.scrollBy(event.deltaY, 0) 
    }} ref={ref}>
      {presentation.slides.map((slide, index) => (
        <Thumbnail active={index === presentation.slideIndex} key={slide.id} onClick={() => turnSlideToIndex(index)} presentation={presentation} size={120 / presentation.viewportRatio} slideIndex={index} visible={index < slidesLoadLimit} />
      ))}
    </div>
  )
}
