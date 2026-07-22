import type { PPTElement, Slide, SlideTheme } from '@mona/presentation-core/model'

import { ElementRenderer } from '@/features/presentation-renderer/ElementRenderer'
import type { ShapeElementEditor } from '@/features/presentation-renderer/elements/ShapeElement'
import type { TextElementEditor } from '@/features/presentation-renderer/elements/TextElement'
import type { TableElementEditor } from '@/features/presentation-renderer/elements/TableElement'
import type { MediaElementEditor } from '@/features/presentation-renderer/elements/MediaElements'
import type { MediaElementScreen } from '@/features/presentation-renderer/elements/MediaElements'
import { getSlideBackgroundStyle } from '@/features/presentation-renderer/render-utils'

interface SlideRendererProps {
  slide: Slide
  mediaEditor?: (element: Extract<PPTElement, { type: 'audio' | 'video' }>) => MediaElementEditor | undefined
  mediaScreen?: MediaElementScreen
  shapeEditor?: (element: Extract<PPTElement, { type: 'shape' }>) => ShapeElementEditor | undefined
  theme: SlideTheme
  textEditor?: (element: Extract<PPTElement, { type: 'text' }>) => TextElementEditor
  tableEditor?: (element: Extract<PPTElement, { type: 'table' }>) => TableElementEditor | undefined
  thumbnail?: boolean
  viewportRatio: number
  viewportSize: number
}

export function SlideRenderer({
  slide,
  mediaEditor,
  mediaScreen,
  shapeEditor,
  tableEditor,
  textEditor,
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
          <ElementRenderer element={element} mediaEditor={mediaEditor} mediaScreen={mediaScreen} shapeEditor={shapeEditor} tableEditor={tableEditor} textEditor={textEditor} theme={theme} thumbnail={thumbnail} />
        </div>
      ))}
    </div>
  )
}
