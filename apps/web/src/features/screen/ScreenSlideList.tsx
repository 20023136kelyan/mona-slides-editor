import { useMemo, type MouseEvent } from 'react'

import {
  compileSlideTheme,
  resolveSlideRenderState,
  selectFormattedCurrentSlideAnimations,
  type PPTElementLink,
  type PresentationState,
} from '@mona/presentation-core'

import { ElementRenderer } from '@/features/presentation-renderer/ElementRenderer'
import { getSlideBackgroundStyle } from '@/features/presentation-renderer/render-utils'
import { resolveTurningModes } from '@/features/screen/screen-presentation'

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
  const renderStates = useMemo(
    () => new Map(slides.map(slide => [
      slide.id,
      resolveSlideRenderState(slide, presentation.sourcePackages),
    ])),
    [presentation.sourcePackages, slides],
  )
  const currentMode = slides[presentation.slideIndex]?.turningMode
  const scale = presentation.viewportSize ? slideWidth / presentation.viewportSize : 1

  const openLink = (event: MouseEvent<HTMLAnchorElement>, link: PPTElementLink) => {
    event.preventDefault()
    if (link.type === 'web') {
      manualExitFullscreen()
      window.open(link.target, '_blank', 'noopener,noreferrer')
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
        const renderState = renderStates.get(slide.id)
        const effectiveTheme = compileSlideTheme(
          presentation.theme,
          renderState?.theme,
          renderState?.master,
          renderState?.layout,
          slide,
        )
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
                  <div className="mona-screen-slide-background" style={getSlideBackgroundStyle(renderState?.background)} />
                  {(renderState?.nodes ?? []).map(node => {
                    const { element } = node
                    const renderer = (
                      <ElementRenderer
                        element={element}
                        mediaScreen={{
                          active: index === presentation.slideIndex,
                          scale,
                          viewportRatio: presentation.viewportRatio,
                          viewportSize: presentation.viewportSize,
                        }}
                        theme={effectiveTheme}
                      />
                    )
                    const style = {
                      color: effectiveTheme.fontColor,
                      fontFamily: effectiveTheme.fontName,
                      visibility: needsEntryWait(presentation, element.id, animationIndex) ? 'hidden' as const : 'visible' as const,
                      zIndex: node.zIndex,
                    }
                    if (element.link) {
                      const linkBounds = element.type === 'line'
                        ? {
                            height: Math.max(Math.abs(element.start[1] - element.end[1]), 24),
                            width: Math.max(Math.abs(element.start[0] - element.end[0]), 24),
                          }
                        : { height: element.height, width: element.width }
                      return (
                        <div
                          className="mona-screen-element is-link"
                          id={`screen-element-${element.id}`}
                          key={element.id}
                          style={style}
                          title={element.link.target}
                        >
                          {renderer}
                          <a
                            aria-label={element.name || element.link.target}
                            className="mona-screen-element-link"
                            href={element.link.type === 'web' ? element.link.target : `#${element.link.target}`}
                            onClick={event => openLink(event, element.link!)}
                            rel={element.link.type === 'web' ? 'noopener noreferrer' : undefined}
                            style={{
                              height: linkBounds.height,
                              left: element.left,
                              top: element.top,
                              transform: element.type === 'line' ? undefined : `rotate(${element.rotate}deg)`,
                              width: linkBounds.width,
                            }}
                            target={element.link.type === 'web' ? '_blank' : undefined}
                          />
                        </div>
                      )
                    }
                    return (
                      <div className="mona-screen-element" id={`screen-element-${element.id}`} key={element.id} style={style}>
                        {renderer}
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
