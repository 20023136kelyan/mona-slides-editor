/* oxlint-disable jsx-a11y/no-noninteractive-element-interactions -- the full-canvas SVG is a pointer drawing surface. */

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'

import type { PPTElementOutline } from '@mona/presentation-core/model'

interface Point {
  x: number
  y: number
}

export interface CustomShapeResult {
  fill?: string
  height: number
  left: number
  outline?: PPTElementOutline
  path: string
  top: number
  viewBox: [number, number]
  width: number
}

const pointPath = (points: readonly Point[], mouse: Point | null) => {
  if (!points.length) return ''
  const commands = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`)
  if (mouse) commands.push(`L ${mouse.x} ${mouse.y}`)
  return commands.join(' ')
}

export function EditorCustomShapeCreator({
  color,
  onCancel,
  onCreated,
  scale,
  stageRef,
  viewportRef,
}: {
  color: string
  onCancel: () => void
  onCreated: (result: CustomShapeResult) => void
  scale: number
  stageRef: RefObject<HTMLElement | null>
  viewportRef: RefObject<HTMLDivElement | null>
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const drawingRef = useRef(false)
  const [mouse, setMouse] = useState<Point | null>(null)
  const [points, setPoints] = useState<Point[]>([])
  const closed = useMemo(() => {
    if (points.length < 2 || !mouse) return false
    return Math.abs(points[0]!.x - mouse.x) < 5 && Math.abs(points[0]!.y - mouse.y) < 5
  }, [mouse, points])
  const path = pointPath(points, mouse)

  const localPoint = (event: Pick<PointerEvent, 'clientX' | 'clientY' | 'ctrlKey' | 'metaKey' | 'shiftKey'>, custom = false) => {
    const rect = rootRef.current?.getBoundingClientRect()
    if (!rect) return null
    let point = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    if (!custom && points.length && (event.ctrlKey || event.metaKey || event.shiftKey)) {
      const last = points[points.length - 1]!
      point = Math.abs(last.x - point.x) > Math.abs(last.y - point.y)
        ? { x: point.x, y: last.y }
        : { x: last.x, y: point.y }
    }
    return point
  }

  const complete = (close: boolean) => {
    const stage = stageRef.current
    const viewport = viewportRef.current
    if (!stage || !viewport) return
    const xs = points.map(point => point.x)
    const ys = points.map(point => point.y)
    const minX = Math.min(...xs)
    const minY = Math.min(...ys)
    const maxX = Math.max(...xs)
    const maxY = Math.max(...ys)
    const normalized = points.map(point => ({ x: point.x - minX, y: point.y - minY }))
    const stageRect = stage.getBoundingClientRect()
    const viewportRect = viewport.getBoundingClientRect()
    const viewBox: [number, number] = [maxX - minX, maxY - minY]
    onCreated({
      left: (stageRect.left + minX - viewportRect.left) / scale,
      top: (stageRect.top + minY - viewportRect.top) / scale,
      width: viewBox[0] / scale,
      height: viewBox[1] / scale,
      viewBox,
      path: `${normalized.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y} `).join('')}${close ? 'Z' : ''}`,
      ...(close
        ? { fill: color }
        : {
          fill: 'rgba(0, 0, 0, 0)',
          outline: { width: 2, color, style: 'solid' as const },
        }),
    })
  }

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
      else if (event.key === 'Enter') {
        complete(false)
        onCancel()
      }
    }
    document.addEventListener('keydown', keydown)
    return () => document.removeEventListener('keydown', keydown)
  })

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.stopPropagation()
    const point = localPoint(event.nativeEvent)
    if (!point) return
    drawingRef.current = true
    event.currentTarget.setPointerCapture(event.pointerId)
    if (closed) {
      complete(true)
      onCancel()
    }
    else setPoints(current => [...current, point])
  }

  return (
    <div
      aria-label="Custom shape drawing canvas"
      className="mona-shape-create-canvas"
      onContextMenu={event => {
        event.preventDefault()
        event.stopPropagation()
        onCancel()
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={event => {
        const point = localPoint(event.nativeEvent, drawingRef.current)
        if (!point) return
        if (drawingRef.current) {
          setPoints(current => [...current, point])
          setMouse(null)
        }
        else setMouse(point)
      }}
      onPointerUp={event => {
        drawingRef.current = false
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      ref={rootRef}
      role="application"
    >
      <svg overflow="visible">
        <path d={path} fill={closed ? 'var(--editor-selection-soft)' : 'none'} stroke="var(--editor-selection)" strokeWidth="2" />
      </svg>
    </div>
  )
}
