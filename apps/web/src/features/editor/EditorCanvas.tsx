/* oxlint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- The slide canvas is an intentional composite application surface with managed keyboard interaction. */

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { useTranslation } from 'react-i18next'

import type { InteractionSnapshot, PointerModifiers, PointerPosition } from '@mona/editor-interactions'
import {
  angleFromPoint,
  boundsToRect,
  clientPointToSlide,
  containsBounds,
  intersectsBounds,
  normalizeRect,
  rectToBounds,
  resizeBounds,
  snapMove,
  type AlignmentGuide,
  type InteractionBounds,
  type InteractionRect,
  type ResizeHandle,
} from '@mona/editor-interactions/geometry'
import {
  editorActions,
  selectActiveElementIds,
  selectCanvasFocus,
  selectCanvasPan,
  selectCanvasZoom,
  selectCropElementId,
  selectCurrentSlide,
  selectGridLineSize,
  selectPresentation,
  selectShowRuler,
} from '@mona/editor-state'
import { createPresentationId, type PresentationCommand } from '@mona/presentation-core'
import type { ElementLinkType, PPTElement, PPTImageElement, Slide } from '@mona/presentation-core/model'

import { EditorContextMenu, LinkEditor } from '@/features/editor/EditorContextMenu'
import {
  MONA_CLIPBOARD_MIME,
  type EditorRuntime,
} from '@/features/editor/editor-runtime'
import {
  buildSnapCandidates,
  getElementBounds,
  getElementsBounds,
  rotateElementsAround,
  scaleElementsIntoBounds,
} from '@/features/editor/editor-geometry'
import { useEditorSelector } from '@/features/editor/use-editor-selector'
import { SlideRenderer } from '@/features/presentation-renderer/SlideRenderer'

type CreateTool = 'text' | 'shape' | 'line'

type GestureContext =
  | { kind: 'drag'; elements: PPTElement[]; bounds: InteractionBounds }
  | { kind: 'resize'; elements: PPTElement[]; bounds: InteractionBounds; handle: ResizeHandle }
  | { kind: 'rotate'; elements: PPTElement[]; center: PointerPosition; startAngle: number }
  | { kind: 'crop'; element: PPTImageElement; handle: ResizeHandle; range: [[number, number], [number, number]] }
  | { kind: 'lasso'; additive: boolean }
  | { kind: 'pan'; pan: PointerPosition }
  | { kind: 'create'; tool: CreateTool }

interface GesturePreview {
  createRect?: InteractionRect
  guides: AlignmentGuide[]
  lasso?: InteractionRect
  pan?: PointerPosition
  updates: ReadonlyMap<string, Partial<PPTElement>>
}

interface ContextMenuState {
  readonly elementId?: string
  readonly position: PointerPosition
  readonly surface: 'canvas' | 'element'
}

interface LinkEditorState {
  readonly elementId: string
  readonly type: ElementLinkType
  readonly value: string
}

const emptyPreview = (): GesturePreview => ({ guides: [], updates: new Map() })

const pointerModifiers = (event: Pick<PointerEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>): PointerModifiers => ({
  alt: event.altKey,
  control: event.ctrlKey,
  meta: event.metaKey,
  shift: event.shiftKey,
})

const rawTransformBounds = (elements: readonly PPTElement[]): InteractionBounds => {
  if (elements.length !== 1) return getElementsBounds(elements)
  const element = elements[0]
  if (!element || element.type === 'line') return getElementsBounds(elements)
  return {
    minX: element.left,
    maxX: element.left + element.width,
    minY: element.top,
    maxY: element.top + element.height,
  }
}

const applyElementUpdates = (slide: Slide, updates: ReadonlyMap<string, Partial<PPTElement>>): Slide => {
  if (!updates.size) return slide
  return {
    ...slide,
    elements: slide.elements.map(element => {
      const props = updates.get(element.id)
      return props ? { ...element, ...props } as PPTElement : element
    }),
  }
}

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value))

const rotatePoint = (point: PointerPosition, center: PointerPosition, degrees: number): PointerPosition => {
  const radians = degrees * Math.PI / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  const x = point.x - center.x
  const y = point.y - center.y
  return {
    x: center.x + x * cosine - y * sine,
    y: center.y + x * sine + y * cosine,
  }
}

const oppositePoint = (bounds: InteractionBounds, handle: ResizeHandle): PointerPosition => ({
  x: handle.includes('left') ? bounds.maxX : handle.includes('right') ? bounds.minX : (bounds.minX + bounds.maxX) / 2,
  y: handle.startsWith('top') ? bounds.maxY : handle.startsWith('bottom') ? bounds.minY : (bounds.minY + bounds.maxY) / 2,
})

const derivePreview = (
  context: GestureContext | null,
  snapshot: InteractionSnapshot,
  slide: Slide,
  viewportSize: number,
  viewportRatio: number,
): GesturePreview => {
  if (!context || snapshot.status !== 'active') return emptyPreview()
  if (context.kind === 'pan') {
    return {
      ...emptyPreview(),
      pan: { x: context.pan.x + snapshot.delta.x, y: context.pan.y + snapshot.delta.y },
    }
  }
  if (context.kind === 'lasso') return { ...emptyPreview(), lasso: normalizeRect(snapshot.origin, snapshot.pointer) }
  if (context.kind === 'create') return { ...emptyPreview(), createRect: normalizeRect(snapshot.origin, snapshot.pointer) }

  if (context.kind === 'drag') {
    let delta = snapshot.delta
    if (snapshot.modifiers.shift) {
      delta = Math.abs(delta.x) >= Math.abs(delta.y) ? { x: delta.x, y: 0 } : { x: 0, y: delta.y }
    }
    const excluded = new Set(context.elements.map(element => element.id))
    const candidates = buildSnapCandidates(slide.elements, excluded, viewportSize, viewportRatio)
    const snapped = snapMove({
      bounds: context.bounds,
      delta,
      horizontalCandidates: candidates.horizontal,
      verticalCandidates: candidates.vertical,
    })
    const updates = new Map<string, Partial<PPTElement>>()
    for (const element of context.elements) {
      updates.set(element.id, {
        left: element.left + snapped.delta.x,
        top: element.top + snapped.delta.y,
      })
    }
    return { guides: snapped.guides, updates }
  }

  if (context.kind === 'resize') {
    const single = context.elements.length === 1 ? context.elements[0] : undefined
    const rotation = single && single.type !== 'line' ? single.rotate : 0
    const radians = rotation * Math.PI / 180
    const localDelta = rotation ? {
      x: Math.cos(radians) * snapshot.delta.x + Math.sin(radians) * snapshot.delta.y,
      y: Math.cos(radians) * snapshot.delta.y - Math.sin(radians) * snapshot.delta.x,
    } : snapshot.delta
    let target = resizeBounds(context.bounds, context.handle, localDelta, {
      lockAspectRatio: snapshot.modifiers.shift || context.elements.some(element => 'fixedRatio' in element && element.fixedRatio),
    })
    if (rotation) {
      const originCenter = {
        x: (context.bounds.minX + context.bounds.maxX) / 2,
        y: (context.bounds.minY + context.bounds.maxY) / 2,
      }
      const targetCenter = {
        x: (target.minX + target.maxX) / 2,
        y: (target.minY + target.maxY) / 2,
      }
      const fixedOrigin = rotatePoint(oppositePoint(context.bounds, context.handle), originCenter, rotation)
      const fixedTarget = rotatePoint(oppositePoint(target, context.handle), targetCenter, rotation)
      const correction = { x: fixedOrigin.x - fixedTarget.x, y: fixedOrigin.y - fixedTarget.y }
      target = {
        minX: target.minX + correction.x,
        maxX: target.maxX + correction.x,
        minY: target.minY + correction.y,
        maxY: target.maxY + correction.y,
      }
    }
    return { ...emptyPreview(), updates: scaleElementsIntoBounds(context.elements, context.bounds, target) }
  }

  if (context.kind === 'rotate') {
    const angle = angleFromPoint(context.center, snapshot.pointer)
    let delta = angle - context.startAngle
    if (delta > 180) delta -= 360
    if (delta < -180) delta += 360
    return { ...emptyPreview(), updates: rotateElementsAround(context.elements, context.center, delta) }
  }

  const range = structuredClone(context.range)
  const x = snapshot.delta.x / Math.max(context.element.width, 1) * 100
  const y = snapshot.delta.y / Math.max(context.element.height, 1) * 100
  if (context.handle.includes('left')) range[0][0] = clamp(context.range[0][0] + x, 0, range[1][0] - 1)
  if (context.handle.includes('right')) range[1][0] = clamp(context.range[1][0] + x, range[0][0] + 1, 100)
  if (context.handle.startsWith('top')) range[0][1] = clamp(context.range[0][1] + y, 0, range[1][1] - 1)
  if (context.handle.startsWith('bottom')) range[1][1] = clamp(context.range[1][1] + y, range[0][1] + 1, 100)
  return {
    ...emptyPreview(),
    updates: new Map([[context.element.id, {
      clip: { ...(context.element.clip ?? { shape: 'rect' }), range },
    } as Partial<PPTElement>]]),
  }
}

const toCommands = (updates: ReadonlyMap<string, Partial<PPTElement>>): PresentationCommand[] => (
  [...updates.entries()].map(([id, props]) => ({
    type: 'element.update',
    payload: { id, props },
  }))
)

const isTextInput = (target: EventTarget | null) => {
  const element = target as HTMLElement | null
  return element?.isContentEditable || element?.tagName === 'INPUT' || element?.tagName === 'TEXTAREA' || element?.tagName === 'SELECT'
}

const duplicatePreviewElements = (
  source: readonly PPTElement[],
  updates: ReadonlyMap<string, Partial<PPTElement>>,
): PPTElement[] => {
  const groupIds = new Map<string, string>()
  return structuredClone(source).map(element => {
    if (element.groupId && !groupIds.has(element.groupId)) groupIds.set(element.groupId, createPresentationId())
    return {
      ...element,
      ...updates.get(element.id),
      id: createPresentationId(),
      groupId: element.groupId ? groupIds.get(element.groupId) : undefined,
    } as PPTElement
  })
}

const createElementFromGesture = (
  tool: CreateTool,
  rect: InteractionRect,
  origin: PointerPosition,
  pointer: PointerPosition,
): PPTElement => {
  const width = rect.width >= 30 ? rect.width : 200
  const height = rect.height >= 30 ? rect.height : tool === 'text' ? 60 : 140
  if (tool === 'line') {
    const lineRect = rect.width >= 30 || rect.height >= 30 ? rect : { left: origin.x, top: origin.y, width: 200, height: 0 }
    return {
      id: createPresentationId(),
      type: 'line',
      left: lineRect.left,
      top: lineRect.top,
      width: 3,
      start: [origin.x <= pointer.x ? 0 : lineRect.width, origin.y <= pointer.y ? 0 : lineRect.height],
      end: [origin.x <= pointer.x ? lineRect.width : 0, origin.y <= pointer.y ? lineRect.height : 0],
      style: 'solid',
      color: '#d14424',
      points: ['', ''],
    }
  }
  if (tool === 'text') {
    return {
      id: createPresentationId(),
      type: 'text',
      left: rect.left,
      top: rect.top,
      width,
      height,
      rotate: 0,
      content: '<p>Text</p>',
      defaultFontName: 'Arial',
      defaultColor: '#222222',
    }
  }
  return {
    id: createPresentationId(),
    type: 'shape',
    left: rect.left,
    top: rect.top,
    width,
    height,
    rotate: 0,
    fixedRatio: false,
    viewBox: [width, height],
    path: `M0 0 H${width} V${height} H0 Z`,
    fill: '#d14424',
  }
}

function EditorRulers({ height, scale, selection, width }: {
  height: number
  scale: number
  selection?: InteractionBounds
  width: number
}) {
  const horizontal = Array.from({ length: Math.floor(width / 100) + 1 }, (_, index) => index * 100)
  const vertical = Array.from({ length: Math.floor(height / 100) + 1 }, (_, index) => index * 100)
  return (
    <div aria-hidden="true" className="mona-editor-rulers">
      <div className="mona-editor-ruler is-horizontal">
        {horizontal.map(value => <span key={value} style={{ left: value * scale }}>{value || ''}</span>)}
        {selection ? <i style={{ left: selection.minX * scale, width: (selection.maxX - selection.minX) * scale }} /> : null}
      </div>
      <div className="mona-editor-ruler is-vertical">
        {vertical.map(value => <span key={value} style={{ top: value * scale }}>{value || ''}</span>)}
        {selection ? <i style={{ height: (selection.maxY - selection.minY) * scale, top: selection.minY * scale }} /> : null}
      </div>
    </div>
  )
}

const resizeHandles: ResizeHandle[] = ['top-left', 'top', 'top-right', 'right', 'bottom-right', 'bottom', 'bottom-left', 'left']

function SelectionOverlay({
  crop,
  elements,
  onCropPointerDown,
  onResizePointerDown,
  onRotatePointerDown,
  scale,
}: {
  crop: boolean
  elements: PPTElement[]
  onCropPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, handle: ResizeHandle) => void
  onResizePointerDown: (event: ReactPointerEvent<HTMLButtonElement>, handle: ResizeHandle) => void
  onRotatePointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void
  scale: number
}) {
  const { t } = useTranslation()
  if (!elements.length) return null
  const bounds = rawTransformBounds(elements)
  const rect = boundsToRect(bounds)
  const single = elements.length === 1 ? elements[0] : undefined
  const rotate = single && single.type !== 'line' ? single.rotate : 0
  const canResize = elements.every(element => !element.lock)
  const canRotate = canResize && elements.every(element => !['line', 'chart', 'video', 'audio'].includes(element.type))
  const cropImage = crop && single?.type === 'image' ? single : undefined
  const cropRange = cropImage?.clip?.range ?? [[0, 0], [100, 100]]
  const frame = cropImage ? {
    left: cropImage.left + cropImage.width * cropRange[0][0] / 100,
    top: cropImage.top + cropImage.height * cropRange[0][1] / 100,
    width: cropImage.width * (cropRange[1][0] - cropRange[0][0]) / 100,
    height: cropImage.height * (cropRange[1][1] - cropRange[0][1]) / 100,
  } : rect
  return (
    <div
      aria-label={cropImage ? t('foundation.editor.cropFrame') : t('foundation.editor.selection', { count: elements.length })}
      className={`mona-selection-frame${cropImage ? ' is-crop' : ''}`}
      data-testid="selection-frame"
      style={{
        left: frame.left,
        top: frame.top,
        width: frame.width,
        height: frame.height,
        transform: cropImage ? undefined : `rotate(${rotate}deg)`,
        '--mona-handle-size': `${8 / scale}px`,
        '--mona-outline-width': `${1 / scale}px`,
      } as React.CSSProperties}
    >
      {canResize ? resizeHandles.map(handle => (
        <button
          aria-label={t(cropImage ? 'foundation.editor.cropHandle' : 'foundation.editor.resizeHandle', {
            handle: t(`foundation.editor.handle.${handle}`),
          })}
          className={`mona-transform-handle is-${handle}`}
          data-handle={handle}
          key={handle}
          onPointerDown={event => cropImage ? onCropPointerDown(event, handle) : onResizePointerDown(event, handle)}
          type="button"
        />
      )) : null}
      {canRotate && !cropImage ? (
        <button aria-label={t('foundation.editor.rotateSelection')} className="mona-rotate-handle" onPointerDown={onRotatePointerDown} type="button" />
      ) : null}
    </div>
  )
}

export function EditorCanvas({ runtime }: { runtime: EditorRuntime }) {
  const { t } = useTranslation()
  const presentation = useEditorSelector(runtime.store, selectPresentation)
  const currentSlide = useEditorSelector(runtime.store, selectCurrentSlide)
  const activeElementIds = useEditorSelector(runtime.store, selectActiveElementIds)
  const canvasFocus = useEditorSelector(runtime.store, selectCanvasFocus)
  const canvasPan = useEditorSelector(runtime.store, selectCanvasPan)
  const canvasZoom = useEditorSelector(runtime.store, selectCanvasZoom)
  const cropElementId = useEditorSelector(runtime.store, selectCropElementId)
  const gridLineSize = useEditorSelector(runtime.store, selectGridLineSize)
  const showRuler = useEditorSelector(runtime.store, selectShowRuler)
  const activeTool = useEditorSelector(runtime.store, state => state.session.activeTool as CreateTool | null)
  const interaction = useSyncExternalStore(
    runtime.interaction.subscribe,
    runtime.interaction.getSnapshot,
    runtime.interaction.getSnapshot,
  )
  const stageRef = useRef<HTMLElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const gestureRef = useRef<GestureContext | null>(null)
  const restoreStageFocusRef = useRef(false)
  const spacePressedRef = useRef(false)
  const [gestureContext, setGestureContext] = useState<GestureContext | null>(null)
  const [fitScale, setFitScale] = useState(0)
  const [isSpacePressed, setIsSpacePressed] = useState(false)
  const [linkEditor, setLinkEditor] = useState<LinkEditorState | null>(null)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)

  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) return undefined
    const update = () => {
      const rect = stage.getBoundingClientRect()
      const availableWidth = Math.max(1, rect.width - 64)
      const availableHeight = Math.max(1, rect.height - 64)
      setFitScale(Math.min(
        availableWidth / presentation.viewportSize,
        availableHeight / (presentation.viewportSize * presentation.viewportRatio),
        1,
      ))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [presentation.viewportRatio, presentation.viewportSize])

  useEffect(() => {
    if (!menu) return undefined
    const close = () => setMenu(null)
    window.addEventListener('pointerdown', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('blur', close)
    }
  }, [menu])

  useEffect(() => {
    if (linkEditor || !restoreStageFocusRef.current) return
    restoreStageFocusRef.current = false
    stageRef.current?.focus()
  }, [linkEditor])

  if (!currentSlide) return <section className="mona-render-stage">{t('foundation.editor.noSlides')}</section>

  const scale = fitScale * canvasZoom / 100
  const preview = derivePreview(gestureContext, interaction, currentSlide, presentation.viewportSize, presentation.viewportRatio)
  const previewSlide = applyElementUpdates(currentSlide, preview.updates)
  const selectedElements = previewSlide.elements.filter(element => activeElementIds.includes(element.id))
  const selectionBounds = selectedElements.length ? getElementsBounds(selectedElements) : undefined
  const menuElement = menu?.elementId ? previewSlide.elements.find(element => element.id === menu.elementId) : undefined
  const pan = preview.pan ?? canvasPan

  const slidePoint = (event: Pick<PointerEvent, 'clientX' | 'clientY'>) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect || !scale) return undefined
    return clientPointToSlide({ x: event.clientX, y: event.clientY }, rect, scale)
  }

  const begin = (
    event: ReactPointerEvent<HTMLElement>,
    kind: InteractionSnapshot['kind'] & {},
    point: PointerPosition,
    context: GestureContext,
  ) => {
    gestureRef.current = context
    setGestureContext(context)
    runtime.interaction.begin({
      gestureId: createPresentationId(),
      kind,
      pointer: point,
      modifiers: pointerModifiers(event.nativeEvent),
    })
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const selectElement = (event: Pick<MouseEvent, 'ctrlKey' | 'metaKey' | 'shiftKey'>, element: PPTElement) => {
    const modifier = event.ctrlKey || event.metaKey || event.shiftKey
    const groupIds = element.groupId
      ? currentSlide.elements.filter(item => item.groupId === element.groupId).map(item => item.id)
      : [element.id]
    let next = activeElementIds
    if (!activeElementIds.includes(element.id)) next = modifier ? [...new Set([...activeElementIds, ...groupIds])] : groupIds
    else if (modifier) {
      const removed = new Set(groupIds)
      const candidate = activeElementIds.filter(id => !removed.has(id))
      if (candidate.length) next = candidate
    }
    runtime.store.dispatch(editorActions.selectionChanged(next))
    runtime.store.dispatch(editorActions.cropElementChanged(null))
    return next
  }

  const handleElementPointerDown = (event: ReactPointerEvent<HTMLButtonElement>, element: PPTElement) => {
    if (event.button !== 0 || activeTool) return
    event.stopPropagation()
    stageRef.current?.focus()
    const ids = selectElement(event, element)
    if (element.lock) return
    const point = slidePoint(event.nativeEvent)
    if (!point) return
    const elements = currentSlide.elements.filter(item => ids.includes(item.id))
    begin(event, 'drag', point, { kind: 'drag', elements: structuredClone(elements), bounds: getElementsBounds(elements) })
  }

  const createTextAtPoint = (point: PointerPosition) => {
    const element = createElementFromGesture('text', { left: point.x, top: point.y, width: 200, height: 60 }, point, point)
    if (runtime.commit('Create text', [{ type: 'element.add', elements: element }])) {
      runtime.store.dispatch(editorActions.selectionChanged([element.id]))
    }
  }

  const handleBlankPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    stageRef.current?.focus()
    runtime.store.dispatch(editorActions.canvasFocusChanged(true))
    setMenu(null)
    if (spacePressedRef.current) {
      begin(event, 'pan', { x: event.clientX, y: event.clientY }, { kind: 'pan', pan: canvasPan })
      return
    }
    const point = slidePoint(event.nativeEvent)
    if (!point) return
    if (activeTool) {
      begin(event, 'create', point, { kind: 'create', tool: activeTool })
      return
    }
    runtime.store.dispatch(editorActions.selectionChanged([]))
    runtime.store.dispatch(editorActions.cropElementChanged(null))
    begin(event, 'lasso', point, { kind: 'lasso', additive: event.ctrlKey || event.metaKey || event.shiftKey })
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (runtime.interaction.getSnapshot().status !== 'active') return
    const context = gestureRef.current
    const point = context?.kind === 'pan'
      ? { x: event.clientX, y: event.clientY }
      : slidePoint(event.nativeEvent)
    if (!point) return
    runtime.interaction.updatePointer(point, pointerModifiers(event.nativeEvent))
  }

  const finishGesture = (event: ReactPointerEvent<HTMLElement>) => {
    const context = gestureRef.current
    const snapshot = runtime.interaction.getSnapshot()
    if (!context || snapshot.status !== 'active') return
    const finalPreview = derivePreview(context, snapshot, currentSlide, presentation.viewportSize, presentation.viewportRatio)
    runtime.interaction.complete()
    gestureRef.current = null
    setGestureContext(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)

    if (context.kind === 'pan' && finalPreview.pan) {
      runtime.store.dispatch(editorActions.canvasPanChanged(finalPreview.pan))
      return
    }
    if (context.kind === 'lasso' && finalPreview.lasso) {
      const selection = rectToBounds(finalPreview.lasso)
      const candidates = currentSlide.elements.filter(element => {
        if (element.lock || presentation.slides[presentation.slideIndex]?.elements === undefined) return false
        const bounds = getElementBounds(element)
        return context.additive ? intersectsBounds(selection, bounds) : containsBounds(selection, bounds)
      })
      const candidateIds = new Set(candidates.map(element => element.id))
      const ids = candidates.filter(element => {
        if (!element.groupId) return true
        return currentSlide.elements
          .filter(item => item.groupId === element.groupId)
          .every(item => candidateIds.has(item.id))
      }).map(element => element.id)
      runtime.store.dispatch(editorActions.selectionChanged(ids))
      return
    }
    if (context.kind === 'create' && finalPreview.createRect) {
      const element = createElementFromGesture(context.tool, finalPreview.createRect, snapshot.origin, snapshot.pointer)
      if (runtime.commit(`Create ${context.tool}`, [{ type: 'element.add', elements: element }])) {
        runtime.store.dispatch(editorActions.selectionChanged([element.id]))
        runtime.store.dispatch(editorActions.activeToolChanged(null))
      }
      return
    }
    const minimumMovement = context.kind === 'drag' ? 5 : 0.01
    if ((Math.abs(snapshot.delta.x) < minimumMovement && Math.abs(snapshot.delta.y) < minimumMovement) || !finalPreview.updates.size) return
    if (context.kind === 'drag' && (snapshot.modifiers.control || snapshot.modifiers.meta)) {
      const additions = duplicatePreviewElements(context.elements, finalPreview.updates)
      if (runtime.commit('Duplicate and move elements', [{ type: 'element.add', elements: additions }])) {
        runtime.store.dispatch(editorActions.selectionChanged(additions.map(element => element.id)))
      }
      return
    }
    if (context.kind === 'drag' || context.kind === 'resize' || context.kind === 'rotate' || context.kind === 'crop') {
      const labels = { drag: 'Move elements', resize: 'Resize elements', rotate: 'Rotate elements', crop: 'Crop image' } as const
      runtime.commit(labels[context.kind], toCommands(finalPreview.updates))
    }
  }

  const cancelGesture = (event: ReactPointerEvent<HTMLElement>) => {
    runtime.interaction.cancel()
    gestureRef.current = null
    setGestureContext(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const beginResize = (event: ReactPointerEvent<HTMLButtonElement>, handle: ResizeHandle) => {
    event.stopPropagation()
    const point = slidePoint(event.nativeEvent)
    if (!point || !selectedElements.length) return
    begin(event, 'resize', point, {
      kind: 'resize',
      elements: structuredClone(selectedElements),
      bounds: rawTransformBounds(selectedElements),
      handle,
    })
  }

  const beginRotate = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    const point = slidePoint(event.nativeEvent)
    if (!point || !selectedElements.length) return
    const bounds = rawTransformBounds(selectedElements)
    const center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 }
    begin(event, 'rotate', point, {
      kind: 'rotate',
      elements: structuredClone(selectedElements),
      center,
      startAngle: angleFromPoint(center, point),
    })
  }

  const beginCrop = (event: ReactPointerEvent<HTMLButtonElement>, handle: ResizeHandle) => {
    event.stopPropagation()
    const image = selectedElements.length === 1 && selectedElements[0]?.type === 'image' ? selectedElements[0] : undefined
    const point = slidePoint(event.nativeEvent)
    if (!point || !image) return
    begin(event, 'crop', point, {
      kind: 'crop',
      element: structuredClone(image),
      handle,
      range: structuredClone(image.clip?.range ?? [[0, 0], [100, 100]]),
    })
  }

  const writeClipboard = async (serialized: string | undefined) => {
    if (!serialized || !navigator.clipboard) return
    try { await navigator.clipboard.writeText(serialized) }
    catch { /* Native clipboard events and the in-memory fallback remain available. */ }
  }

  const handleCopy = (event: ReactClipboardEvent<HTMLElement>) => {
    const serialized = runtime.copySelection()
    if (!serialized) return
    event.preventDefault()
    event.clipboardData.setData(MONA_CLIPBOARD_MIME, serialized)
    event.clipboardData.setData('text/plain', serialized)
  }

  const handleCut = (event: ReactClipboardEvent<HTMLElement>) => {
    const serialized = runtime.cutSelection()
    if (!serialized) return
    event.preventDefault()
    event.clipboardData.setData(MONA_CLIPBOARD_MIME, serialized)
    event.clipboardData.setData('text/plain', serialized)
  }

  const handlePaste = (event: ReactClipboardEvent<HTMLElement>) => {
    const serialized = event.clipboardData.getData(MONA_CLIPBOARD_MIME) || event.clipboardData.getData('text/plain')
    if (runtime.paste(serialized).length) event.preventDefault()
  }

  const nudgeSelection = (x: number, y: number) => {
    const commands: PresentationCommand[] = selectedElements.map(element => ({
      type: 'element.update',
      payload: { id: element.id, props: { left: element.left + x, top: element.top + y } },
    }))
    runtime.commit('Nudge elements', commands)
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (isTextInput(event.target)) return
    const modifier = event.ctrlKey || event.metaKey
    const key = event.key.toLowerCase()
    if (event.key === ' ') {
      spacePressedRef.current = true
      setIsSpacePressed(true)
      event.preventDefault()
      return
    }
    if (event.key === 'Escape') {
      runtime.interaction.cancel()
      gestureRef.current = null
      setGestureContext(null)
      runtime.store.dispatch(editorActions.activeToolChanged(null))
      runtime.store.dispatch(editorActions.cropElementChanged(null))
      setMenu(null)
      return
    }
    if (modifier && key === 'a') { event.preventDefault(); runtime.selectAll(); return }
    if (modifier && key === 'c') {
      void writeClipboard(runtime.copySelection())
      return
    }
    if (modifier && key === 'x') {
      event.preventDefault()
      void writeClipboard(runtime.cutSelection())
      return
    }
    if (modifier && key === 'v' && runtime.getClipboardText()) {
      event.preventDefault()
      runtime.paste()
      return
    }
    if (modifier && key === 'd' && selectedElements.length) {
      event.preventDefault()
      runtime.copySelection()
      runtime.paste()
      return
    }
    if (modifier && key === 'l' && selectedElements.length) {
      event.preventDefault()
      handleContextAction('lock')
      return
    }
    if (modifier && key === 'g' && selectedElements.length) {
      event.preventDefault()
      handleContextAction(event.shiftKey ? 'ungroup' : 'group')
      return
    }
    if (modifier && key === 'z') {
      event.preventDefault()
      if (event.shiftKey) runtime.redo()
      else runtime.undo()
      return
    }
    if (modifier && key === 'y') { event.preventDefault(); runtime.redo(); return }
    if (modifier && (event.key === '+' || event.key === '=')) {
      event.preventDefault(); runtime.store.dispatch(editorActions.canvasZoomChanged(canvasZoom + 10)); return
    }
    if (modifier && event.key === '-') {
      event.preventDefault(); runtime.store.dispatch(editorActions.canvasZoomChanged(canvasZoom - 10)); return
    }
    if (modifier && key === '0') {
      event.preventDefault()
      runtime.store.dispatch(editorActions.canvasZoomChanged(100))
      runtime.store.dispatch(editorActions.canvasPanChanged({ x: 0, y: 0 }))
      return
    }
    if (event.altKey && (key === 'f' || key === 'b')) {
      const canOrder = selectedElements.length === 1 || !!selectedElements[0]?.groupId
      if (canOrder) {
        event.preventDefault()
        handleContextAction(key === 'f' ? 'bring-front' : 'send-back')
      }
      return
    }
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); runtime.deleteSelection(); return }
    if (event.key.startsWith('Arrow') && selectedElements.length) {
      event.preventDefault()
      const amount = event.shiftKey ? 10 : 1
      if (event.key === 'ArrowLeft') nudgeSelection(-amount, 0)
      if (event.key === 'ArrowRight') nudgeSelection(amount, 0)
      if (event.key === 'ArrowUp') nudgeSelection(0, -amount)
      if (event.key === 'ArrowDown') nudgeSelection(0, amount)
      return
    }
    if (event.key === 'Enter' && selectedElements.length === 1 && selectedElements[0]?.type === 'image') {
      runtime.store.dispatch(editorActions.cropElementChanged(cropElementId ? null : selectedElements[0].id))
      return
    }
    if (!modifier && !event.altKey && ['r', 't', 'l'].includes(key)) {
      const tool = ({ r: 'shape', t: 'text', l: 'line' } as const)[key as 'r' | 't' | 'l']
      runtime.store.dispatch(editorActions.activeToolChanged(tool))
    }
  }

  function handleContextAction(action: string) {
    setMenu(null)
    stageRef.current?.focus()
    if (action === 'copy') void writeClipboard(runtime.copySelection())
    else if (action === 'cut') void writeClipboard(runtime.cutSelection())
    else if (action === 'paste') {
      if (!runtime.paste().length && navigator.clipboard) {
        void navigator.clipboard.readText().then(serialized => runtime.paste(serialized)).catch(() => undefined)
      }
    }
    else if (action === 'delete') runtime.deleteSelection()
    else if (action === 'select-all') runtime.selectAll()
    else if (action === 'ruler') runtime.store.dispatch(editorActions.rulerVisibilityChanged(!showRuler))
    else if (action === 'grid-toggle') runtime.store.dispatch(editorActions.gridLineSizeChanged(gridLineSize ? 0 : 50))
    else if (action.startsWith('grid-')) runtime.store.dispatch(editorActions.gridLineSizeChanged(Number(action.slice(5))))
    else if (action === 'reset-slide') {
      const elementIds = currentSlide.elements.map(element => element.id)
      if (elementIds.length && runtime.commit('Reset slide', [{ type: 'element.delete', elementIds }])) {
        runtime.store.dispatch(editorActions.selectionChanged([]))
      }
    }
    else if (action.startsWith('align-')) {
      const width = presentation.viewportSize
      const height = presentation.viewportSize * presentation.viewportRatio
      const bounds = getElementsBounds(selectedElements)
      let offsetX = 0
      let offsetY = 0
      if (action === 'align-center' || action === 'align-horizontal') offsetX = width / 2 - (bounds.minX + bounds.maxX) / 2
      if (action === 'align-left') offsetX = -bounds.minX
      if (action === 'align-right') offsetX = width - bounds.maxX
      if (action === 'align-center' || action === 'align-vertical') offsetY = height / 2 - (bounds.minY + bounds.maxY) / 2
      if (action === 'align-top') offsetY = -bounds.minY
      if (action === 'align-bottom') offsetY = height - bounds.maxY
      const commands: PresentationCommand[] = selectedElements.map(element => {
        return {
          type: 'element.update',
          payload: { id: element.id, props: { left: element.left + offsetX, top: element.top + offsetY } },
        }
      })
      runtime.commit('Align elements to slide', commands)
    }
    else if (['bring-front', 'bring-forward', 'send-back', 'send-backward'].includes(action)) {
      const selected = new Set(activeElementIds)
      let elements = [...currentSlide.elements]
      if (action === 'bring-front') elements = [...elements.filter(element => !selected.has(element.id)), ...elements.filter(element => selected.has(element.id))]
      if (action === 'send-back') elements = [...elements.filter(element => selected.has(element.id)), ...elements.filter(element => !selected.has(element.id))]
      if (action === 'bring-forward') {
        for (let index = elements.length - 2; index >= 0; index -= 1) {
          if (selected.has(elements[index]!.id) && !selected.has(elements[index + 1]!.id)) {
            ;[elements[index], elements[index + 1]] = [elements[index + 1]!, elements[index]!]
          }
        }
      }
      if (action === 'send-backward') {
        for (let index = 1; index < elements.length; index += 1) {
          if (selected.has(elements[index]!.id) && !selected.has(elements[index - 1]!.id)) {
            ;[elements[index], elements[index - 1]] = [elements[index - 1]!, elements[index]!]
          }
        }
      }
      runtime.commit('Reorder elements', [{ type: 'slide.update', props: { elements } }])
    }
    else if (action === 'group') {
      const selected = new Set(activeElementIds)
      const groupId = createPresentationId()
      const groupedElements = currentSlide.elements
        .filter(element => selected.has(element.id))
        .map(element => ({ ...element, groupId }))
      const highestSelectedIndex = currentSlide.elements.reduce(
        (highest, element, index) => selected.has(element.id) ? index : highest,
        -1,
      )
      const elements = currentSlide.elements.filter(element => !selected.has(element.id))
      const insertionIndex = Math.max(0, highestSelectedIndex - groupedElements.length + 1)
      elements.splice(insertionIndex, 0, ...groupedElements)
      runtime.commit('Group elements', [{ type: 'slide.update', props: { elements } }])
    }
    else if (action === 'ungroup') {
      const changed = runtime.commit('Ungroup elements', activeElementIds.map(id => ({
        type: 'element.properties.remove',
        payload: { id, property: 'groupId' },
      })))
      const selectedId = menuElement?.id ?? activeElementIds[0]
      if (changed && selectedId) runtime.store.dispatch(editorActions.selectionChanged([selectedId]))
    }
    else if (action === 'lock' || action === 'unlock') {
      const changed = runtime.commit(action === 'lock' ? 'Lock elements' : 'Unlock elements', [{
        type: 'element.update',
        payload: { id: activeElementIds, props: { lock: action === 'lock' } },
      }])
      if (changed && action === 'lock') runtime.store.dispatch(editorActions.selectionChanged([]))
    }
    else if (action === 'set-link' && menuElement) {
      setLinkEditor({
        elementId: menuElement.id,
        type: menuElement.link?.type ?? 'web',
        value: menuElement.link?.target ?? '',
      })
    }
  }

  const closeLinkEditor = () => {
    restoreStageFocusRef.current = true
    setLinkEditor(null)
  }

  const applyLink = () => {
    if (!linkEditor?.value.trim()) return
    if (linkEditor.type === 'web') {
      try {
        const url = new URL(linkEditor.value.trim())
        if (!['http:', 'https:'].includes(url.protocol)) return
      }
      catch { return }
    }
    runtime.commit('Set element link', [{
      type: 'element.update',
      payload: {
        id: linkEditor.elementId,
        props: { link: { type: linkEditor.type, target: linkEditor.value.trim() } },
      },
    }])
    closeLinkEditor()
  }

  const handleWheel = (event: React.WheelEvent<HTMLElement>) => {
    if (!(event.ctrlKey || event.metaKey)) return
    event.preventDefault()
    runtime.store.dispatch(editorActions.canvasZoomChanged(canvasZoom + (event.deltaY > 0 ? -10 : 10)))
  }

  const frameWidth = presentation.viewportSize * scale
  const frameHeight = presentation.viewportSize * presentation.viewportRatio * scale

  return (
    <section
      aria-label={t('foundation.editor.canvas')}
      className={`mona-render-stage mona-editor-stage${canvasFocus ? ' has-focus' : ''}${activeTool ? ' is-creating' : ''}${isSpacePressed ? ' is-panning' : ''}`}
      data-active-tool={activeTool ?? 'select'}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          runtime.store.dispatch(editorActions.canvasFocusChanged(false))
          spacePressedRef.current = false
          setIsSpacePressed(false)
        }
      }}
      onCopy={handleCopy}
      onCut={handleCut}
      onDoubleClick={event => {
        if ((event.target as HTMLElement).closest('[data-element-hit]')) return
        const point = slidePoint(event.nativeEvent)
        if (point && !activeTool) createTextAtPoint(point)
      }}
      onKeyDown={handleKeyDown}
      onKeyUp={event => {
        if (event.key === ' ') {
          spacePressedRef.current = false
          setIsSpacePressed(false)
        }
      }}
      onPaste={handlePaste}
      onPointerCancel={cancelGesture}
      onPointerDown={handleBlankPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishGesture}
      onContextMenu={event => {
        event.preventDefault()
        stageRef.current?.focus()
        setMenu({ position: { x: event.clientX, y: event.clientY }, surface: 'canvas' })
      }}
      onWheel={handleWheel}
      ref={stageRef}
      role="application"
      tabIndex={0}
    >
      {fitScale > 0 ? (
        <div
          className="mona-editor-viewport-frame"
          style={{
            width: frameWidth,
            height: frameHeight,
            transform: `translate(${pan.x}px, ${pan.y}px)`,
          }}
        >
          {showRuler ? (
            <EditorRulers
              height={presentation.viewportSize * presentation.viewportRatio}
              scale={scale}
              selection={selectionBounds}
              width={presentation.viewportSize}
            />
          ) : null}
          <div
            className="mona-editor-slide-canvas"
            ref={canvasRef}
            style={{
              width: presentation.viewportSize,
              height: presentation.viewportSize * presentation.viewportRatio,
              transform: `scale(${scale})`,
            }}
          >
            <SlideRenderer
              slide={previewSlide}
              theme={presentation.theme}
              viewportRatio={presentation.viewportRatio}
              viewportSize={presentation.viewportSize}
            />
            {gridLineSize ? (
              <div
                aria-hidden="true"
                className="mona-editor-grid"
                style={{ '--mona-grid-size': `${gridLineSize}px` } as React.CSSProperties}
              />
            ) : null}
            {preview.guides.map((guide, index) => (
              <i
                aria-hidden="true"
                className={`mona-alignment-guide is-${guide.orientation}`}
                key={`${guide.orientation}-${guide.axis}-${index}`}
                style={guide.orientation === 'horizontal'
                  ? { left: guide.from, top: guide.axis, width: guide.to - guide.from, height: 0 }
                  : { left: guide.axis, top: guide.from, width: 0, height: guide.to - guide.from }}
              />
            ))}
            {previewSlide.elements.map((element, index) => {
              const bounds = element.type === 'line' ? getElementBounds(element) : undefined
              return (
                <button
                  aria-label={t('foundation.editor.selectElement', { type: element.name || element.type, id: element.id })}
                  className="mona-element-hit-target"
                  data-element-hit={element.id}
                  key={element.id}
                  onContextMenu={event => {
                    event.preventDefault()
                    event.stopPropagation()
                    if (!activeElementIds.includes(element.id)) selectElement(event.nativeEvent, element)
                    setMenu({
                      elementId: element.id,
                      position: { x: event.clientX, y: event.clientY },
                      surface: 'element',
                    })
                  }}
                  onDoubleClick={event => event.stopPropagation()}
                  onPointerDown={event => handleElementPointerDown(event, element)}
                  type="button"
                  style={element.type === 'line'
                    ? {
                        left: bounds!.minX,
                        top: bounds!.minY - 6,
                        width: Math.max(bounds!.maxX - bounds!.minX, 12),
                        height: Math.max(bounds!.maxY - bounds!.minY, 12),
                        zIndex: 500 + index,
                      }
                    : {
                        left: element.left,
                        top: element.top,
                        width: element.width,
                        height: element.height,
                        transform: `rotate(${element.rotate}deg)`,
                        zIndex: 500 + index,
                      }}
                />
              )
            })}
            <SelectionOverlay
              crop={!!cropElementId}
              elements={selectedElements}
              onCropPointerDown={beginCrop}
              onResizePointerDown={beginResize}
              onRotatePointerDown={beginRotate}
              scale={scale}
            />
            {preview.lasso ? <div className="mona-lasso-selection" style={preview.lasso} /> : null}
            {preview.createRect ? <div className="mona-create-selection" style={preview.createRect} /> : null}
          </div>
        </div>
      ) : null}
      {menu ? (
        <EditorContextMenu
          canGroup={activeElementIds.length > 1}
          canOrder={activeElementIds.length <= 1 || !!menuElement?.groupId}
          canPaste={!!runtime.getClipboardText() || !!navigator.clipboard}
          gridLineSize={gridLineSize}
          grouped={!!menuElement?.groupId}
          locked={!!menuElement?.lock}
          onAction={handleContextAction}
          position={menu.position}
          showRuler={showRuler}
          surface={menu.surface}
        />
      ) : null}
      {linkEditor ? (
        <LinkEditor
          linkType={linkEditor.type}
          onCancel={closeLinkEditor}
          onChange={value => setLinkEditor({ ...linkEditor, value })}
          onSubmit={applyLink}
          onTypeChange={type => setLinkEditor({
            ...linkEditor,
            type,
            value: type === 'web'
              ? ''
              : presentation.slides.find(slide => slide.id !== currentSlide.id)?.id ?? '',
          })}
          slideOptions={presentation.slides.map((slide, index) => ({
            disabled: slide.id === currentSlide.id,
            id: slide.id,
            label: t('foundation.editor.link.slideOption', { number: index + 1 }),
          }))}
          value={linkEditor.value}
        />
      ) : null}
      <span aria-live="polite" className="mona-editor-status">
        {activeTool
          ? t('foundation.editor.creationToolActive', { tool: t(`foundation.editor.tool.${activeTool}`) })
          : t('foundation.editor.selection', { count: selectedElements.length })}
      </span>
    </section>
  )
}
