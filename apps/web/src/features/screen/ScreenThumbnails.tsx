/* oxlint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- exact PPTist thumbnail tiles are pointer-selectable divs. */
import { useEffect, useRef, useState, type WheelEvent } from 'react'

import type { PresentationState } from '@mona/presentation-core'

import ArrowBackIcon from '~icons/icon-park-outline/arrow-circle-left'

import { ScaledSlide } from '@/features/presentation-renderer/ScaledSlide'
import type { ScreenPresentationController } from '@/features/screen/screen-types'
import { useScreenPlayback } from '@/features/screen/use-screen-playback'

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
}) => (
  <div className={`mona-screen-thumbnail${active ? ' is-active' : ''}`} data-slide-index={slideIndex} onClick={onClick}>
    <ScaledSlide
      fixedWidth={size}
      slide={presentation.slides[slideIndex]!}
      theme={presentation.theme}
      thumbnail
      viewportRatio={presentation.viewportRatio}
      viewportSize={presentation.viewportSize}
      visible={visible}
    />
  </div>
)

export function ScreenBottomThumbnails({
  controller,
}: {
  controller: ScreenPresentationController
}) {
  const { presentation } = controller
  const playback = useScreenPlayback({ controller })
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
          <Thumbnail active={index === presentation.slideIndex} key={slide.id} onClick={() => playback.turnSlideToIndex(index)} presentation={presentation} size={100 / presentation.viewportRatio} slideIndex={index} visible={index < slidesLoadLimit} />
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
  const slidesLoadLimit = useSlidesLoadLimit(presentation.slides.length)
  return (
    <div className="mona-screen-all-slides">
      <div className="mona-screen-all-slides-return"><ArrowBackIcon onClick={onClose} /></div>
      <div className="mona-screen-all-slides-content">
        {presentation.slides.map((slide, index) => (
          <Thumbnail active={index === presentation.slideIndex} key={slide.id} onClick={() => {
            turnSlideToIndex(index); onClose() 
          }} presentation={presentation} size={150} slideIndex={index} visible={index < slidesLoadLimit} />
        ))}
      </div>
    </div>
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
