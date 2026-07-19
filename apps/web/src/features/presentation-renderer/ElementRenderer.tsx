import { lazy, Suspense } from 'react'

import type { PPTElement, SlideTheme } from '@mona/presentation-core/model'

import { ImageElement } from '@/features/presentation-renderer/elements/ImageElement'
import { LatexElement } from '@/features/presentation-renderer/elements/LatexElement'
import { LineElement } from '@/features/presentation-renderer/elements/LineElement'
import { AudioElement, VideoElement } from '@/features/presentation-renderer/elements/MediaElements'
import { ShapeElement } from '@/features/presentation-renderer/elements/ShapeElement'
import { TableElement } from '@/features/presentation-renderer/elements/TableElement'
import { TextElement } from '@/features/presentation-renderer/elements/TextElement'

const ChartElement = lazy(async () => {
  const module = await import('@/features/presentation-renderer/elements/ChartElement')
  return { default: module.ChartElement }
})

interface ElementRendererProps {
  element: PPTElement
  theme: SlideTheme
  thumbnail?: boolean
}

export function ElementRenderer({ element, theme, thumbnail = false }: ElementRendererProps) {
  switch (element.type) {
    case 'text': return <TextElement element={element} thumbnail={thumbnail} />
    case 'shape': return <ShapeElement element={element} theme={theme} />
    case 'image': return <ImageElement element={element} />
    case 'line': return <LineElement element={element} />
    case 'table': return <TableElement element={element} />
    case 'latex': return <LatexElement element={element} />
    case 'video': return <VideoElement element={element} />
    case 'audio': return <AudioElement element={element} />
    case 'chart':
      return (
        <Suspense fallback={<div aria-label="Loading chart" className="mona-chart-placeholder" style={{ top: element.top, left: element.left, width: element.width, height: element.height }} />}>
          <ChartElement element={element} />
        </Suspense>
      )
    default:
      return element satisfies never
  }
}
