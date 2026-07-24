import { useMemo } from 'react'

import {
  compileSlideTheme,
  resolveSlideRenderState,
  type PowerPointPackageReference,
} from '@mona/presentation-core'
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
  sourcePackages?: readonly PowerPointPackageReference[]
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
  sourcePackages = [],
  tableEditor,
  textEditor,
  theme,
  thumbnail = false,
  viewportRatio,
  viewportSize,
}: SlideRendererProps) {
  const renderState = useMemo(
    () => resolveSlideRenderState(slide, sourcePackages),
    [slide, sourcePackages],
  )
  const effectiveTheme = useMemo(
    () => compileSlideTheme(theme, renderState.theme, renderState.master, renderState.layout, slide),
    [renderState.layout, renderState.master, renderState.theme, slide, theme],
  )
  return (
    <div
      aria-label={`Slide ${slide.id}`}
      className="mona-slide-renderer"
      data-slide-id={slide.id}
      style={{
        ...getSlideBackgroundStyle(renderState.background),
        width: viewportSize,
        height: viewportSize * viewportRatio,
      }}
    >
      {renderState.nodes.map(node => {
        const editable = node.layer === 'slide'
        return (
          <div
            aria-hidden={editable ? undefined : true}
            className="mona-rendered-element"
            data-pptx-layer={node.layer}
            key={node.element.id}
            style={{ pointerEvents: editable ? undefined : 'none', zIndex: node.zIndex }}
          >
            <ElementRenderer
              element={node.element}
              mediaEditor={editable ? mediaEditor : undefined}
              mediaScreen={mediaScreen}
              shapeEditor={editable ? shapeEditor : undefined}
              tableEditor={editable ? tableEditor : undefined}
              textEditor={editable ? textEditor : undefined}
              theme={effectiveTheme}
              thumbnail={thumbnail}
            />
          </div>
        )
      })}
    </div>
  )
}
