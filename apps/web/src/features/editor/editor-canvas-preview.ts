import type { InteractionSnapshot, PointerModifiers, PointerPosition } from '@mona/editor-interactions'
import {
  angleFromPoint,
  lockDeltaToDominantAxis,
  normalizeRect,
  resizeBounds,
  snapAngle,
  snapMove,
  type AlignmentGuide,
  type InteractionBounds,
  type InteractionRect,
  type ResizeHandle,
} from '@mona/editor-interactions/geometry'
import {
  createPresentationId,
  copyElementTreeWithPowerPointOrigins,
  flattenElementTree,
  SHAPE_PATH_FORMULAS,
  type PresentationCommand,
} from '@mona/presentation-core'
import type { PPTElement, PPTImageElement, PPTLineElement, PPTShapeElement, Slide, SlideTheme } from '@mona/presentation-core/model'

import type { EditorCreateTool } from '@/features/editor/editor-create-tool'
import {
  buildSnapCandidates,
  buildResizeSnapCandidates,
  constrainCreateGesturePoint,
  commitImageCropGeometry,
  getMinimumElementSize,
  moveLineControlPoint,
  moveShapeKeypoint,
  normalizeAngle,
  rotateElementsAround,
  scaleElementsIntoBounds,
  snapResizePoint,
  updateImageCropGeometry,
  type CropControlHandle,
  type CreateGestureSelection,
  type ImageCropGeometry,
  type LineControlHandle,
} from '@/features/editor/editor-geometry'
import type { EditorRuntime } from '@/features/editor/editor-runtime'

// The pure half of the slide canvas: gesture context/preview types and the
// geometry that turns an in-flight gesture into element updates. Everything
// here is renderless and side-effect free; EditorCanvas owns the DOM and the
// pointer state machine that feeds these helpers.

export const DRAG_ACTIVATION_DISTANCE = 5
export const TRANSFORM_ACTIVATION_DISTANCE = 0.01
export const EMPTY_EDITOR_SLIDE: Slide = { id: '__mona-empty-slide__', elements: [] }

export const legacyMousePoint = (point: PointerPosition): PointerPosition => ({
  x: Math.trunc(point.x),
  y: Math.trunc(point.y),
})

export const exceedsActivationDistance = (delta: PointerPosition, threshold: number) => (
  Math.abs(delta.x) >= threshold || Math.abs(delta.y) >= threshold
)

export type GestureContext =
  | {
      kind: 'drag'
      elements: PPTElement[]
      bounds: InteractionBounds
      activationDistance: number
      activated: boolean
      duplicateActivated: boolean
      duplicateElements: PPTElement[]
      duplicateHandleElementId: string
      duplicatePreviewReady: boolean
      lastPreviewUpdates: ReadonlyMap<string, Partial<PPTElement>>
      sourceHandleElementId: string
      pendingActiveGroupElementId?: string
      pendingToggleIds?: string[]
    }
  | {
      kind: 'resize'
      elements: PPTElement[]
      bounds: InteractionBounds
      fixedRatio: boolean
      handle: ResizeHandle
      rawDelta?: PointerPosition
      scale: number
    }
  | {
      kind: 'rotate'
      elements: PPTElement[]
      center: PointerPosition
      mode: 'group' | 'single'
      rotationReference: number | null
      startAngle: number
    }
  | { kind: 'crop'; element: PPTImageElement; geometry: ImageCropGeometry; handle: CropControlHandle }
  | { kind: 'line-point'; element: PPTElement & { type: 'line' }; handle: LineControlHandle }
  | { kind: 'shape-keypoint'; element: PPTElement & { type: 'shape' }; index: number }
  | { kind: 'lasso'; lastRect?: InteractionRect }
  | { kind: 'pan'; pan: PointerPosition }
  | {
      kind: 'create'
      stageOffset: PointerPosition
      tool: EditorCreateTool
      viewportRect: { left: number; top: number }
      viewportScale: number
    }

export interface GesturePreview {
  createRect?: InteractionRect
  createLinePath?: string
  cropGeometry?: ImageCropGeometry
  duplicateElements?: PPTElement[]
  guides: AlignmentGuide[]
  lasso?: InteractionRect
  pan?: PointerPosition
  updates: ReadonlyMap<string, Partial<PPTElement>>
}

export interface CropDraft {
  readonly dirty: boolean
  readonly element: PPTImageElement
  readonly geometry: ImageCropGeometry
}

export const commitCropDraft = (runtime: EditorRuntime, draft: CropDraft | null) => {
  if (!draft?.dirty) return false
  return runtime.commit('Crop image', [{
    type: 'element.update',
    payload: {
      id: draft.element.id,
      props: commitImageCropGeometry(draft.element, draft.geometry),
    },
  }])
}

export const emptyPreview = (): GesturePreview => ({ guides: [], updates: new Map() })

export const pointerModifiers = (event: Pick<PointerEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>): PointerModifiers => ({
  alt: event.altKey,
  control: event.ctrlKey,
  meta: event.metaKey,
  shift: event.shiftKey,
})

export const applyElementUpdates = (slide: Slide, updates: ReadonlyMap<string, Partial<PPTElement>>): Slide => {
  if (!updates.size) return slide
  return {
    ...slide,
    elements: slide.elements.map(element => {
      const props = updates.get(element.id)
      return props ? { ...element, ...props } as PPTElement : element
    }),
  }
}

export const rotatePoint = (point: PointerPosition, center: PointerPosition, degrees: number): PointerPosition => {
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

export const oppositePoint = (bounds: InteractionBounds, handle: ResizeHandle): PointerPosition => ({
  x: handle.includes('left') ? bounds.maxX : handle.includes('right') ? bounds.minX : (bounds.minX + bounds.maxX) / 2,
  y: handle.startsWith('top') ? bounds.maxY : handle.startsWith('bottom') ? bounds.minY : (bounds.minY + bounds.maxY) / 2,
})

export const resizeHandlePoint = (
  bounds: InteractionBounds,
  handle: ResizeHandle,
  rotation = 0,
): PointerPosition => {
  const point = {
    x: handle.includes('left') ? bounds.minX : handle.includes('right') ? bounds.maxX : (bounds.minX + bounds.maxX) / 2,
    y: handle.startsWith('top') ? bounds.minY : handle.startsWith('bottom') ? bounds.maxY : (bounds.minY + bounds.maxY) / 2,
  }
  if (!rotation) return point
  return rotatePoint(point, {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  }, rotation)
}

export const derivePreview = (
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
  if (context.kind === 'lasso') {
    // Vue keeps the last >=5px marquee when the pointer shrinks back below
    // the threshold, and selects with it on release.
    if (Math.abs(snapshot.delta.x) < 5 || Math.abs(snapshot.delta.y) < 5) {
      return context.lastRect ? { ...emptyPreview(), lasso: context.lastRect } : emptyPreview()
    }
    const rect = normalizeRect(snapshot.origin, snapshot.pointer)
    context.lastRect = rect
    return { ...emptyPreview(), lasso: rect }
  }
  if (context.kind === 'create') {
    const end = constrainCreateGesturePoint(context.tool.type, snapshot.origin, snapshot.pointer, snapshot.modifiers)
    const absoluteRect = normalizeRect(snapshot.origin, end)
    const createRect = {
      ...absoluteRect,
      left: absoluteRect.left - context.stageOffset.x,
      top: absoluteRect.top - context.stageOffset.y,
    }
    if (context.tool.type !== 'line') return { ...emptyPreview(), createRect }
    const startX = snapshot.origin.x === absoluteRect.left ? 0 : absoluteRect.width
    const startY = snapshot.origin.y === absoluteRect.top ? 0 : absoluteRect.height
    const endX = end.x === absoluteRect.left ? 0 : absoluteRect.width
    const endY = end.y === absoluteRect.top ? 0 : absoluteRect.height
    return {
      ...emptyPreview(),
      createRect,
      createLinePath: `M${startX}, ${startY} L${endX}, ${endY}`,
    }
  }

  if (context.kind === 'drag') {
    // Vue latches drag activation: once the pointer exceeds the threshold the
    // element keeps following it, even back inside the activation zone.
    if (!context.activated) {
      if (!exceedsActivationDistance(snapshot.delta, context.activationDistance)) return emptyPreview()
      context.activated = true
    }
    const delta = snapshot.modifiers.shift ? lockDeltaToDominantAxis(snapshot.delta) : snapshot.delta
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
    return {
      duplicateElements: context.duplicateActivated
        ? context.duplicatePreviewReady
          ? materializeDuplicatePreview(context.elements, context.duplicateElements, updates)
          : context.duplicateElements
        : undefined,
      guides: snapped.guides,
      updates,
    }
  }

  if (context.kind === 'line-point') {
    return {
      ...emptyPreview(),
      updates: new Map([[context.element.id, moveLineControlPoint({
        delta: snapshot.delta,
        element: context.element,
        elements: slide.elements,
        handle: context.handle,
        preserveControlPoints: snapshot.modifiers.control || snapshot.modifiers.meta || snapshot.modifiers.shift,
        viewportRatio,
        viewportSize,
      }) as Partial<PPTElement>]]),
    }
  }

  if (context.kind === 'shape-keypoint') {
    return {
      ...emptyPreview(),
      updates: new Map([[context.element.id, moveShapeKeypoint(context.element, context.index, snapshot.delta) as Partial<PPTElement>]]),
    }
  }

  if (context.kind === 'resize') {
    const single = context.elements.length === 1 ? context.elements[0] : undefined
    if (!single) {
      const aspectRatio = (context.bounds.maxX - context.bounds.minX) /
        Math.max(context.bounds.maxY - context.bounds.minY, 1)
      const delta = { ...snapshot.delta }
      if (snapshot.modifiers.control || snapshot.modifiers.meta || snapshot.modifiers.shift) {
        if (context.handle === 'bottom-right' || context.handle === 'top-left') delta.y = delta.x / aspectRatio
        if (context.handle === 'bottom-left' || context.handle === 'top-right') delta.y = -delta.x / aspectRatio
      }
      const target = { ...context.bounds }
      if (context.handle.includes('left')) target.minX += delta.x
      if (context.handle.includes('right')) target.maxX += delta.x
      if (context.handle.startsWith('top')) target.minY += delta.y
      if (context.handle.startsWith('bottom')) target.maxY += delta.y
      return {
        guides: [],
        updates: scaleElementsIntoBounds(context.elements, context.bounds, target, {
          enforceMinimumSize: false,
          updateShapePath: false,
        }),
      }
    }
    if (single.type === 'line') return emptyPreview()
    const rotation = single.rotate
    const radians = rotation * Math.PI / 180
    const corner = context.handle.includes('-')
    const lockAspectRatio = corner && context.fixedRatio
    const aspectRatio = (context.bounds.maxX - context.bounds.minX) /
      Math.max(context.bounds.maxY - context.bounds.minY, 1)
    const ratioDirection = context.handle === 'bottom-right' || context.handle === 'top-left' ? 1 : -1
    let localDelta: { x: number; y: number } = rotation ? context.rawDelta ? {
      x: (Math.cos(radians) * context.rawDelta.x + Math.sin(radians) * context.rawDelta.y) / context.scale,
      y: (Math.cos(radians) * context.rawDelta.y - Math.sin(radians) * context.rawDelta.x) / context.scale,
    } : {
      x: Math.cos(radians) * snapshot.delta.x + Math.sin(radians) * snapshot.delta.y,
      y: Math.cos(radians) * snapshot.delta.y - Math.sin(radians) * snapshot.delta.x,
    } : { ...snapshot.delta }
    if (lockAspectRatio) localDelta = { x: localDelta.x, y: ratioDirection * localDelta.x / aspectRatio }

    const buildTarget = (delta: PointerPosition) => {
      const minimumSize = getMinimumElementSize(single)
      const minimumWidth = context.fixedRatio && aspectRatio > 1 ? minimumSize * aspectRatio : minimumSize
      const minimumHeight = context.fixedRatio && aspectRatio < 1 ? minimumSize / aspectRatio : minimumSize
      let next = resizeBounds(context.bounds, context.handle, delta, { minimumHeight, minimumWidth })
      if (rotation) {
        const originCenter = {
          x: (context.bounds.minX + context.bounds.maxX) / 2,
          y: (context.bounds.minY + context.bounds.maxY) / 2,
        }
        const targetCenter = {
          x: (next.minX + next.maxX) / 2,
          y: (next.minY + next.maxY) / 2,
        }
        const fixedOrigin = rotatePoint(oppositePoint(context.bounds, context.handle), originCenter, rotation)
        const fixedTarget = rotatePoint(oppositePoint(next, context.handle), targetCenter, rotation)
        const correction = { x: fixedOrigin.x - fixedTarget.x, y: fixedOrigin.y - fixedTarget.y }
        next = {
          minX: next.minX + correction.x,
          maxX: next.maxX + correction.x,
          minY: next.minY + correction.y,
          maxY: next.maxY + correction.y,
        }
      }
      return next
    }

    const sourceSingleSize = (delta: PointerPosition) => {
      const minimumSize = getMinimumElementSize(single)
      const minimumWidth = context.fixedRatio && aspectRatio > 1 ? minimumSize * aspectRatio : minimumSize
      const minimumHeight = context.fixedRatio && aspectRatio < 1 ? minimumSize / aspectRatio : minimumSize
      const width = context.handle.includes('left')
        ? single.width - delta.x
        : context.handle.includes('right') ? single.width + delta.x : single.width
      const height = context.handle.startsWith('top')
        ? single.height - delta.y
        : context.handle.startsWith('bottom') ? single.height + delta.y : single.height
      return { width: Math.max(minimumWidth, width), height: Math.max(minimumHeight, height) }
    }

    let target = buildTarget(localDelta)
    let guides: AlignmentGuide[] = []
    if (!rotation || corner) {
      const candidates = buildResizeSnapCandidates(
        slide.elements,
        new Set(context.elements.map(element => element.id)),
        viewportSize,
        viewportRatio,
      )
      // Vue snaps the raw (unclamped) virtual handle position in the
      // non-rotated branch, so snapping still engages while the element is
      // pinned at its minimum size; the rotated branch uses the corrected
      // geometry on both sides.
      let handlerPoint = resizeHandlePoint(target, context.handle, rotation)
      if (!rotation) {
        const originPoint = resizeHandlePoint(context.bounds, context.handle)
        handlerPoint = {
          x: originPoint.x + (context.handle.includes('left') || context.handle.includes('right') ? localDelta.x : 0),
          y: originPoint.y + (context.handle.startsWith('top') || context.handle.startsWith('bottom') ? localDelta.y : 0),
        }
      }
      const snapped = snapResizePoint({
        horizontalCandidates: candidates.horizontal,
        point: {
          x: rotation || context.handle.includes('left') || context.handle.includes('right') ? handlerPoint.x : null,
          y: rotation || context.handle.startsWith('top') || context.handle.startsWith('bottom') ? handlerPoint.y : null,
        },
        verticalCandidates: candidates.vertical,
      })
      guides = snapped.guides
      if (snapped.correction.x || snapped.correction.y) {
        if (rotation) {
          if (lockAspectRatio) {
            const vectorX = Math.cos(radians) - Math.sin(radians) * ratioDirection / aspectRatio
            const vectorY = Math.sin(radians) + Math.cos(radians) * ratioDirection / aspectRatio
            if (snapped.correction.y && vectorY) localDelta.x += snapped.correction.y / vectorY
            else if (snapped.correction.x && vectorX) localDelta.x += snapped.correction.x / vectorX
            localDelta.y = ratioDirection * localDelta.x / aspectRatio
          }
          else {
            localDelta = {
              x: localDelta.x + Math.cos(radians) * snapped.correction.x + Math.sin(radians) * snapped.correction.y,
              y: localDelta.y + Math.cos(radians) * snapped.correction.y - Math.sin(radians) * snapped.correction.x,
            }
          }
        }
        else {
          localDelta = {
            x: localDelta.x + snapped.correction.x,
            y: localDelta.y + snapped.correction.y,
          }
          if (lockAspectRatio) {
            if (snapped.correction.y) localDelta.x = localDelta.y * aspectRatio * ratioDirection
            else localDelta.y = ratioDirection * localDelta.x / aspectRatio
          }
        }
        target = buildTarget(localDelta)
      }
    }
    return {
      guides,
      updates: scaleElementsIntoBounds(context.elements, context.bounds, target, { singleSize: sourceSingleSize(localDelta) }),
    }
  }

  if (context.kind === 'rotate') {
    const angle = angleFromPoint(context.center, snapshot.pointer)
    if (context.mode === 'single') {
      // Vue writes the snapped absolute angle directly. Going through a
      // normalized delta would collapse -180 to +180 in persisted state.
      return {
        ...emptyPreview(),
        updates: new Map([[context.elements[0]!.id, { rotate: snapAngle(angle) } as Partial<PPTElement>]]),
      }
    }
    let delta = normalizeAngle(angle - context.startAngle)
    if (context.rotationReference !== null) {
      const target = normalizeAngle(context.rotationReference + delta)
      delta = normalizeAngle(snapAngle(target) - context.rotationReference)
    }
    return { ...emptyPreview(), updates: rotateElementsAround(context.elements, context.center, delta) }
  }

  return {
    ...emptyPreview(),
    cropGeometry: updateImageCropGeometry({
      delta: snapshot.delta,
      element: context.element,
      geometry: context.geometry,
      handle: context.handle,
      lockAspectRatio: snapshot.modifiers.control || snapshot.modifiers.meta || snapshot.modifiers.shift,
    }),
  }
}

export const toCommands = (updates: ReadonlyMap<string, Partial<PPTElement>>): PresentationCommand[] => (
  [...updates.entries()].map(([id, props]) => ({
    type: 'element.update',
    payload: { id, props },
  }))
)

export const isTextInput = (target: EventTarget | null) => {
  const element = target as HTMLElement | null
  return element?.isContentEditable || element?.tagName === 'INPUT' || element?.tagName === 'TEXTAREA' || element?.tagName === 'SELECT'
}

export const duplicatePreviewElements = (
  source: readonly PPTElement[],
  detachFromGroup = false,
): PPTElement[] => {
  const groupIds = new Map<string, string>()
  const duplicates = copyElementTreeWithPowerPointOrigins(
    source,
    createPresentationId,
    'copy',
  ).elements
  for (const element of flattenElementTree(duplicates)) {
    if (element.groupId && !groupIds.has(element.groupId)) groupIds.set(element.groupId, createPresentationId())
  }
  for (const element of flattenElementTree(duplicates)) {
    element.groupId = detachFromGroup ? undefined : element.groupId ? groupIds.get(element.groupId) : undefined
  }
  return duplicates
}

export const materializeDuplicatePreview = (
  source: readonly PPTElement[],
  duplicates: readonly PPTElement[],
  updates: ReadonlyMap<string, Partial<PPTElement>>,
): PPTElement[] => duplicates.map((duplicate, index) => ({
  ...duplicate,
  ...updates.get(source[index]!.id),
}) as PPTElement)

export const createElementFromGesture = (
  tool: EditorCreateTool,
  selection: CreateGestureSelection,
  viewportRect: { left: number; top: number },
  scale: number,
  theme: SlideTheme,
): PPTElement => {
  const minX = Math.min(selection.start.x, selection.end.x)
  const minY = Math.min(selection.start.y, selection.end.y)
  const width = Math.abs(selection.end.x - selection.start.x) / scale
  const height = Math.abs(selection.end.y - selection.start.y) / scale
  const left = (minX - viewportRect.left) / scale
  const top = (minY - viewportRect.top) / scale
  const themeColor = theme.themeColors[0] ?? '#d14424'
  if (tool.type === 'line') {
    const element: PPTLineElement = {
      id: createPresentationId(),
      type: 'line',
      left,
      top,
      width: 2,
      start: [selection.start.x === minX ? 0 : width, selection.start.y === minY ? 0 : height],
      end: [selection.end.x === minX ? 0 : width, selection.end.y === minY ? 0 : height],
      style: tool.data.style,
      color: themeColor,
      points: tool.data.points,
    }
    const midpoint: [number, number] = [(element.start[0] + element.end[0]) / 2, (element.start[1] + element.end[1]) / 2]
    if (tool.data.isBroken) element.broken = midpoint
    if (tool.data.isBroken2) element.broken2 = midpoint
    if (tool.data.isCurve) element.curve = midpoint
    if (tool.data.isCubic) element.cubic = [midpoint, midpoint]
    return element
  }
  if (tool.type === 'text') {
    return {
      id: createPresentationId(),
      type: 'text',
      left,
      top,
      width,
      // The source ProseMirror mounts an empty paragraph immediately; its
      // ResizeObserver replaces the drawn auto-height with 24px line height
      // plus the default 10px top and bottom insets for horizontal text. A
      // vertical editor auto-sizes its width instead and preserves the drawn
      // height.
      height: tool.vertical ? height : 44,
      rotate: 0,
      content: '',
      defaultFontName: theme.fontName,
      defaultColor: theme.fontColor,
      vertical: tool.vertical,
    }
  }
  const shape: PPTShapeElement = {
    id: createPresentationId(),
    type: 'shape',
    left,
    top,
    width,
    height,
    rotate: 0,
    fixedRatio: false,
    viewBox: tool.data.viewBox,
    path: tool.data.path,
    fill: themeColor,
  }
  if (tool.data.withborder) shape.outline = structuredClone(theme.outline)
  if (tool.data.special) shape.special = true
  if (tool.data.pathFormula) {
    shape.pathFormula = tool.data.pathFormula
    shape.viewBox = [width, height]
    const formula = SHAPE_PATH_FORMULAS[tool.data.pathFormula]
    if (formula.editable) {
      shape.path = formula.formula(width, height, formula.defaultValue)
      shape.keypoints = formula.defaultValue
    }
    else shape.path = formula.formula(width, height)
  }
  return shape
}
