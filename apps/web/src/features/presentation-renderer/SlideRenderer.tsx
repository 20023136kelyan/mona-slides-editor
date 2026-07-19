import type { Slide, SlideTheme } from '@mona/presentation-core/model'

import { ElementRenderer } from '@/features/presentation-renderer/ElementRenderer'
import { getSlideBackgroundStyle } from '@/features/presentation-renderer/render-utils'

interface SlideRendererProps {
  slide: Slide
  theme: SlideTheme
  thumbnail?: boolean
  viewportRatio: number
  viewportSize: number
}

export function SlideRenderer({
  slide,
  theme,
  thumbnail = false,
  viewportRatio,
  viewportSize,
}: SlideRendererProps) {
  return (
    <div
      aria-label={`Slide ${slide.id}`}
      className="mona-slide-renderer"
      data-slide-id={slide.id}
      style={{
        ...getSlideBackgroundStyle(slide.background),
        width: viewportSize,
        height: viewportSize * viewportRatio,
      }}
    >
      {slide.elements.map((element, index) => (
        <div className="mona-rendered-element" key={element.id} style={{ zIndex: index + 1 }}>
          <ElementRenderer element={element} theme={theme} thumbnail={thumbnail} />
        </div>
      ))}
    </div>
  )
}
