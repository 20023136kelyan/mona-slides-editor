import { useTranslation } from 'react-i18next'
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react'

import { boundsToRect, type ResizeHandle } from '@mona/editor-interactions/geometry'
import type { PPTElement, PPTImageElement, PPTLineElement, PPTShapeElement } from '@mona/presentation-core/model'

import {
  canResizeSelection,
  canRotateSelection,
  getImageCropGeometry,
  getLineControlPoints,
  getShapeKeypointPositions,
  getTransformBounds,
  type CropControlHandle,
  type ImageCropGeometry,
  type LineControlHandle,
} from '@/features/editor/editor-geometry'
import { getImageClip } from '@/features/presentation-renderer/render-utils'

const allResizeHandles: readonly ResizeHandle[] = [
  'top-left', 'top', 'top-right', 'right',
  'bottom-right', 'bottom', 'bottom-left', 'left',
]

const getResizeHandles = (elements: readonly PPTElement[], interactionProfile: 'desktop' | 'mobile'): readonly ResizeHandle[] => {
  if (elements.length !== 1) return canResizeSelection(elements) ? allResizeHandles : []
  const element = elements[0]!
  if (!canResizeSelection(elements)) return []
  if (element.type === 'text' && !element.fixedHeight) {
    return element.vertical ? ['top', 'bottom'] : ['left', 'right']
  }
  if (interactionProfile === 'mobile' && element.type === 'table') return ['left', 'right']
  return allResizeHandles
}

const getResizeRotationClass = (rotate = 0) => {
  if (rotate > -22.5 && rotate <= 22.5) return 'rotate-0'
  if (rotate > 22.5 && rotate <= 67.5) return 'rotate-45'
  if (rotate > 67.5 && rotate <= 112.5) return 'rotate-90'
  if (rotate > 112.5 && rotate <= 157.5) return 'rotate-135'
  if (rotate > 157.5 || rotate <= -157.5) return 'rotate-0'
  if (rotate > -157.5 && rotate <= -112.5) return 'rotate-45'
  if (rotate > -112.5 && rotate <= -67.5) return 'rotate-90'
  return 'rotate-135'
}

function TransformHandles({
  elements,
  interactionProfile,
  onResizePointerDown,
  onRotatePointerDown,
}: {
  elements: PPTElement[]
  interactionProfile: 'desktop' | 'mobile'
  onResizePointerDown: (event: ReactPointerEvent<HTMLButtonElement>, handle: ResizeHandle) => void
  onRotatePointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void
}) {
  const { t } = useTranslation()
  const single = elements.length === 1 ? elements[0] : undefined
  const rotateClass = getResizeRotationClass(single && single.type !== 'line' ? single.rotate : 0)
  return (
    <>
      {getResizeHandles(elements, interactionProfile).map(handle => (
        <button
          aria-label={t('foundation.editor.resizeHandle', { handle: t(`foundation.editor.handle.${handle}`) })}
          className={`mona-transform-handle is-${handle} ${rotateClass}`}
          data-handle={handle}
          key={handle}
          onPointerDown={event => onResizePointerDown(event, handle)}
          type="button"
        />
      ))}
      {canRotateSelection(elements) ? (
        <button
          aria-label={t('foundation.editor.rotateSelection')}
          className="mona-rotate-handle"
          onPointerDown={onRotatePointerDown}
          type="button"
        />
      ) : null}
    </>
  )
}

function RectSelection({
  children,
  className = '',
  elements,
  interactionProfile,
  onResizePointerDown,
  onRotatePointerDown,
  scale,
  showHandles,
}: {
  children?: ReactNode
  className?: string
  elements: PPTElement[]
  interactionProfile: 'desktop' | 'mobile'
  onResizePointerDown: (event: ReactPointerEvent<HTMLButtonElement>, handle: ResizeHandle) => void
  onRotatePointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void
  scale: number
  showHandles: boolean
}) {
  const { t } = useTranslation()
  const bounds = getTransformBounds(elements)
  const rect = boundsToRect(bounds)
  const single = elements.length === 1 ? elements[0] : undefined
  const rotate = single && single.type !== 'line' ? single.rotate : 0
  const secondary = className.includes('is-secondary')
  return (
    <div
      aria-hidden={secondary || undefined}
      aria-label={secondary ? undefined : t('foundation.editor.selection', { count: elements.length })}
      className={`mona-selection-frame${className}`}
      data-testid={secondary ? undefined : 'selection-frame'}
      style={{
        left: rect.left * scale,
        top: rect.top * scale,
        width: rect.width * scale,
        height: rect.height * scale,
        transform: `rotate(${rotate}deg)`,
        '--mona-handle-size': '10px',
        '--mona-outline-width': '1px',
        '--mona-border-radius': '1px',
        '--mona-rotate-offset': '25px',
        '--mona-keypoint-color': '#ffe873',
      } as CSSProperties}
    >
      <div aria-hidden="true" className="mona-selection-border-line is-top" />
      <div aria-hidden="true" className="mona-selection-border-line is-bottom" />
      <div aria-hidden="true" className="mona-selection-border-line is-left" />
      <div aria-hidden="true" className="mona-selection-border-line is-right" />
      {showHandles ? (
        <TransformHandles
          elements={elements}
          interactionProfile={interactionProfile}
          onResizePointerDown={onResizePointerDown}
          onRotatePointerDown={onRotatePointerDown}
        />
      ) : null}
      {children}
    </div>
  )
}

function LineSelection({
  element,
  onLinePointerDown,
  scale,
  showHandles,
}: {
  element: PPTLineElement
  onLinePointerDown: (event: ReactPointerEvent<HTMLButtonElement>, handle: LineControlHandle) => void
  scale: number
  showHandles: boolean
}) {
  const { t } = useTranslation()
  const controls = getLineControlPoints(element)
  return (
    <div
      aria-label={t('foundation.editor.selection', { count: 1 })}
      className="mona-line-selection"
      data-testid="selection-frame"
      style={{
        left: element.left * scale,
        top: element.top * scale,
        '--mona-handle-size': '10px',
        '--mona-outline-width': '1px',
        '--mona-border-radius': '1px',
      } as CSSProperties}
    >
      {showHandles && (element.curve || element.cubic) ? (
        <svg
          aria-hidden="true"
          className="mona-line-anchor-layer"
          height={Math.max(element.start[1], element.end[1], 1)}
          style={{ color: element.color, transform: `scale(${scale})`, transformOrigin: '0 0' }}
          width={Math.max(element.start[0], element.end[0], 1)}
        >
          {element.curve ? (
            <>
              <line x1={element.start[0]} x2={element.curve[0]} y1={element.start[1]} y2={element.curve[1]} />
              <line x1={element.end[0]} x2={element.curve[0]} y1={element.end[1]} y2={element.curve[1]} />
            </>
          ) : null}
          {element.cubic ? (
            <>
              <line x1={element.start[0]} x2={element.cubic[0][0]} y1={element.start[1]} y2={element.cubic[0][1]} />
              <line x1={element.end[0]} x2={element.cubic[1][0]} y1={element.end[1]} y2={element.cubic[1][1]} />
            </>
          ) : null}
        </svg>
      ) : null}
      {showHandles ? controls.map(control => (
        <button
          aria-label={`Line ${control.handle}`}
          className="mona-line-control-handle"
          data-line-handle={control.handle}
          key={control.handle}
          onPointerDown={event => onLinePointerDown(event, control.handle)}
          style={{ left: (control.x - element.left) * scale, top: (control.y - element.top) * scale }}
          type="button"
        />
      )) : null}
    </div>
  )
}

function ShapeKeypointControls({
  element,
  onShapeKeypointPointerDown,
  scale,
}: {
  element: PPTShapeElement
  onShapeKeypointPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, index: number) => void
  scale: number
}) {
  return getShapeKeypointPositions(element).map(point => (
    <button
      aria-label={`Shape keypoint ${point.index + 1}`}
      className="mona-shape-keypoint-handle"
      data-shape-keypoint={point.index}
      key={point.index}
      onPointerDown={event => onShapeKeypointPointerDown(event, point.index)}
      style={{
        left: (point.x - element.left) * scale,
        top: (point.y - element.top) * scale,
        '--mona-handle-size': '10px',
        '--mona-outline-width': '1px',
        '--mona-border-radius': '1px',
      } as CSSProperties}
      type="button"
    />
  ))
}

export function EditorImageCropEditor({
  element,
  geometry: geometryOverride,
  onCropPointerDown,
}: {
  element: PPTImageElement
  geometry?: ImageCropGeometry
  onCropPointerDown: (event: ReactPointerEvent<HTMLElement>, handle: CropControlHandle) => void
}) {
  const { t } = useTranslation()
  const geometry = geometryOverride ?? getImageCropGeometry(element)
  const { rect } = geometry
  const clipPath = getImageClip(element).style
  const rotate = element.rotate
  const rotateClass = rotate > -22.5 && rotate <= 22.5 ? 'rotate-0'
    : rotate > 22.5 && rotate <= 67.5 ? 'rotate-45'
      : rotate > 67.5 && rotate <= 112.5 ? 'rotate-90'
        : rotate > 112.5 && rotate <= 157.5 ? 'rotate-135'
          : rotate > 157.5 || rotate <= -157.5 ? 'rotate-0'
            : rotate > -157.5 && rotate <= -112.5 ? 'rotate-45'
              : rotate > -112.5 && rotate <= -67.5 ? 'rotate-90'
                : 'rotate-135'
  return (
    <div
      className="mona-image-crop-position"
      style={{
        left: element.left,
        top: element.top,
        width: element.width,
        height: element.height,
      }}
    >
      <div
        aria-label={t('foundation.editor.cropFrame')}
        className="mona-image-crop-element"
        data-testid="selection-frame"
        style={{ transform: `rotate(${element.rotate}deg)` }}
      >
        <div
          className="mona-image-crop-editor"
          style={{ left: `${-geometry.originLeft}%`, top: `${-geometry.originTop}%` }}
        >
          <img
            alt=""
            className="mona-crop-bottom-image"
            draggable={false}
            src={element.src}
            style={{
              left: `${-geometry.originLeft}%`,
              top: `${-geometry.originTop}%`,
              width: `${geometry.rawWidth}%`,
              height: `${geometry.rawHeight}%`,
            }}
          />
          <div
            className="mona-crop-highlight"
            style={{
              left: `${rect.left}%`,
              top: `${rect.top}%`,
              width: `${rect.width}%`,
              height: `${rect.height}%`,
              clipPath,
            }}
          >
            <img
              alt=""
              draggable={false}
              src={element.src}
              style={{
                left: `${-rect.left * (100 / rect.width)}%`,
                top: `${-rect.top * (100 / rect.height)}%`,
                width: `${geometry.rawWidth / rect.width * 100}%`,
                height: `${geometry.rawHeight / rect.height * 100}%`,
              }}
            />
          </div>
          <button
            aria-label={t('foundation.editor.moveCropArea')}
            className="mona-crop-operate"
            onPointerDown={event => onCropPointerDown(event, 'move')}
            style={{
              left: `${rect.left}%`,
              top: `${rect.top}%`,
              width: `${rect.width}%`,
              height: `${rect.height}%`,
            }}
            type="button"
          />
          <div
            className="mona-crop-controls"
            style={{
              left: `${rect.left}%`,
              top: `${rect.top}%`,
              width: `${rect.width}%`,
              height: `${rect.height}%`,
            }}
          >
            {allResizeHandles.map(handle => {
              const edge = !handle.includes('-')
              return (
                <button
                  aria-label={t('foundation.editor.cropHandle', { handle: t(`foundation.editor.handle.${handle}`) })}
                  className={`mona-crop-handle is-${handle} ${rotateClass}`}
                  data-handle={handle}
                  key={handle}
                  onPointerDown={event => onCropPointerDown(event, handle)}
                  type="button"
                >
                  <svg fill="#fff" height="16" stroke="#333" viewBox="0 0 16 16" width="16">
                    <path
                      d={edge ? 'M 16 0 L 0 0 L 0 4 L 16 4 Z' : 'M 16 0 L 0 0 L 0 16 L 4 16 L 4 4 L 16 4 L 16 0 Z'}
                      shapeRendering="crispEdges"
                      strokeWidth="0.3"
                    />
                  </svg>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

export function EditorSelectionOverlay({
  activeGroupElementId,
  cropElementId,
  elements,
  handleElementId,
  interactionProfile = 'desktop',
  onLinePointerDown,
  onResizePointerDown,
  onRotatePointerDown,
  onShapeKeypointPointerDown,
  scale,
}: {
  activeGroupElementId: string | null
  cropElementId: string | null
  elements: PPTElement[]
  handleElementId: string | null
  interactionProfile?: 'desktop' | 'mobile'
  onLinePointerDown: (event: ReactPointerEvent<HTMLButtonElement>, handle: LineControlHandle) => void
  onResizePointerDown: (event: ReactPointerEvent<HTMLButtonElement>, handle: ResizeHandle) => void
  onRotatePointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onShapeKeypointPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, index: number) => void
  scale: number
}) {
  if (!elements.length) return null
  const cropImage = cropElementId && elements.length === 1 && elements[0]?.type === 'image'
    ? elements[0]
    : undefined
  if (cropImage) return null

  if (elements.length > 1) {
    const activeMember = activeGroupElementId
      ? elements.find(element => element.id === activeGroupElementId)
      : undefined
    return (
      <>
        {elements.map(element => element.type === 'line' ? null : (
          <RectSelection
            className={` is-secondary${element.id === handleElementId ? ' is-handle-element' : ''}`}
            elements={[element]}
            interactionProfile={interactionProfile}
            key={element.id}
            onResizePointerDown={onResizePointerDown}
            onRotatePointerDown={onRotatePointerDown}
            scale={scale}
            showHandles={false}
          />
        ))}
        <RectSelection
          className=" is-multi-selection"
          elements={elements}
          interactionProfile={interactionProfile}
          onResizePointerDown={onResizePointerDown}
          onRotatePointerDown={onRotatePointerDown}
          scale={scale}
          showHandles={!activeMember}
        />
        {activeMember?.type === 'line' ? (
          <LineSelection element={activeMember} onLinePointerDown={onLinePointerDown} scale={scale} showHandles />
        ) : activeMember ? (
          <>
            <RectSelection
              className=" is-active-group-member"
              elements={[activeMember]}
              interactionProfile={interactionProfile}
              onResizePointerDown={onResizePointerDown}
              onRotatePointerDown={onRotatePointerDown}
              scale={scale}
              showHandles
            >
              {activeMember.type === 'shape' ? (
                <ShapeKeypointControls element={activeMember} onShapeKeypointPointerDown={onShapeKeypointPointerDown} scale={scale} />
              ) : null}
            </RectSelection>
          </>
        ) : null}
      </>
    )
  }

  const element = elements[0]!
  if (element.type === 'line') return <LineSelection element={element} onLinePointerDown={onLinePointerDown} scale={scale} showHandles={!element.lock} />
  return (
    <>
      <RectSelection
        elements={elements}
        interactionProfile={interactionProfile}
        onResizePointerDown={onResizePointerDown}
        onRotatePointerDown={onRotatePointerDown}
        scale={scale}
        showHandles
      >
        {element.type === 'shape' ? (
          <ShapeKeypointControls element={element} onShapeKeypointPointerDown={onShapeKeypointPointerDown} scale={scale} />
        ) : null}
      </RectSelection>
    </>
  )
}
