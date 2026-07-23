import { useId } from 'react'

import type { LinePoint, PPTLineElement } from '@mona/presentation-core/model'

import {
  getLineDashArray,
  getLinePath,
  getLineRenderPath,
  getShadowStyle,
} from '@/features/presentation-renderer/render-utils'

type NonEmptyLinePoint = Exclude<LinePoint, ''>

interface LineMarkerProps {
  baseSize: number
  color: string
  elementId: string
  position: 'start' | 'end'
  type: NonEmptyLinePoint
}

function LineMarker({ baseSize, color, elementId, position, type }: LineMarkerProps) {
  const size = Math.max(baseSize, 2)
  const path = type === 'dot' ? 'm0 5a5 5 0 1 0 10 0a5 5 0 1 0 -10 0z' : 'M0,0 L10,5 0,10 Z'
  const rotation = type === 'arrow' && position === 'start' ? 180 : 0
  return (
    <marker
      id={`${elementId}-${type}-${position}`}
      markerHeight={size * 3}
      markerUnits="userSpaceOnUse"
      markerWidth={size * 3}
      orient="auto"
      refX={position === 'start' ? 0 : size * 3}
      refY={size * 1.5}
    >
      <path d={path} fill={color} transform={`scale(${size * 0.3}, ${size * 0.3}) rotate(${rotation}, 5, 5)`} />
    </marker>
  )
}

export function LineElement({ element }: { element: PPTLineElement }) {
  // Per-instance marker ids: url(#id) resolves document-wide to the first
  // match, and defs inside a hidden <Activity> surface do not render.
  const svgId = useId().replace(/:/g, '')
  const width = Math.max(Math.abs(element.start[0] - element.end[0]), 24)
  const height = Math.max(Math.abs(element.start[1] - element.end[1]), 24)
  const shadow = getShadowStyle(element.shadow)

  return (
    <div
      className="mona-element mona-line-element"
      data-element-id={element.id}
      data-element-type="line"
      style={{ top: element.top, left: element.left }}
    >
      <div className="mona-line-content" style={{ filter: shadow ? `drop-shadow(${shadow})` : '' }}>
        <svg aria-hidden="true" height={height} overflow="visible" width={width}>
          <defs>
            {element.points[0] ? <LineMarker baseSize={element.width} color={element.color} elementId={svgId} position="start" type={element.points[0]} /> : null}
            {element.points[1] ? <LineMarker baseSize={element.width} color={element.color} elementId={svgId} position="end" type={element.points[1]} /> : null}
          </defs>
          <path d={getLineRenderPath(element)} fill="none" stroke={element.color} strokeDasharray={getLineDashArray(element)} strokeWidth={element.width} />
          <path
            d={getLinePath(element)}
            fill="none"
            markerEnd={element.points[1] ? `url(#${svgId}-${element.points[1]}-end)` : undefined}
            markerStart={element.points[0] ? `url(#${svgId}-${element.points[0]}-start)` : undefined}
            stroke="transparent"
            strokeWidth={element.width}
          />
        </svg>
      </div>
    </div>
  )
}
