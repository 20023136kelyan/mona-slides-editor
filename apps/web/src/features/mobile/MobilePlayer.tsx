/* oxlint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- The rotated full-screen mobile navigation surface intentionally mirrors PPTist's touch/click contract. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import LogoutIcon from '~icons/icon-park-outline/logout'
import { selectPresentation } from '@mona/editor-state'

import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { useEditorSelector } from '@/features/editor/use-editor-selector'
import { MobileThumbnails } from '@/features/mobile/MobileThumbnails'
import type { MobileMode } from '@/features/mobile/MobileView'
import { ScaledSlide } from '@/features/presentation-renderer/ScaledSlide'

const RANDOM_TURNING_MODES = ['fade', 'slideX', 'slideY'] as const
const resolveTurningModes = (slides: readonly import('@mona/presentation-core/model').Slide[]) => slides.map(slide => {
  let turningMode = slide.turningMode || 'slideY'
  // PPTist intentionally resolves a fresh random transition whenever the slides collection invalidates.
  // eslint-disable-next-line react-hooks/purity
  if (turningMode === 'random') turningMode = RANDOM_TURNING_MODES[Math.floor(Math.random() * RANDOM_TURNING_MODES.length)]!
  return { ...slide, turningMode }
})

export function MobilePlayer({ changeMode, runtime }: {
  changeMode: (mode: MobileMode) => void
  runtime: EditorRuntime
}) {
  const { t } = useTranslation()
  const presentation = useEditorSelector(runtime.store, selectPresentation)
  const [toolVisible, setToolVisible] = useState(false)
  const [playerSize] = useState(() => ({ width: document.body.clientHeight, height: document.body.clientWidth }))
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (runtime.store.getState().presentation.slideIndex !== 0) runtime.focusSlide(0)
  }, [runtime])

  const slides = useMemo(() => resolveTurningModes(presentation.slides), [presentation.slides])

  const playerRatio = playerSize.width ? playerSize.height / playerSize.width : 0
  const slideSize = playerRatio >= presentation.viewportRatio
    ? { width: playerSize.width, height: playerSize.width * presentation.viewportRatio }
    : { height: playerSize.height, width: playerSize.height / presentation.viewportRatio }
  const currentMode = slides[presentation.slideIndex]?.turningMode

  const finishTouch = (event: React.TouchEvent) => {
    const start = touchStartRef.current
    const touch = event.changedTouches[0]
    touchStartRef.current = null
    if (!start || !touch) return
    const offsetX = touch.pageX - start.x
    const offsetY = touch.pageY - start.y
    const offsetAbsX = Math.abs(offsetX)
    const offsetAbsY = Math.abs(offsetY)
    if (offsetAbsX > offsetAbsY && offsetAbsX > 50) {
      if (offsetX < 0 && presentation.slideIndex > 0) runtime.focusSlide(presentation.slideIndex - 1)
      if (offsetX > 0 && presentation.slideIndex < slides.length - 1) runtime.focusSlide(presentation.slideIndex + 1)
    }
    if (offsetAbsY > offsetAbsX && offsetAbsY > 50) {
      if (offsetY > 0 && presentation.slideIndex > 0) runtime.focusSlide(presentation.slideIndex - 1)
      if (offsetY < 0 && presentation.slideIndex < slides.length - 1) runtime.focusSlide(presentation.slideIndex + 1)
    }
  }

  return (
    <div
      className="mona-mobile-player"
      style={{
        width: playerSize.width,
        height: playerSize.height,
        transform: `rotate(90deg) translateY(-${playerSize.height}px)`,
      }}
    >
      <div
        className="mona-mobile-player-slides"
        onClick={() => setToolVisible(value => !value)}
        onTouchEnd={finishTouch}
        onTouchStart={event => {
          const touch = event.changedTouches[0]
          if (touch) touchStartRef.current = { x: touch.pageX, y: touch.pageY }
        }}
      >
        {slides.map((slide, index) => {
          const distance = index - presentation.slideIndex
          const classes = [
            'mona-mobile-player-slide',
            `turning-mode-${slide.turningMode}`,
            distance === 0 ? 'is-current' : distance < 0 ? 'is-before' : 'is-after',
            distance === -1 ? 'is-last' : '',
            distance === 1 ? 'is-next' : '',
            Math.abs(distance) === 1 && slide.turningMode !== currentMode ? 'is-hidden' : '',
          ].filter(Boolean).join(' ')
          return (
            <div className={classes} key={slide.id}>
              {Math.abs(distance) < 2 ? (
                <div className="mona-mobile-player-slide-content" style={slideSize}>
                  <ScaledSlide
                    fixedWidth={slideSize.width}
                    slide={slide}
                    theme={presentation.theme}
                    thumbnail
                    viewportRatio={presentation.viewportRatio}
                    viewportSize={presentation.viewportSize}
                  />
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
      {toolVisible ? (
        <>
          <div className="mona-mobile-player-header">
            <button className="mona-mobile-player-back" onClick={() => changeMode('preview')} type="button"><LogoutIcon /> {t('mobile.exitPlay')}</button>
          </div>
          <MobileThumbnails className="mona-mobile-player-thumbnails" runtime={runtime} />
        </>
      ) : null}
    </div>
  )
}
