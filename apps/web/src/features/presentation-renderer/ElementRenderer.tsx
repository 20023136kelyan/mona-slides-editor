import { lazy, Suspense } from 'react'

import type { PPTElement, SlideTheme } from '@mona/presentation-core/model'

import { EditorErrorBoundary } from '@/features/editor/EditorErrorBoundary'

import { ImageElement } from '@/features/presentation-renderer/elements/ImageElement'
import { LatexElement } from '@/features/presentation-renderer/elements/LatexElement'
import { LineElement } from '@/features/presentation-renderer/elements/LineElement'
import { AudioElement, VideoElement, type MediaElementEditor, type MediaElementScreen } from '@/features/presentation-renderer/elements/MediaElements'
import { ShapeElement, type ShapeElementEditor } from '@/features/presentation-renderer/elements/ShapeElement'
import { TableElement, type TableElementEditor } from '@/features/presentation-renderer/elements/TableElement'
import { TextElement, type TextElementEditor } from '@/features/presentation-renderer/elements/TextElement'

const ChartElement = lazy(async () => {
  const module = await import('@/features/presentation-renderer/elements/ChartElement')
  return { default: module.ChartElement }
})

interface ElementRendererProps {
  element: PPTElement
  mediaEditor?: (element: Extract<PPTElement, { type: 'audio' | 'video' }>) => MediaElementEditor | undefined
  mediaScreen?: MediaElementScreen
  shapeEditor?: (element: Extract<PPTElement, { type: 'shape' }>) => ShapeElementEditor | undefined
  theme: SlideTheme
  textEditor?: (element: Extract<PPTElement, { type: 'text' }>) => TextElementEditor
  tableEditor?: (element: Extract<PPTElement, { type: 'table' }>) => TableElementEditor | undefined
  thumbnail?: boolean
}

export function ElementRenderer({ element, mediaEditor, mediaScreen, shapeEditor, tableEditor, textEditor, theme, thumbnail = false }: ElementRendererProps) {
  switch (element.type) {
    case 'text': return <TextElement editor={textEditor?.(element)} element={element} thumbnail={thumbnail} />
    case 'shape': return <ShapeElement editor={shapeEditor?.(element)} element={element} theme={theme} />
    case 'image': return <ImageElement element={element} />
    case 'line': return <LineElement element={element} />
    case 'table': return <TableElement editor={tableEditor?.(element)} element={element} />
    case 'latex': return <LatexElement element={element} />
    case 'video': return <VideoElement editor={mediaEditor?.(element)} element={element} screen={mediaScreen} />
    case 'audio': return <AudioElement editor={mediaEditor?.(element)} element={element} screen={mediaScreen} />
    case 'group': {
      const coordinateWidth = Math.max(element.coordinateWidth || element.width, 0.001)
      const coordinateHeight = Math.max(element.coordinateHeight || element.height, 0.001)
      const flipX = element.flipH ? -1 : 1
      const flipY = element.flipV ? -1 : 1
      return (
        <section
          aria-label={element.name || (element.semanticType === 'diagram' ? 'PowerPoint diagram' : 'PowerPoint group')}
          className="mona-element mona-group-element"
          data-element-id={element.id}
          data-element-type="group"
          style={{
            height: element.height,
            left: element.left,
            top: element.top,
            transform: `rotate(${element.rotate}deg) scale(${flipX}, ${flipY})`,
            width: element.width,
          }}
        >
          <div
            className="mona-group-content"
            data-testid={`group-content-${element.id}`}
            style={{
              height: coordinateHeight,
              transform: `scale(${element.width / coordinateWidth}, ${element.height / coordinateHeight})`,
              width: coordinateWidth,
            }}
          >
            {element.elements.map(child => (
              <ElementRenderer
                element={child}
                key={child.id}
                mediaScreen={mediaScreen}
                theme={theme}
                thumbnail={thumbnail}
              />
            ))}
          </div>
        </section>
      )
    }
    case 'opaque':
      return (
        <figure
          aria-label={element.label || 'Unsupported PowerPoint object'}
          className="mona-element mona-opaque-element"
          data-element-id={element.id}
          data-element-type="opaque"
          style={{
            height: element.height,
            left: element.left,
            top: element.top,
            transform: `rotate(${element.rotate}deg)`,
            width: element.width,
          }}
          title={element.reason}
        >
          {element.preview ? (
            <img alt="" draggable={false} src={element.preview} />
          ) : (
            <div className="mona-opaque-placeholder">
              <span>{element.label || 'PowerPoint object'}</span>
            </div>
          )}
        </figure>
      )
    case 'chart':
      return (
        <EditorErrorBoundary>
          <Suspense fallback={<div aria-label="Loading chart" className="mona-chart-placeholder" style={{ top: element.top, left: element.left, width: element.width, height: element.height }} />}>
            <ChartElement element={element} thumbnail={thumbnail} />
          </Suspense>
        </EditorErrorBoundary>
      )
    default:
      return element satisfies never
  }
}
