/* oxlint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-static-element-interactions, jsx-a11y/prefer-tag-over-role -- the SVG path canvas and point handles are direct-manipulation drawing controls. */

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { InspectorCheckbox, InspectorNumberInput } from '@/features/editor/EditorInspectorPrimitives'

type SegmentType = 'L' | 'Q' | 'C' | 'A'
type PointAxis = 'x' | 'y'
type ArcParamKey = 'rx' | 'ry' | 'rot' | 'laf' | 'sf'

interface PointPosition {
  x: number
  y: number
}

interface ArcParams {
  rx: number
  ry: number
  rot: number
  laf: 0 | 1
  sf: 0 | 1
}

interface PathPoint extends PointPosition {
  type?: SegmentType
  q?: PointPosition
  c?: [PointPosition, PointPosition]
  a?: ArcParams
}

type DraggingState =
  | { type: 'point'; index: number }
  | { type: 'quadratic'; index: number }
  | { type: 'cubic'; index: number; anchor: 0 | 1 }

const GRID_SIZE = 400
const GRID_GAP = 20
const CANVAS_PADDING = 50
const CANVAS_SIZE = GRID_SIZE + CANVAS_PADDING * 2
const CANVAS_MIN = -CANVAS_PADDING
const CANVAS_MAX = GRID_SIZE + CANVAS_PADDING

const clamp = (value: number) => Math.min(Math.max(value, CANVAS_MIN), CANVAS_MAX)
const snap = (value: number) => Math.round(value / GRID_GAP) * GRID_GAP

const createPoint = (type: SegmentType, position: PointPosition, previous: PathPoint): PathPoint => {
  if (type === 'Q') {
    return {
      ...position,
      type,
      q: {
        x: (position.x + previous.x) / 2,
        y: (position.y + previous.y) / 2,
      },
    }
  }
  if (type === 'C') {
    return {
      ...position,
      type,
      c: [
        {
          x: (position.x + previous.x - 50) / 2,
          y: (position.y + previous.y) / 2,
        },
        {
          x: (position.x + previous.x + 50) / 2,
          y: (position.y + previous.y) / 2,
        },
      ],
    }
  }
  if (type === 'A') {
    return {
      ...position,
      type,
      a: { rx: 50, ry: 50, rot: 0, laf: 1, sf: 1 },
    }
  }
  return { ...position, type: 'L' }
}

function PathCheckbox({ checked, children, onChange }: {
  checked: boolean
  children: React.ReactNode
  onChange: (checked: boolean) => void
}) {
  return <InspectorCheckbox checked={checked} className="mona-path-checkbox" onChange={onChange}>{children}</InspectorCheckbox>
}

function PathButton({ children, disabled = false, onClick, primary = false }: {
  children: React.ReactNode
  disabled?: boolean
  onClick: () => void
  primary?: boolean
}) {
  return (
    <Button
      className="mona-path-button"
      disabled={disabled}
      onClick={onClick}
      size="editor"
      variant={primary ? 'default' : 'outline'}
    >{children}</Button>
  )
}

export function EditorSvgPathEditor({ onClose, onInsert }: {
  onClose: () => void
  onInsert: (path: string) => void
}) {
  const { t } = useTranslation()
  const svgRef = useRef<SVGSVGElement>(null)
  const draggingRef = useRef<DraggingState | null>(null)
  const [points, setPoints] = useState<PathPoint[]>([{ x: 0, y: 0 }])
  const [activePointIndex, setActivePointIndex] = useState(0)
  const [closePath, setClosePath] = useState(false)
  const [contextPoint, setContextPoint] = useState<PointPosition>({ x: 280, y: 200 })
  const activePoint = points[activePointIndex] ?? points[0]!
  const activeSegmentType: SegmentType = activePointIndex === 0
    ? 'L'
    : activePoint.q ? 'Q' : activePoint.c ? 'C' : activePoint.a ? 'A' : 'L'

  const gridLines = useMemo(() => {
    const lines: Array<{ key: string; x1: number; x2: number; y1: number; y2: number }> = []
    for (let x = 0; x <= GRID_SIZE; x += GRID_GAP) lines.push({ key: `x-${x}`, x1: x, y1: 0, x2: x, y2: GRID_SIZE })
    for (let y = 0; y <= GRID_SIZE; y += GRID_GAP) lines.push({ key: `y-${y}`, x1: 0, y1: y, x2: GRID_SIZE, y2: y })
    return lines
  }, [])

  const path = useMemo(() => {
    let value = ''
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index]!
      if (index === 0) value += `M ${point.x} ${point.y} `
      else if (point.q) value += `Q ${point.q.x} ${point.q.y} ${point.x} ${point.y} `
      else if (point.c) value += `C ${point.c[0].x} ${point.c[0].y} ${point.c[1].x} ${point.c[1].y} ${point.x} ${point.y} `
      else if (point.a) value += `A ${point.a.rx} ${point.a.ry} ${point.a.rot} ${point.a.laf} ${point.a.sf} ${point.x} ${point.y} `
      else value += `L ${point.x} ${point.y} `
    }
    if (closePath) value += 'Z'
    return value.trim()
  }, [closePath, points])

  const getSvgPoint = useCallback((event: MouseEvent | ReactMouseEvent): PointPosition => {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const rect = svg.getBoundingClientRect()
    const x = (event.clientX - rect.left) * CANVAS_SIZE / rect.width + CANVAS_MIN
    const y = (event.clientY - rect.top) * CANVAS_SIZE / rect.height + CANVAS_MIN
    return { x: clamp(snap(Math.round(x))), y: clamp(snap(Math.round(y))) }
  }, [])

  const setPoint = useCallback((index: number, point: PathPoint) => {
    setPoints(current => current.map((candidate, candidateIndex) => candidateIndex === index ? point : candidate))
  }, [])

  const addPoint = useCallback((type: SegmentType, position = contextPoint) => {
    setPoints(current => {
      const previous = current[activePointIndex] ?? current[0]!
      const point = createPoint(type, position, previous)
      const next = [...current]
      const repeated = previous.x === point.x && previous.y === point.y
      const insertIndex = repeated ? next.length : activePointIndex + 1
      if (repeated) next.push(point)
      else next.splice(insertIndex, 0, point)
      setActivePointIndex(insertIndex)
      return next
    })
  }, [activePointIndex, contextPoint])

  const updateSegmentType = (type: SegmentType) => {
    if (activePointIndex === 0) return
    const previous = points[activePointIndex - 1]!
    setPoint(activePointIndex, createPoint(type, { x: activePoint.x, y: activePoint.y }, previous))
  }

  const updatePointPosition = (axis: PointAxis, value: number) => setPoint(activePointIndex, { ...activePoint, [axis]: value })
  const updateQuadraticPosition = (axis: PointAxis, value: number) => {
    if (!activePoint.q) return
    setPoint(activePointIndex, { ...activePoint, q: { ...activePoint.q, [axis]: value } })
  }
  const updateCubicPosition = (axis: PointAxis, value: number, anchor: 0 | 1) => {
    if (!activePoint.c) return
    const controls: [PointPosition, PointPosition] = [{ ...activePoint.c[0] }, { ...activePoint.c[1] }]
    controls[anchor] = { ...controls[anchor], [axis]: value }
    setPoint(activePointIndex, { ...activePoint, c: controls })
  }
  const updateArcParam = (key: ArcParamKey, value: number) => {
    if (!activePoint.a) return
    const arc = { ...activePoint.a }
    if (key === 'laf' || key === 'sf') arc[key] = value ? 1 : 0
    else arc[key] = value
    setPoint(activePointIndex, { ...activePoint, a: arc })
  }

  const removeActivePoint = () => {
    if (activePointIndex === 0 || points.length === 1) return
    setPoints(current => current.filter((_, index) => index !== activePointIndex))
    setActivePointIndex(Math.max(activePointIndex - 1, 0))
  }

  const stopDraggingRef = useRef<(() => void) | null>(null)

  const startDragging = (event: ReactMouseEvent<SVGCircleElement>, state: DraggingState) => {
    event.preventDefault()
    event.stopPropagation()
    stopDraggingRef.current?.()
    setActivePointIndex(state.index)
    draggingRef.current = state

    const drag = (nativeEvent: MouseEvent) => {
      const dragging = draggingRef.current
      if (!dragging) return
      const position = getSvgPoint(nativeEvent)
      setPoints(current => current.map((point, index) => {
        if (index !== dragging.index) return point
        if (dragging.type === 'point') return { ...point, ...position }
        if (dragging.type === 'quadratic' && point.q) return { ...point, q: position }
        if (dragging.type === 'cubic' && point.c) {
          const controls: [PointPosition, PointPosition] = [{ ...point.c[0] }, { ...point.c[1] }]
          controls[dragging.anchor] = position
          return { ...point, c: controls }
        }
        return point
      }))
    }
    const stopDragging = () => {
      draggingRef.current = null
      document.removeEventListener('mousemove', drag)
      document.removeEventListener('mouseup', stopDragging)
      if (stopDraggingRef.current === stopDragging) stopDraggingRef.current = null
    }
    stopDraggingRef.current = stopDragging
    document.addEventListener('mousemove', drag)
    document.addEventListener('mouseup', stopDragging)
  }

  useEffect(() => {
    return () => stopDraggingRef.current?.()
  }, [])

  const openContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    const position = getSvgPoint(event)
    setContextPoint(position)
    const target = event.target as Element
    const pointElement = target.closest<SVGCircleElement>('[data-point-index]')
    if (pointElement?.dataset.pointIndex) setActivePointIndex(Number(pointElement.dataset.pointIndex))
  }

  const selectContextAction = (action: SegmentType | 'delete') => {
    if (action === 'delete') removeActivePoint()
    else addPoint(action, contextPoint)
  }

  return (
    <Dialog onOpenChange={open => {
      if (!open) onClose()
    }} open>
      <DialogContent className="mona-svg-path-modal-content" overlayClassName="mona-svg-path-mask" showCloseButton={false}>
        <DialogHeader className="sr-only"><DialogTitle>{t('foundation.editor.pathEditor.label')}</DialogTitle></DialogHeader>
        <div className="mona-svg-path-editor">
          <div className="mona-svg-path-container">
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <div className="mona-svg-path-canvas" onContextMenu={openContextMenu}>
                  <svg
                className="mona-svg-path-grid"
                onDoubleClick={event => {
                  const position = getSvgPoint(event)
                  setContextPoint(position)
                  addPoint('L', position)
                }}
                ref={svgRef}
                viewBox={`${CANVAS_MIN} ${CANVAS_MIN} ${CANVAS_SIZE} ${CANVAS_SIZE}`}
              >
                <rect className="mona-svg-canvas-background" height={CANVAS_SIZE} width={CANVAS_SIZE} x={CANVAS_MIN} y={CANVAS_MIN} />
                <rect className="mona-svg-grid-background" height={GRID_SIZE} width={GRID_SIZE} />
                <g className="mona-svg-grid-lines">
                  {gridLines.map(({ key, ...line }) => <line key={key} {...line} />)}
                </g>
                <path className="mona-svg-path-preview" d={path} fill={closePath ? 'rgb(0 0 0 / 5%)' : 'none'} />
                {points.map((point, index) => (
                  <g key={index}>
                    {index > 0 && point.q ? (
                      <>
                        <line className="mona-svg-anchor-line" x1={points[index - 1]!.x} x2={point.q.x} y1={points[index - 1]!.y} y2={point.q.y} />
                        <line className="mona-svg-anchor-line" x1={point.q.x} x2={point.x} y1={point.q.y} y2={point.y} />
                        <circle
                          className="mona-svg-anchor-point"
                          cx={point.q.x}
                          cy={point.q.y}
                          onMouseDown={event => {
                            if (event.button !== 0) return
                            startDragging(event, { type: 'quadratic', index })
                          }}
                          r={6}
                        />
                      </>
                    ) : null}
                    {index > 0 && point.c ? (
                      <>
                        <line className="mona-svg-anchor-line" x1={points[index - 1]!.x} x2={point.c[0].x} y1={points[index - 1]!.y} y2={point.c[0].y} />
                        <line className="mona-svg-anchor-line" x1={point.x} x2={point.c[1].x} y1={point.y} y2={point.c[1].y} />
                        {point.c.map((control, anchor) => (
                          <circle
                            className="mona-svg-anchor-point"
                            cx={control.x}
                            cy={control.y}
                            key={anchor}
                            onMouseDown={event => {
                              if (event.button !== 0) return
                              startDragging(event, { type: 'cubic', index, anchor: anchor as 0 | 1 })
                            }}
                            r={6}
                          />
                        ))}
                      </>
                    ) : null}
                    <circle
                      className={`mona-svg-path-point${index === 0 ? ' is-start' : ''}${index === activePointIndex ? ' is-active' : ''}`}
                      cx={point.x}
                      cy={point.y}
                      data-point-index={index}
                      onMouseDown={event => {
                        if (event.button !== 0) return
                        startDragging(event, { type: 'point', index })
                      }}
                      r={index === 0 ? 6 : 7}
                    />
                  </g>
                ))}
                  </svg>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent className="mona-svg-path-context-menu">
                {([
                  ['L', 'appendLine'],
                  ['Q', 'appendQuadratic'],
                  ['C', 'appendCubic'],
                  ['A', 'appendArc'],
                ] as const).map(([action, key]) => (
                  <ContextMenuItem key={action} onSelect={() => selectContextAction(action)}>{t(`foundation.editor.pathEditor.${key}`)}</ContextMenuItem>
                ))}
                <ContextMenuSeparator />
                <ContextMenuItem disabled={activePointIndex === 0} onSelect={() => selectContextAction('delete')} variant="destructive">{t('foundation.editor.pathEditor.deletePoint')}</ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>

            <div className="mona-svg-path-panel">
              <ToggleGroup className="mona-svg-segment-type" disabled={activePointIndex === 0} onValueChange={value => {
                if (value) updateSegmentType(value as SegmentType)
              }} type="single" value={activeSegmentType}>
                {(['L', 'Q', 'C', 'A'] as const).map(type => (
                  <ToggleGroupItem
                    key={type}
                    value={type}
                  >{t(`foundation.editor.pathEditor.${type === 'L' ? 'straight' : type === 'Q' ? 'quadratic' : type === 'C' ? 'cubic' : 'arc'}`)}</ToggleGroupItem>
                ))}
              </ToggleGroup>

              <div className="mona-svg-path-divider" />
              <section className="mona-svg-path-section">
                <div className="mona-svg-path-section-title">{t('foundation.editor.pathEditor.coordinates')}</div>
                <div className="mona-svg-path-input-row">
                  <InspectorNumberInput ariaLabel={t('foundation.editor.pathEditor.horizontal')} label={t('foundation.editor.pathEditor.horizontal')} max={CANVAS_MAX} min={CANVAS_MIN} onChange={value => updatePointPosition('x', value)} value={activePoint.x} />
                  <InspectorNumberInput ariaLabel={t('foundation.editor.pathEditor.vertical')} label={t('foundation.editor.pathEditor.vertical')} max={CANVAS_MAX} min={CANVAS_MIN} onChange={value => updatePointPosition('y', value)} value={activePoint.y} />
                </div>
              </section>

              {activePoint.q ? (
                <>
                  <div className="mona-svg-path-divider" />
                  <section className="mona-svg-path-section">
                    <div className="mona-svg-path-section-title">{t('foundation.editor.pathEditor.controlPoint')}</div>
                    <div className="mona-svg-path-input-row">
                      <InspectorNumberInput ariaLabel={`${t('foundation.editor.pathEditor.controlPoint')} ${t('foundation.editor.pathEditor.horizontal')}`} label={t('foundation.editor.pathEditor.horizontal')} max={CANVAS_MAX} min={CANVAS_MIN} onChange={value => updateQuadraticPosition('x', value)} value={activePoint.q.x} />
                      <InspectorNumberInput ariaLabel={`${t('foundation.editor.pathEditor.controlPoint')} ${t('foundation.editor.pathEditor.vertical')}`} label={t('foundation.editor.pathEditor.vertical')} max={CANVAS_MAX} min={CANVAS_MIN} onChange={value => updateQuadraticPosition('y', value)} value={activePoint.q.y} />
                    </div>
                  </section>
                </>
              ) : null}

              {activePoint.c ? (
                <>
                  <div className="mona-svg-path-divider" />
                  <section className="mona-svg-path-section">
                    <div className="mona-svg-path-section-title">{t('foundation.editor.pathEditor.controlPoint')}</div>
                    {[0, 1].map(anchor => (
                      <div className="mona-svg-path-input-row" key={anchor}>
                        <InspectorNumberInput ariaLabel={t('foundation.editor.pathEditor.controlPointHorizontal', { number: anchor + 1 })} label={t('foundation.editor.pathEditor.controlPointHorizontal', { number: anchor + 1 })} max={CANVAS_MAX} min={CANVAS_MIN} onChange={value => updateCubicPosition('x', value, anchor as 0 | 1)} value={activePoint.c![anchor as 0 | 1].x} />
                        <InspectorNumberInput ariaLabel={t('foundation.editor.pathEditor.controlPointVertical', { number: anchor + 1 })} label={t('foundation.editor.pathEditor.controlPointVertical', { number: anchor + 1 })} max={CANVAS_MAX} min={CANVAS_MIN} onChange={value => updateCubicPosition('y', value, anchor as 0 | 1)} value={activePoint.c![anchor as 0 | 1].y} />
                      </div>
                    ))}
                  </section>
                </>
              ) : null}

              {activePoint.a ? (
                <>
                  <div className="mona-svg-path-divider" />
                  <section className="mona-svg-path-section">
                    <div className="mona-svg-path-section-title">{t('foundation.editor.pathEditor.arcSettings')}</div>
                    <div className="mona-svg-path-input-row">
                      <InspectorNumberInput ariaLabel={t('foundation.editor.pathEditor.horizontalRadius')} label={t('foundation.editor.pathEditor.horizontalRadius')} max={1000} min={0} onChange={value => updateArcParam('rx', value)} value={activePoint.a.rx} />
                      <InspectorNumberInput ariaLabel={t('foundation.editor.pathEditor.verticalRadius')} label={t('foundation.editor.pathEditor.verticalRadius')} max={1000} min={0} onChange={value => updateArcParam('ry', value)} value={activePoint.a.ry} />
                    </div>
                    <div className="mona-svg-path-input-row">
                      <InspectorNumberInput ariaLabel={t('foundation.editor.pathEditor.rotation')} label={t('foundation.editor.pathEditor.rotation')} max={360} min={0} onChange={value => updateArcParam('rot', value)} value={activePoint.a.rot} />
                    </div>
                    <div className="mona-svg-path-checkbox-row">
                      <PathCheckbox checked={activePoint.a.laf === 1} onChange={value => updateArcParam('laf', value ? 1 : 0)}>{t('foundation.editor.pathEditor.largeArc')}</PathCheckbox>
                      <PathCheckbox checked={activePoint.a.sf === 1} onChange={value => updateArcParam('sf', value ? 1 : 0)}>{t('foundation.editor.pathEditor.clockwise')}</PathCheckbox>
                    </div>
                  </section>
                </>
              ) : null}

              <div className="mona-svg-path-divider" />
              <section className="mona-svg-path-section">
                <PathCheckbox checked={closePath} onChange={setClosePath}>{t('foundation.editor.pathEditor.closePath')}</PathCheckbox>
              </section>
              <div className="mona-svg-path-divider" />
              <section className="mona-svg-path-section"><div className="mona-svg-path-content">{path}</div></section>
            </div>
          </div>

          <div className="mona-svg-path-footer">
            <div className="mona-svg-path-tip">{t('foundation.editor.pathEditor.tip')}</div>
            <div className="mona-svg-path-footer-actions">
              <PathButton onClick={onClose}>{t('foundation.editor.pathEditor.close')}</PathButton>
              <PathButton disabled={points.length < 2} onClick={() => onInsert(path)} primary>{t('foundation.editor.pathEditor.confirm')}</PathButton>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
