/* oxlint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- slideshow links and the full-screen navigation surface intentionally mirror PPTist's pointer behavior. */
import { useMemo, type MouseEvent } from 'react'

import { selectFormattedCurrentSlideAnimations, type PresentationState, type Slide, type TurningMode } from '@mona/presentation-core'

import { ElementRenderer } from '@/features/presentation-renderer/ElementRenderer'
import { getSlideBackgroundStyle } from '@/features/presentation-renderer/render-utils'

const RANDOM_TURNING_MODES: TurningMode[] = ['slideX', 'slideY', 'slideX3D', 'slideY3D', 'fade', 'rotate', 'scaleY', 'scaleX', 'scale', 'scaleReverse']

const resolveTurningModes = (slides: readonly Slide[]) => slides.map(slide => {
  let turningMode = slide.turningMode || 'slideY'
  // PPTist intentionally draws a fresh mode whenever the slides collection invalidates.
  // eslint-disable-next-line react-hooks/purity
  if (turningMode === 'random') turningMode = RANDOM_TURNING_MODES[Math.floor(Math.random() * RANDOM_TURNING_MODES.length)]!
  return { ...slide, turningMode }
})

interface ScreenSlideListProps {
  animationIndex: number
  manualExitFullscreen: () => void
  presentation: PresentationState
  slideHeight: number
  slideWidth: number
  turnSlideToId: (id: string) => void
}

const needsEntryWait = (
  presentation: PresentationState,
  elementId: string,
  animationIndex: number,
) => {
  const formatted = selectFormattedCurrentSlideAnimations(presentation)
  const position = formatted.findIndex(item => item.animations.some(animation => animation.elId === elementId))
  if (position === -1 || position < animationIndex) return false
  return formatted[position]!.animations.find(animation => animation.elId === elementId)?.type === 'in'
}

export function ScreenSlideList({
  animationIndex,
  manualExitFullscreen,
  presentation,
  slideHeight,
  slideWidth,
  turnSlideToId,
}: ScreenSlideListProps) {
  const slides = useMemo(() => resolveTurningModes(presentation.slides), [presentation.slides])
  const currentMode = slides[presentation.slideIndex]?.turningMode
  const scale = presentation.viewportSize ? slideWidth / presentation.viewportSize : 1

  const openLink = (event: MouseEvent, slide: Slide, elementId: string) => {
    const target = event.target as HTMLElement
    if (target.tagName === 'A') {
      manualExitFullscreen()
      return
    }
    const element = slide.elements.find(candidate => candidate.id === elementId)
    const link = element?.link
    if (!link) return
    if (link.type === 'web') {
      manualExitFullscreen()
      window.open(link.target)
    }
    else turnSlideToId(link.target)
  }

  return (
    <div className="mona-screen-slide-list">
      {slides.map((slide, index) => {
        const distance = index - presentation.slideIndex
        const classNames = [
          'mona-screen-slide-item',
          `turning-mode-${slide.turningMode}`,
          index === presentation.slideIndex ? 'is-current' : '',
          index < presentation.slideIndex ? 'is-before' : '',
          index > presentation.slideIndex ? 'is-after' : '',
          index === presentation.slideIndex - 1 ? 'is-last' : '',
          index === presentation.slideIndex + 1 ? 'is-next' : '',
          (Math.abs(distance) === 1 && slide.turningMode !== currentMode) ? 'is-hidden' : '',
        ].filter(Boolean).join(' ')
        const shouldRender = Math.abs(distance) < 2 || !!slide.animations?.length
        return (
          <div className={classNames} data-slide-id={slide.id} key={slide.id}>
            {shouldRender ? (
              <div className="mona-screen-slide-content" style={{ height: slideHeight, width: slideWidth }}>
                <div
                  className="mona-screen-slide"
                  style={{
                    height: presentation.viewportSize * presentation.viewportRatio,
                    transform: `scale(${scale})`,
                    width: presentation.viewportSize,
                  }}
                >
                  <div className="mona-screen-slide-background" style={getSlideBackgroundStyle(slide.background)} />
                  {slide.elements.map((element, elementIndex) => (
                    <div
                      className={`mona-screen-element${element.link ? ' is-link' : ''}`}
                      id={`screen-element-${element.id}`}
                      key={element.id}
                      onClick={event => openLink(event, slide, element.id)}
                      style={{
                        color: presentation.theme.fontColor,
                        fontFamily: presentation.theme.fontName,
                        visibility: needsEntryWait(presentation, element.id, animationIndex) ? 'hidden' : 'visible',
                        zIndex: elementIndex + 1,
                      }}
                      title={element.link?.target || ''}
                    >
                      <ElementRenderer
                        element={element}
                        mediaScreen={{
                          active: index === presentation.slideIndex,
                          scale,
                          viewportRatio: presentation.viewportRatio,
                          viewportSize: presentation.viewportSize,
                        }}
                        theme={presentation.theme}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
