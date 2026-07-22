/* oxlint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- The slide canvas is an intentional composite application surface with managed keyboard interaction. */

import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { useTranslation } from 'react-i18next'
import tinycolor from 'tinycolor2'

import type { InteractionSnapshot, PointerModifiers, PointerPosition } from '@mona/editor-interactions'
import {
  angleFromPoint,
  clientPointToSlide,
  lockDeltaToDominantAxis,
  normalizeRect,
  rectToBounds,
  resizeBounds,
  snapAngle,
  snapMove,
  type AlignmentGuide,
  type InteractionBounds,
  type InteractionRect,
  type ResizeHandle,
} from '@mona/editor-interactions/geometry'
import {
  editorActions,
  selectActiveElementIds,
  selectSession,
  selectCanvasFocus,
  selectCanvasPan,
  selectCanvasZoom,
  selectCropElementId,
  selectCurrentSlide,
  selectGridLineSize,
  selectPresentation,
  selectShowRuler,
} from '@mona/editor-state'
import { createPresentationId, LINE_LIST, selectFormattedCurrentSlideAnimations, SHAPE_LIST, SHAPE_PATH_FORMULAS, type PresentationCommand } from '@mona/presentation-core'
import type { ElementLinkType, PPTElement, PPTImageElement, PPTLineElement, PPTShapeElement, PPTTableElement, PPTTextElement, Slide, SlideTheme } from '@mona/presentation-core/model'

import { EditorContextMenu, EditorNoticeStack, LinkEditor } from '@/features/editor/EditorContextMenu'
import { EditorRichText } from '@/features/editor/EditorRichText'
import { EditorImageCropEditor, EditorSelectionOverlay } from '@/features/editor/EditorSelectionOverlay'
import { EditorFloatingLinkHandler } from '@/features/editor/EditorFloatingLinkHandler'
import { EditorFloatingTextToolbar } from '@/features/editor/EditorFloatingTextToolbar'
import { EditorFloatingElementToolbar } from '@/features/editor/EditorFloatingElementToolbar'
import { EditorFloatingImageToolbar } from '@/features/editor/EditorFloatingImageToolbar'
import { EditorFloatingTableToolbar } from '@/features/editor/EditorFloatingTableToolbar'
import { EditorFloatingChartToolbar } from '@/features/editor/EditorFloatingChartToolbar'
import { EditorFloatingLatexToolbar } from '@/features/editor/EditorFloatingLatexToolbar'
import { EditorCustomShapeCreator } from '@/features/editor/EditorCustomShapeCreator'
import type { EditorCreateTool } from '@/features/editor/editor-create-tool'
import { parseCustomEditorClipboard } from '@/features/editor/editor-clipboard'
import {
  canDeleteTableAxis,
  deleteTableColumn,
  deleteTableRow,
  insertTableColumn,
  insertTableRow,
  mergeTableCells,
  splitTableCell,
  tableCellKey,
} from '@/features/editor/editor-table'
import {
  MONA_CLIPBOARD_MIME,
  type EditorRuntime,
} from '@/features/editor/editor-runtime'
import {
  alignElementsToCanvasLikePptist,
  buildSnapCandidates,
  buildResizeSnapCandidates,
  buildEditorGridPath,
  canResizeSelection,
  constrainCreateGesturePoint,
  commitImageCropGeometry,
  getElementBounds,
  getElementsBounds,
  getImageCropGeometry,
  getGroupRotationCenter,
  getGroupRotationReference,
  getLassoSelectionIds,
  getMinimumElementSize,
  groupElementsLikePptist,
  getTransformBounds,
  moveLineControlPoint,
  moveShapeKeypoint,
  normalizeAngle,
  orderElementLikePptist,
  rotateElementsAround,
  resolveCreateGestureSelection,
  scaleElementsIntoBounds,
  setElementLocksLikePptist,
  snapResizePoint,
  ungroupElementsLikePptist,
  updateImageCropGeometry,
  type CropControlHandle,
  type CreateGestureSelection,
  type ImageCropGeometry,
  type LineControlHandle,
} from '@/features/editor/editor-geometry'
import { navigateWithSlideTransition } from '@/features/editor/editor-view-transition'
import { useEditorSelector } from '@/features/editor/use-editor-selector'
import { SlideRenderer } from '@/features/presentation-renderer/SlideRenderer'

const DRAG_ACTIVATION_DISTANCE = 5
const TRANSFORM_ACTIVATION_DISTANCE = 0.01
const EMPTY_EDITOR_SLIDE: Slide = { id: '__mona-empty-slide__', elements: [] }
const MEDIA_EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  'audio/aac': 'aac',
  'audio/flac': 'flac',
  'audio/midi': 'mid',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'oga',
  'audio/wav': 'wav',
  'audio/webm': 'weba',
  'audio/x-aiff': 'aif',
  'audio/x-ms-wma': 'wma',
  'video/3gpp': '3gp',
  'video/3gpp2': '3g2',
  'video/mp4': 'mp4',
  'video/mpeg': 'mpeg',
  'video/ogg': 'ogv',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/x-flv': 'flv',
  'video/x-ms-wmv': 'wmv',
  'video/x-msvideo': 'avi',
}

const parseTextToParagraphs = (text: string) => text
  .replace(/[\n\r]+/g, '<br>')
  .split('<br>')
  .filter(Boolean)
  .map(paragraph => `<div>${paragraph}</div>`)
  .join('')

const isPptistValidUrl = (text: string) => /^(https?:\/\/)([\w-]+\.)+[\w-]{2,}(\/[\w-./?%&=]*)?$/i.test(text)
const isPptistImageUrl = (text: string) => (
  /^https?:\/\/(?:[a-zA-Z0-9-]+\.)*pexels\.com\/[^\s]+\.(?:jpg|jpeg|png|svg|webp)(?:\?.*)?$/i.test(text) ||
  /^https?:\/\/(?:[a-zA-Z0-9-]+\.)*pptist\.cn\/[^\s]+\.(?:jpg|jpeg|png|svg|webp)(?:\?.*)?$/i.test(text)
)
const isSvgText = (text: string) => {
  if (!/<svg[\s\S]*?>[\s\S]*?<\/svg>/i.test(text)) return false
  try {
    return new DOMParser().parseFromString(text, 'image/svg+xml').documentElement.nodeName === 'svg'
  }
  catch {
    return false
  }
}

const fileAsDataUrl = (file: File) => new Promise<string>(resolve => {
  const reader = new FileReader()
  reader.addEventListener('load', () => resolve(reader.result as string), { once: true })
  reader.readAsDataURL(file)
})

const imageSize = (src: string) => new Promise<{ height: number; width: number }>((resolve, reject) => {
  const image = new Image()
  image.style.opacity = '0'
  image.addEventListener('load', () => {
    const size = { height: image.clientHeight || image.naturalHeight, width: image.clientWidth || image.naturalWidth }
    image.remove()
    resolve(size)
  }, { once: true })
  image.addEventListener('error', () => {
    image.remove()
    reject(new Error('Image failed to load'))
  }, { once: true })
  document.body.append(image)
  image.src = src
})

const legacyMousePoint = (point: PointerPosition): PointerPosition => ({
  x: Math.trunc(point.x),
  y: Math.trunc(point.y),
})

const exceedsActivationDistance = (delta: PointerPosition, threshold: number) => (
  Math.abs(delta.x) >= threshold || Math.abs(delta.y) >= threshold
)

type GestureContext =
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

interface GesturePreview {
  createRect?: InteractionRect
  createLinePath?: string
  cropGeometry?: ImageCropGeometry
  duplicateElements?: PPTElement[]
  guides: AlignmentGuide[]
  lasso?: InteractionRect
  pan?: PointerPosition
  updates: ReadonlyMap<string, Partial<PPTElement>>
}

interface ContextMenuState {
  readonly cell?: { column: number; row: number }
  readonly elementId?: string
  readonly position: PointerPosition
  readonly surface: 'canvas' | 'element' | 'table-cell'
}

interface LinkEditorState {
  readonly elementId: string
  readonly type: ElementLinkType
  readonly address: string
  readonly slideId: string
}

interface EditorNoticeState {
  readonly duration?: number
  readonly id: number
  readonly text: string
  readonly type: 'error' | 'success' | 'warning'
}

interface CropDraft {
  readonly dirty: boolean
  readonly element: PPTImageElement
  readonly geometry: ImageCropGeometry
}

const commitCropDraft = (runtime: EditorRuntime, draft: CropDraft | null) => {
  if (!draft?.dirty) return false
  return runtime.commit('Crop image', [{
    type: 'element.update',
    payload: {
      id: draft.element.id,
      props: commitImageCropGeometry(draft.element, draft.geometry),
    },
  }])
}

const emptyPreview = (): GesturePreview => ({ guides: [], updates: new Map() })

const pointerModifiers = (event: Pick<PointerEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>): PointerModifiers => ({
  alt: event.altKey,
  control: event.ctrlKey,
  meta: event.metaKey,
  shift: event.shiftKey,
})

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

const resizeHandlePoint = (
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
  detachFromGroup = false,
): PPTElement[] => {
  const groupIds = new Map<string, string>()
  return structuredClone(source).map(element => {
    if (element.groupId && !groupIds.has(element.groupId)) groupIds.set(element.groupId, createPresentationId())
    return {
      ...element,
      id: createPresentationId(),
      groupId: detachFromGroup ? undefined : element.groupId ? groupIds.get(element.groupId) : undefined,
    } as PPTElement
  })
}

const materializeDuplicatePreview = (
  source: readonly PPTElement[],
  duplicates: readonly PPTElement[],
  updates: ReadonlyMap<string, Partial<PPTElement>>,
): PPTElement[] => duplicates.map((duplicate, index) => ({
  ...duplicate,
  ...updates.get(source[index]!.id),
}) as PPTElement)

const createElementFromGesture = (
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

function EditorRulers({ frameHeight, frameWidth, height, pan, scale, selection, width }: {
  frameHeight: number
  frameWidth: number
  height: number
  pan: PointerPosition
  scale: number
  selection?: InteractionBounds
  width: number
}) {
  const markers = Array.from({ length: 20 }, (_, index) => index + 1)
  const markerSize = 100 * scale
  const markerClassName = `mona-ruler-marker-100${markerSize < 36 ? ' hide' : ''}${markerSize < 72 ? ' omit' : ''}`
  return (
    <div aria-hidden="true" className="mona-editor-rulers">
      <div
        className="mona-editor-ruler is-horizontal"
        style={{
          left: `calc(50% - ${frameWidth / 2}px + ${pan.x}px)`,
          width: frameWidth,
        }}
      >
        {markers.map(marker => (
          <div className={markerClassName} key={`h-marker-100-${marker}`} style={{ width: markerSize }}>
            {marker * 100 <= width ? <span>{marker * 100}</span> : null}
          </div>
        ))}
        {selection ? (
          <i
            className="mona-ruler-range"
            style={{ left: selection.minX * scale, width: (selection.maxX - selection.minX) * scale }}
          />
        ) : null}
      </div>
      <div
        className="mona-editor-ruler is-vertical"
        style={{
          height: frameHeight,
          top: `calc(50% - ${frameHeight / 2}px + ${pan.y}px)`,
        }}
      >
        {markers.map(marker => (
          <div className={markerClassName} key={`v-marker-100-${marker}`} style={{ height: markerSize }}>
            {marker * 100 <= height ? <span>{marker * 100}</span> : null}
          </div>
        ))}
        {selection ? (
          <i
            className="mona-ruler-range"
            style={{ height: (selection.maxY - selection.minY) * scale, top: selection.minY * scale }}
          />
        ) : null}
      </div>
    </div>
  )
}

export function EditorCanvas({ activeCreateTool, customShapeActive, interactionProfile = 'desktop', onCreateToolChange, onCustomShapeChange, onEditChart, onEditLatex, runtime }: {
  activeCreateTool: EditorCreateTool | null
  customShapeActive: boolean
  interactionProfile?: 'desktop' | 'mobile'
  onCreateToolChange: (tool: EditorCreateTool | null) => void
  onCustomShapeChange: (active: boolean) => void
  onEditChart: (elementId: string) => void
  onEditLatex: (elementId: string) => void
  runtime: EditorRuntime
}) {
  const { t } = useTranslation()
  const presentation = useEditorSelector(runtime.store, selectPresentation)
  const selectedCurrentSlide = useEditorSelector(runtime.store, selectCurrentSlide)
  const currentSlide = selectedCurrentSlide ?? EMPTY_EDITOR_SLIDE
  const activeElementIds = useEditorSelector(runtime.store, selectActiveElementIds)
  const session = useEditorSelector(runtime.store, selectSession)
  const canvasFocus = useEditorSelector(runtime.store, selectCanvasFocus)
  const canvasPan = useEditorSelector(runtime.store, selectCanvasPan)
  const canvasZoom = useEditorSelector(runtime.store, selectCanvasZoom)
  const cropElementId = useEditorSelector(runtime.store, selectCropElementId)
  const gridLineSize = useEditorSelector(runtime.store, selectGridLineSize)
  const showRuler = useEditorSelector(runtime.store, selectShowRuler)
  const mobileInteraction = interactionProfile === 'mobile'
  const activeTool = activeCreateTool
  const interaction = useSyncExternalStore(
    runtime.interaction.subscribe,
    runtime.interaction.getSnapshot,
    runtime.interaction.getSnapshot,
  )
  const stageRef = useRef<HTMLElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const gestureRef = useRef<GestureContext | null>(null)
  const cropDraftRef = useRef<CropDraft | null>(null)
  const noticeIdRef = useRef(0)
  const ctrlOrMetaPressedRef = useRef(false)
  const shiftPressedRef = useRef(false)
  const spacePressedRef = useRef(false)
  const lastSlideWheelAtRef = useRef(Number.NEGATIVE_INFINITY)
  const lastZoomWheelAtRef = useRef(Number.NEGATIVE_INFINITY)
  // PPTist throttles undo/redo (100ms, leading) so key auto-repeat cannot
  // burn through the snapshot stack.
  const lastUndoAtRef = useRef(Number.NEGATIVE_INFINITY)
  const lastRedoAtRef = useRef(Number.NEGATIVE_INFINITY)
  const [gestureContext, setGestureContext] = useState<GestureContext | null>(null)
  const [viewportFit, setViewportFit] = useState({ denominator: 1, dimension: 0, height: 0, width: 0 })
  const [isSpacePressed, setIsSpacePressed] = useState(false)
  const [shapeTextEditorId, setShapeTextEditorId] = useState<string | null>(null)
  const [tableEditorId, setTableEditorIdState] = useState<string | null>(null)
  const tableEditorIdRef = useRef<string | null>(null)
  const setTableEditorId = (elementId: string | null) => {
    tableEditorIdRef.current = elementId
    setTableEditorIdState(elementId)
  }
  const [cropDraft, setCropDraft] = useState<CropDraft | null>(null)
  const [linkEditor, setLinkEditor] = useState<LinkEditorState | null>(null)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [notices, setNotices] = useState<EditorNoticeState[]>([])

  useEffect(() => {
    const handleNotice = (event: Event) => {
      const detail = (event as CustomEvent<Omit<EditorNoticeState, 'id'> | null>).detail
      setNotices(current => detail ? [...current, { id: ++noticeIdRef.current, ...detail }] : [])
    }
    window.addEventListener('mona:notice', handleNotice)
    return () => window.removeEventListener('mona:notice', handleNotice)
  }, [])

  useEffect(() => {
    if (!customShapeActive) return undefined
    const id = ++noticeIdRef.current
    setNotices(current => [...current, {
      duration: 0,
      id,
      text: t('foundation.editor.drawShapeTip'),
      type: 'success',
    }])
    return () => setNotices(current => current.filter(notice => notice.id !== id))
  }, [customShapeActive, t])

  useEffect(() => runtime.store.subscribe(() => {
    const liveSession = selectSession(runtime.store.getState())
    const handleElementId = liveSession.handleElementId
    setShapeTextEditorId(current => current && current !== handleElementId ? null : current)
    const currentTableEditorId = tableEditorIdRef.current
    if (!currentTableEditorId || currentTableEditorId === handleElementId) return
    setTableEditorId(null)
    if (liveSession.disableHotkeys) runtime.store.dispatch(editorActions.hotkeysDisabledChanged(false))
  }), [runtime])

  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) return undefined
    const update = () => {
      const rect = stage.getBoundingClientRect()
      const widthConstrained = rect.height / rect.width > presentation.viewportRatio
      setViewportFit(widthConstrained
        ? { denominator: presentation.viewportSize, dimension: Math.max(1, rect.width), height: rect.height, width: rect.width }
        : {
          denominator: presentation.viewportSize * presentation.viewportRatio,
          dimension: Math.max(1, rect.height),
          height: rect.height,
          width: rect.width,
        })
      // The source ResizeObserver always re-centers the viewport, including a
      // viewport that had previously been dragged.
      runtime.store.dispatch(editorActions.canvasPanChanged({ x: 0, y: 0 }))
    }
    update()
    let resizeFrame = 0
    if (interactionProfile === 'mobile') {
      const observer = new ResizeObserver(() => {
        if (resizeFrame) return
        resizeFrame = requestAnimationFrame(() => {
          resizeFrame = 0
          const rect = stage.getBoundingClientRect()
          setViewportFit(current => ({ ...current, height: rect.height, width: rect.width }))
        })
      })
      observer.observe(stage)
      return () => {
        if (resizeFrame) cancelAnimationFrame(resizeFrame)
        observer.disconnect()
      }
    }
    const observer = new ResizeObserver(() => {
      if (resizeFrame) return
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0
        update()
      })
    })
    observer.observe(stage)
    return () => {
      if (resizeFrame) cancelAnimationFrame(resizeFrame)
      observer.disconnect()
    }
  }, [interactionProfile, presentation.viewportRatio, presentation.viewportSize, runtime])

  useEffect(() => {
    const resetModifierState = () => {
      ctrlOrMetaPressedRef.current = false
      shiftPressedRef.current = false
      spacePressedRef.current = false
      setIsSpacePressed(false)
    }
    const handleDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey) ctrlOrMetaPressedRef.current = true
      if (event.shiftKey) shiftPressedRef.current = true
      if (
        event.key === ' ' &&
        !isTextInput(event.target) &&
        !selectSession(runtime.store.getState()).disableHotkeys
      ) {
        spacePressedRef.current = true
        setIsSpacePressed(true)
      }
      // PPTist handles Ctrl/Meta+P, F5/Shift+F5, and Ctrl+F before the
      // disableHotkeys guard, so they also work while a text editor has focus.
      if ((event.ctrlKey || event.metaKey) && event.key.toUpperCase() === 'P') {
        event.preventDefault()
        window.dispatchEvent(new CustomEvent('mona:export-request', { detail: { type: 'pdf' } }))
        return
      }
      if (event.key === 'F5') {
        event.preventDefault()
        window.dispatchEvent(new CustomEvent('mona:screening-request', { detail: { fromStart: !event.shiftKey } }))
        return
      }
      if (event.ctrlKey && event.key.toUpperCase() === 'F') {
        event.preventDefault()
        runtime.store.dispatch(editorActions.panelToggled('search'))
        return
      }
      // PPTist deliberately reserves only Control (not Command/Meta) for its
      // keyboard zoom shortcuts. Wheel zoom follows the shared modifier state.
      if (!event.ctrlKey) return
      const zoom = selectCanvasZoom(runtime.store.getState())
      if (event.key === '-' && zoom >= 30) {
        event.preventDefault()
        runtime.store.dispatch(editorActions.canvasZoomChanged(zoom - 5))
      }
      else if (event.key === '=' && zoom <= 200) {
        event.preventDefault()
        runtime.store.dispatch(editorActions.canvasZoomChanged(zoom + 5))
      }
      else if (event.key === '0') {
        event.preventDefault()
        runtime.store.dispatch(editorActions.canvasZoomChanged(90))
        runtime.store.dispatch(editorActions.canvasPanChanged({ x: 0, y: 0 }))
        runtime.store.dispatch(editorActions.canvasDraggedChanged(false))
      }
    }
    document.addEventListener('keydown', handleDocumentKeyDown)
    document.addEventListener('keyup', resetModifierState)
    window.addEventListener('blur', resetModifierState)
    return () => {
      document.removeEventListener('keydown', handleDocumentKeyDown)
      document.removeEventListener('keyup', resetModifierState)
      window.removeEventListener('blur', resetModifierState)
    }
  }, [runtime])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const textElements = new Map(currentSlide.elements
      .filter(element => element.type === 'text' && !element.fixedHeight)
      .map(element => [element.id, element]))
    if (!textElements.size) return undefined

    const pendingMeasurements = new Map<string, { measured: number; property: 'height' | 'width' }>()
    let measurementFrame = 0
    const flushMeasurements = () => {
      measurementFrame = 0
      const stateSlide = selectCurrentSlide(runtime.store.getState())
      if (!stateSlide || stateSlide.id !== currentSlide.id) {
        pendingMeasurements.clear()
        return
      }
      const commands: PresentationCommand[] = []
      for (const [elementId, { measured, property }] of pendingMeasurements) {
        const current = stateSlide.elements.find(element => element.id === elementId && element.type === 'text')
        if (!current || current.type !== 'text' || current[property] === measured) continue
        commands.push({
          type: 'element.update',
          payload: { id: current.id, props: { [property]: measured } },
        })
      }
      pendingMeasurements.clear()
      if (commands.length) runtime.commit('Measure text elements', commands, { recordHistory: false })
    }
    const observer = new ResizeObserver(entries => {
      // PPTist defers auto-size writes while a resize is active, then applies
      // the measured dimension at pointer-up. finishGesture owns that branch.
      if (gestureRef.current?.kind === 'resize') return
      const stateSlide = selectCurrentSlide(runtime.store.getState())
      if (!stateSlide || stateSlide.id !== currentSlide.id) return
      for (const entry of entries) {
        const content = entry.target as HTMLElement
        const elementRoot = content.closest<HTMLElement>('[data-element-id]')
        const elementId = elementRoot?.dataset.elementId
        const source = elementId ? textElements.get(elementId) : undefined
        const current = elementId
          ? stateSlide.elements.find(element => element.id === elementId && element.type === 'text')
          : undefined
        if (!source || !current || current.type !== 'text') continue
        // Match PPTist's two settling paths exactly. Without an explicit
        // inset, its ResizeObserver persists the fractional content box plus
        // the default inset (for example 86.5). With an explicit inset, that
        // observer update also re-triggers PPTist's inset watcher, whose final
        // write is the rounded DOM offset dimension (for example 23.2 -> 23).
        const inset = current.inset || [10, 10, 10, 10]
        const measured = current.inset
          ? current.vertical ? content.offsetWidth : content.offsetHeight
          : current.vertical
            ? entry.contentRect.width + inset[1] + inset[3]
            : entry.contentRect.height + inset[0] + inset[2]
        const property = current.vertical ? 'width' : 'height'
        if (current[property] === measured) continue
        pendingMeasurements.set(current.id, { measured, property })
      }
      if (pendingMeasurements.size && !measurementFrame) measurementFrame = requestAnimationFrame(flushMeasurements)
    })
    for (const elementId of textElements.keys()) {
      const content = canvas.querySelector<HTMLElement>(
        `[data-element-id="${CSS.escape(elementId)}"] .mona-text-content`,
      )
      if (content) observer.observe(content)
    }
    return () => {
      if (measurementFrame) cancelAnimationFrame(measurementFrame)
      pendingMeasurements.clear()
      observer.disconnect()
    }
  }, [currentSlide, runtime])

  useEffect(() => {
    if (!menu) return undefined
    const close = () => setMenu(null)
    document.body.addEventListener('scroll', close)
    window.addEventListener('resize', close)
    return () => {
      document.body.removeEventListener('scroll', close)
      window.removeEventListener('resize', close)
    }
  }, [menu])

  useEffect(() => {
    if (!cropElementId) return undefined
    const finishWhenClickingOutside = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('.mona-image-crop-editor')) return
      commitCropDraft(runtime, cropDraftRef.current)
      cropDraftRef.current = null
      setCropDraft(null)
      runtime.store.dispatch(editorActions.cropElementChanged(null))
    }
    document.addEventListener('pointerdown', finishWhenClickingOutside, true)
    return () => document.removeEventListener('pointerdown', finishWhenClickingOutside, true)
  }, [cropElementId, runtime])

  const scale = viewportFit.dimension * (canvasZoom / 100) / viewportFit.denominator
  const preview = derivePreview(gestureContext, interaction, currentSlide, presentation.viewportSize, presentation.viewportRatio)
  const previewSlide = preview.duplicateElements
    ? (() => {
      const replacements = new Map(preview.duplicateElements.map(element => [element.id, element]))
      return {
        ...currentSlide,
        elements: currentSlide.elements.map(element => replacements.get(element.id) ?? element),
      }
    })()
    : applyElementUpdates(currentSlide, preview.updates)
  const selectedElements = previewSlide.elements.filter(element => activeElementIds.includes(element.id))
  const activeGroupElement = session.activeGroupElementId
    ? selectedElements.find(element => element.id === session.activeGroupElementId)
    : undefined
  const transformElements = activeGroupElement ? [activeGroupElement] : selectedElements
  const selectionBounds = selectedElements.length ? getElementsBounds(selectedElements) : undefined
  const menuElement = menu?.elementId ? previewSlide.elements.find(element => element.id === menu.elementId) : undefined
  const pan = preview.pan ?? canvasPan
  const cropSourceImage = cropElementId
    ? previewSlide.elements.find((element): element is PPTImageElement => element.id === cropElementId && element.type === 'image')
    : undefined
  const cropGeometry = preview.cropGeometry ?? (
    cropDraft?.element.id === cropElementId
      ? cropDraft.geometry
      : cropSourceImage ? getImageCropGeometry(cropSourceImage) : undefined
  )
  const renderedSlide = {
    ...previewSlide,
    elements: previewSlide.elements.filter(element => (
      !session.hiddenElementIds.includes(element.id) && element.id !== cropElementId
    )),
  }

  const inputPoint = (event: Pick<PointerEvent, 'clientX' | 'clientY'>): PointerPosition => (
    mobileInteraction
      ? { x: event.clientX, y: event.clientY }
      : legacyMousePoint({ x: event.clientX, y: event.clientY })
  )

  const slidePoint = (event: Pick<PointerEvent, 'clientX' | 'clientY'>) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect || !scale) return undefined
    // PPTist's document-level MouseEvent handlers consume integer client/page
    // coordinates. PointerEvent retains sub-pixel coordinates, and preserving
    // those here changes not only the final fraction but source branches at
    // the strict 5px adsorption boundary. Quantize before converting to slide
    // space so every mouse-driven transform follows the same input contract.
    return clientPointToSlide(inputPoint(event), rect, scale)
  }

  const rawGestureOriginRef = useRef<PointerPosition | null>(null)

  const begin = (
    event: ReactPointerEvent<HTMLElement>,
    kind: InteractionSnapshot['kind'] & {},
    point: PointerPosition,
    context: GestureContext,
  ) => {
    rawGestureOriginRef.current = inputPoint(event.nativeEvent)
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

  const updateCropDraft = (draft: CropDraft | null) => {
    cropDraftRef.current = draft
    setCropDraft(draft)
  }

  const finishCropEditing = (commit: boolean) => {
    const draft = cropDraftRef.current
    if (commit) commitCropDraft(runtime, draft)
    updateCropDraft(null)
    runtime.store.dispatch(editorActions.cropElementChanged(null))
  }

  const selectElement = (event: Pick<MouseEvent, 'ctrlKey' | 'metaKey' | 'shiftKey'>, element: PPTElement) => {
    const liveState = runtime.store.getState()
    const liveSession = selectSession(liveState)
    const liveSlide = selectCurrentSlide(liveState) ?? EMPTY_EDITOR_SLIDE
    const liveElement = liveSlide.elements.find(item => item.id === element.id) ?? element
    const liveActiveElementIds = liveSession.activeElementIds
    if (liveSession.cropElementId) finishCropEditing(true)
    const modifier = event.ctrlKey || event.metaKey || event.shiftKey
    const groupMemberIds = !mobileInteraction && liveElement.groupId
      ? liveSlide.elements.filter(item => item.groupId === liveElement.groupId).map(item => item.id)
      : [liveElement.id]
    // PPTist seeds a grouped selection with the element that was actually
    // clicked, then appends the group's slide-order members and de-duplicates.
    // Selection order is observable in group operations and toolbar state.
    const groupIds = [...new Set([liveElement.id, ...groupMemberIds])]
    let next = liveActiveElementIds
    if (!liveActiveElementIds.includes(liveElement.id)) next = modifier ? [...new Set([...liveActiveElementIds, ...groupIds])] : groupIds
    else if (modifier) {
      const removed = new Set(groupIds)
      const candidate = liveActiveElementIds.filter(id => !removed.has(id))
      if (candidate.length) next = candidate
    }
    runtime.store.dispatch(editorActions.selectionChanged(next))
    runtime.store.dispatch(editorActions.handleElementChanged(liveElement.id))
    runtime.store.dispatch(editorActions.activeGroupElementChanged(null))
    return next
  }

  const handleElementPointerDown = (event: ReactPointerEvent<HTMLElement>, element: PPTElement) => {
    const liveState = runtime.store.getState()
    const liveSession = selectSession(liveState)
    const liveSlide = selectCurrentSlide(liveState) ?? EMPTY_EDITOR_SLIDE
    const liveElement = liveSlide.elements.find(item => item.id === element.id) ?? element
    const liveActiveElementIds = liveSession.activeElementIds
    if (liveSession.activeTool) return
    if (event.button !== 0) {
      if (!liveElement.lock) event.stopPropagation()
      return
    }
    // While Space is held, the source drag mask owns every pointer-down,
    // including hits directly over editable elements.
    if (spacePressedRef.current) return
    if (liveElement.lock) return
    event.stopPropagation()
    if (!mobileInteraction) {
      stageRef.current?.focus()
      runtime.store.dispatch(editorActions.canvasFocusChanged(true))
      runtime.store.dispatch(editorActions.thumbnailsFocusChanged(false))
    }
    const wasSelected = liveActiveElementIds.includes(liveElement.id)
    const modifier = !mobileInteraction && (event.ctrlKey || event.metaKey || event.shiftKey)
    const groupIds = !mobileInteraction && liveElement.groupId
      ? liveSlide.elements.filter(item => item.groupId === liveElement.groupId).map(item => item.id)
      : [liveElement.id]
    let ids = liveActiveElementIds
    let pendingToggleIds: string[] | undefined
    let pendingActiveGroupElementId: string | undefined

    if (!wasSelected) ids = selectElement(event, liveElement)
    else if (modifier) {
      const removed = new Set(groupIds)
      const candidate = liveActiveElementIds.filter(id => !removed.has(id))
      if (candidate.length) {
        if (event.ctrlKey || event.metaKey) pendingToggleIds = candidate
        else {
          ids = candidate
          runtime.store.dispatch(editorActions.selectionChanged(candidate))
          runtime.store.dispatch(editorActions.activeGroupElementChanged(null))
        }
      }
    }
    else if (liveSession.handleElementId !== liveElement.id) {
      runtime.store.dispatch(editorActions.handleElementChanged(liveElement.id))
      runtime.store.dispatch(editorActions.activeGroupElementChanged(null))
    }
    else if (liveSession.activeGroupElementId !== liveElement.id) {
      pendingActiveGroupElementId = liveElement.id
    }
    if (liveSession.cropElementId) finishCropEditing(true)

    const point = slidePoint(event.nativeEvent)
    if (!point) return
    const activeMemberDrag = liveSession.activeGroupElementId === liveElement.id
    const movingIds = activeMemberDrag ? [liveElement.id] : ids
    const elements = liveSlide.elements.filter(item => movingIds.includes(item.id))
    const duplicateElements = duplicatePreviewElements(elements, activeMemberDrag)
    const handleIndex = elements.findIndex(item => item.id === liveElement.id)
    begin(event, 'drag', point, {
      kind: 'drag',
      activationDistance: DRAG_ACTIVATION_DISTANCE / scale,
      activated: false,
      duplicateActivated: false,
      duplicateElements,
      duplicateHandleElementId: duplicateElements[handleIndex]?.id ?? duplicateElements[0]!.id,
      duplicatePreviewReady: false,
      lastPreviewUpdates: new Map(),
      sourceHandleElementId: liveElement.id,
      elements: structuredClone(elements),
      bounds: getElementsBounds(elements),
      pendingActiveGroupElementId,
      pendingToggleIds,
    })
  }

  const handleMediaPointerDown = (event: ReactPointerEvent<HTMLElement>, element: PPTElement, canMove: boolean) => {
    if (canMove) {
      handleElementPointerDown(event, element)
      return
    }
    const liveState = runtime.store.getState()
    const liveSession = selectSession(liveState)
    const liveSlide = selectCurrentSlide(liveState) ?? EMPTY_EDITOR_SLIDE
    const liveElement = liveSlide.elements.find(item => item.id === element.id) ?? element
    if (liveSession.activeTool || spacePressedRef.current || liveElement.lock) return
    if (event.button !== 0) {
      event.stopPropagation()
      return
    }
    event.stopPropagation()
    if (!mobileInteraction) {
      stageRef.current?.focus()
      runtime.store.dispatch(editorActions.canvasFocusChanged(true))
      runtime.store.dispatch(editorActions.thumbnailsFocusChanged(false))
    }
    if (!liveSession.activeElementIds.includes(liveElement.id)) selectElement(event, liveElement)
    else if (event.ctrlKey || event.metaKey || event.shiftKey) selectElement(event, liveElement)
    else if (liveSession.handleElementId !== liveElement.id) {
      runtime.store.dispatch(editorActions.handleElementChanged(liveElement.id))
      runtime.store.dispatch(editorActions.activeGroupElementChanged(null))
    }
    if (liveSession.cropElementId) finishCropEditing(true)
  }

  const handleTextEditorMouseDown = (event: MouseEvent, element: PPTTextElement | PPTShapeElement) => {
    const liveRootState = runtime.store.getState()
    const liveSlide = selectCurrentSlide(liveRootState) ?? EMPTY_EDITOR_SLIDE
    const liveElement = liveSlide.elements.find((item): item is PPTTextElement | PPTShapeElement => (
      item.id === element.id && (item.type === 'text' || item.type === 'shape')
    )) ?? element
    if (liveElement.lock) return
    event.stopPropagation()
    if (!mobileInteraction) {
      stageRef.current?.focus()
      runtime.store.dispatch(editorActions.canvasFocusChanged(true))
      runtime.store.dispatch(editorActions.thumbnailsFocusChanged(false))
    }
    if (liveRootState.session.cropElementId) finishCropEditing(true)

    const state = runtime.store.getState().session
    const selected = state.activeElementIds.includes(liveElement.id)
    const modifier = event.ctrlKey || event.metaKey || event.shiftKey

    if (!selected) selectElement(event, liveElement)
    else if (modifier) {
      const groupIds = liveElement.groupId
        ? liveSlide.elements.filter(item => item.groupId === liveElement.groupId).map(item => item.id)
        : [liveElement.id]
      const removed = new Set(groupIds)
      const candidate = state.activeElementIds.filter(id => !removed.has(id))
      if (candidate.length) {
        runtime.store.dispatch(editorActions.selectionChanged(candidate))
        runtime.store.dispatch(editorActions.activeGroupElementChanged(null))
      }
    }
    else if (state.handleElementId !== liveElement.id) {
      runtime.store.dispatch(editorActions.handleElementChanged(liveElement.id))
    }
    else if (state.activeGroupElementId !== liveElement.id) {
      const startPageX = event.pageX
      const startPageY = event.pageY
      const target = event.target as HTMLElement
      target.onmouseup = mouseUpEvent => {
        if (startPageX === mouseUpEvent.pageX && startPageY === mouseUpEvent.pageY) {
          runtime.store.dispatch(editorActions.activeGroupElementChanged(liveElement.id))
          target.onmouseup = null
        }
      }
    }
  }

  const handleElementContextMenu = (event: ReactMouseEvent<HTMLElement>, element: PPTElement) => {
    event.preventDefault()
    event.stopPropagation()
    if (interactionProfile === 'mobile') return
    const liveState = runtime.store.getState()
    const liveSession = selectSession(liveState)
    const liveSlide = selectCurrentSlide(liveState) ?? EMPTY_EDITOR_SLIDE
    const liveElement = liveSlide.elements.find(item => item.id === element.id) ?? element
    if (!liveElement.lock) {
      if (!liveSession.activeElementIds.includes(liveElement.id)) selectElement(event.nativeEvent, liveElement)
      else if (event.ctrlKey || event.metaKey || event.shiftKey) selectElement(event.nativeEvent, liveElement)
      else if (liveSession.handleElementId !== liveElement.id) {
        runtime.store.dispatch(editorActions.handleElementChanged(liveElement.id))
      }
    }
    setMenu({
      elementId: liveElement.id,
      position: { x: event.clientX, y: event.clientY },
      surface: 'element',
    })
  }

  const handleTableCellContextMenu = (
    event: ReactMouseEvent<HTMLElement>,
    element: PPTTableElement,
    row: number,
    column: number,
  ) => {
    event.preventDefault()
    event.stopPropagation()
    if (interactionProfile === 'mobile') return
    if (!selectSession(runtime.store.getState()).activeElementIds.includes(element.id)) {
      runtime.store.dispatch(editorActions.selectionChanged([element.id]))
    }
    runtime.store.dispatch(editorActions.handleElementChanged(element.id))
    const selected = selectSession(runtime.store.getState()).selectedTableCells
    const key = tableCellKey(row, column)
    if (!selected.includes(key)) runtime.store.dispatch(editorActions.selectedTableCellsChanged([key]))
    setMenu({
      cell: { row, column },
      elementId: element.id,
      position: { x: event.clientX, y: event.clientY },
      surface: 'table-cell',
    })
  }

  const createTextAtPoint = (point: PointerPosition) => {
    const viewportRect = canvasRef.current?.getBoundingClientRect()
    if (!viewportRect) return
    const element = createElementFromGesture(
      { type: 'text', key: 'text', vertical: false },
      { start: point, end: { x: point.x + 200, y: point.y } },
      viewportRect,
      scale,
      presentation.theme,
    )
    if (runtime.commit('Create text', [{ type: 'element.add', elements: element }])) {
      runtime.store.dispatch(editorActions.selectionChanged([element.id]))
    }
  }

  const handleBlankPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (mobileInteraction) {
      if (event.pointerType !== 'touch' || event.button !== 0) return
      setMenu(null)
      runtime.store.dispatch(editorActions.selectionChanged([]))
      window.getSelection()?.removeAllRanges()
      return
    }
    if (activeTool) {
      if (event.button !== 0) return
      const stageRect = stageRef.current?.getBoundingClientRect()
      const viewportRect = canvasRef.current?.getBoundingClientRect()
      if (!stageRect || !viewportRect) return
      begin(event, 'create', inputPoint(event.nativeEvent), {
        kind: 'create',
        stageOffset: { x: stageRect.left, y: stageRect.top },
        tool: activeTool,
        viewportRect: { left: viewportRect.left, top: viewportRect.top },
        viewportScale: scale,
      })
      return
    }
    stageRef.current?.focus()
    runtime.store.dispatch(editorActions.canvasFocusChanged(true))
    runtime.store.dispatch(editorActions.thumbnailsFocusChanged(false))
    setMenu(null)
    if (cropElementId) finishCropEditing(true)
    if (event.button !== 0) {
      // Canvas.vue receives every mousedown button. A secondary-button blank
      // press therefore clears element focus before its context menu opens.
      runtime.store.dispatch(editorActions.selectionChanged([]))
      window.getSelection()?.removeAllRanges()
      return
    }
    if (spacePressedRef.current) {
      runtime.store.dispatch(editorActions.selectionChanged([]))
      window.getSelection()?.removeAllRanges()
      begin(event, 'pan', { x: event.clientX, y: event.clientY }, { kind: 'pan', pan: canvasPan })
      return
    }
    runtime.store.dispatch(editorActions.selectionChanged([]))
    window.getSelection()?.removeAllRanges()
    const point = slidePoint(event.nativeEvent)
    if (!point) return
    begin(event, 'lasso', point, { kind: 'lasso' })
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (runtime.interaction.getSnapshot().status !== 'active') return
    const context = gestureRef.current
    const point = context?.kind === 'pan' || context?.kind === 'create'
      ? context.kind === 'create'
        ? inputPoint(event.nativeEvent)
        : { x: event.clientX, y: event.clientY }
      : slidePoint(event.nativeEvent)
    if (!point) return
    const rawOrigin = rawGestureOriginRef.current
    const rawPointer = inputPoint(event.nativeEvent)
    if (context?.kind === 'resize' && rawOrigin) {
      context.rawDelta = { x: rawPointer.x - rawOrigin.x, y: rawPointer.y - rawOrigin.y }
    }
    const legacyDelta = rawOrigin
      ? context?.kind === 'pan' || context?.kind === 'create'
        ? { x: rawPointer.x - rawOrigin.x, y: rawPointer.y - rawOrigin.y }
        : {
          x: (rawPointer.x - rawOrigin.x) / scale,
          y: (rawPointer.y - rawOrigin.y) / scale,
        }
      : undefined
    const duplicateWasActive = context?.kind === 'drag' && context.duplicateActivated
    runtime.interaction.updatePointer(point, pointerModifiers(event.nativeEvent), legacyDelta)
    if (context?.kind === 'drag' && duplicateWasActive) context.duplicatePreviewReady = true
    if (context?.kind === 'drag' && !context.duplicateActivated) {
      const snapshot = runtime.interaction.getSnapshot()
      if (
        exceedsActivationDistance(snapshot.delta, context.activationDistance) &&
        (snapshot.modifiers.control || snapshot.modifiers.meta)
      ) {
        // Vue mutates its local element list on every drag frame. If duplicate
        // mode starts later in the same gesture, duplicateElement() first
        // writes that previously rendered list into the slide, then creates a
        // copy from the pointer-down geometry. Preserve that exact hand-off:
        // the original remains at the last non-duplicate preview position and
        // the copy continues using the full pointer delta.
        if (context.lastPreviewUpdates.size) {
          runtime.commit('Move elements before duplicate', [
            ...toCommands(context.lastPreviewUpdates),
            { type: 'element.add', elements: context.duplicateElements },
          ], { recordHistory: false })
        }
        else {
          runtime.commit(
            'Begin duplicate drag',
            [{ type: 'element.add', elements: context.duplicateElements }],
            { recordHistory: false },
          )
        }
        context.duplicateActivated = true
        runtime.store.dispatch(editorActions.selectionChanged(context.duplicateElements.map(element => element.id)))
        runtime.store.dispatch(editorActions.handleElementChanged(context.duplicateHandleElementId))
        runtime.store.dispatch(editorActions.activeGroupElementChanged(null))
      }
      else {
        context.lastPreviewUpdates = derivePreview(
          context,
          snapshot,
          currentSlide,
          presentation.viewportSize,
          presentation.viewportRatio,
        ).updates
      }
    }
  }

  const finishGesture = (event: ReactPointerEvent<HTMLElement>) => {
    const context = gestureRef.current
    const snapshot = runtime.interaction.getSnapshot()
    if (!context || snapshot.status !== 'active') return
    const finalPreview = derivePreview(context, snapshot, currentSlide, presentation.viewportSize, presentation.viewportRatio)
    let finalUpdates = finalPreview.updates
    if (context.kind === 'resize' && context.elements.length === 1) {
      const element = context.elements[0]
      if (element?.type === 'text' && !element.fixedHeight) {
        const content = canvasRef.current?.querySelector<HTMLElement>(
          `[data-element-id="${CSS.escape(element.id)}"] .mona-text-content`,
        )
        if (content) {
          const measuredUpdates = new Map<string, Partial<PPTElement>>(finalUpdates)
          const props = measuredUpdates.get(element.id) ?? {}
          const styles = getComputedStyle(content)
          const measured = Number.parseFloat(element.vertical ? styles.width : styles.height)
          measuredUpdates.set(element.id, (element.vertical
            ? { ...props, width: measured }
            : { ...props, height: measured }) as Partial<PPTElement>)
          finalUpdates = measuredUpdates
        }
      }
      else if (element?.type === 'table') {
        const table = canvasRef.current?.querySelector<HTMLElement>(
          `[data-element-id="${CSS.escape(element.id)}"] .mona-static-table`,
        )
        if (table) {
          const measuredUpdates = new Map<string, Partial<PPTElement>>(finalUpdates)
          measuredUpdates.set(element.id, {
            ...(measuredUpdates.get(element.id) ?? {}),
            height: table.offsetHeight,
          } as Partial<PPTElement>)
          finalUpdates = measuredUpdates
        }
      }
    }
    runtime.interaction.complete()
    gestureRef.current = null
    rawGestureOriginRef.current = null
    setGestureContext(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)

    if (context.kind === 'drag') {
      const painterTarget = currentSlide.elements.find((element): element is Extract<PPTElement, { type: 'shape' }> => (
        element.id === context.sourceHandleElementId && element.type === 'shape'
      ))
      if (painterTarget) runtime.shapeFormatPainter.apply(painterTarget)
    }

    if (context.kind === 'pan' && finalPreview.pan) {
      runtime.store.dispatch(editorActions.canvasPanChanged(finalPreview.pan))
      runtime.store.dispatch(editorActions.canvasDraggedChanged(true))
      return
    }
    if (context.kind === 'drag' && !context.activated) {
      if (snapshot.delta.x === 0 && snapshot.delta.y === 0) {
        if (context.pendingToggleIds?.length) {
          runtime.store.dispatch(editorActions.selectionChanged(context.pendingToggleIds))
          runtime.store.dispatch(editorActions.activeGroupElementChanged(null))
        }
        else if (context.pendingActiveGroupElementId) {
          runtime.store.dispatch(editorActions.activeGroupElementChanged(context.pendingActiveGroupElementId))
        }
      }
      // Quirk retired: PPTist recorded a history snapshot for sub-threshold
      // moved drags even though no document field changed.
      return
    }
    if (context.kind === 'lasso' && finalPreview.lasso) {
      const selection = rectToBounds(finalPreview.lasso)
      const intersecting = event.ctrlKey || event.metaKey || event.shiftKey
      const ids = getLassoSelectionIds({
        elements: currentSlide.elements,
        hiddenElementIds: new Set(session.hiddenElementIds),
        intersecting,
        selection,
      })
      runtime.store.dispatch(editorActions.selectionChanged(ids))
      return
    }
    if (context.kind === 'create') {
      const selection = resolveCreateGestureSelection({
        lastPointer: snapshot.pointer,
        modifiers: snapshot.modifiers,
        rawPointer: inputPoint(event.nativeEvent),
        start: snapshot.origin,
        tool: context.tool.type,
      })
      const element = createElementFromGesture(
        context.tool,
        selection,
        context.viewportRect,
        context.viewportScale,
        presentation.theme,
      )
      if (runtime.commit(`Create ${context.tool.type}`, [{ type: 'element.add', elements: element }])) {
        runtime.store.dispatch(editorActions.selectionChanged([element.id]))
        onCreateToolChange(null)
      }
      return
    }
    if (context.kind === 'crop') {
      if (exceedsActivationDistance(snapshot.delta, TRANSFORM_ACTIVATION_DISTANCE) && finalPreview.cropGeometry) {
        updateCropDraft({
          dirty: true,
          element: context.element,
          geometry: finalPreview.cropGeometry,
        })
      }
      return
    }
    const activationDistance = context.kind === 'drag' ? context.activationDistance : TRANSFORM_ACTIVATION_DISTANCE
    if (!exceedsActivationDistance(snapshot.delta, activationDistance) || !finalUpdates.size) {
      // Quirk retired: PPTist recorded a duplicate snapshot when the handle
      // of an already-rotated element was clicked without movement.
      return
    }
    if (context.kind === 'drag' && context.duplicateActivated) {
      if (!context.duplicatePreviewReady) {
        runtime.recordHistorySnapshot('drag-elements')
        return
      }
      const duplicateUpdates = new Map<string, Partial<PPTElement>>()
      context.duplicateElements.forEach((duplicate, index) => {
        const source = context.elements[index]
        const props = source ? finalUpdates.get(source.id) : undefined
        if (props) duplicateUpdates.set(duplicate.id, props)
      })
      runtime.commit(
        'Duplicate and move elements',
        toCommands(duplicateUpdates),
        { historyKey: 'drag-elements' },
      )
      return
    }
    if (context.kind === 'rotate' && context.mode === 'group') {
      // Vue's group-rotate hook returns before applying when deltaAngle is 0;
      // an identical-value commit would still schedule a history snapshot.
      const unchanged = [...finalUpdates.entries()].every(([id, props]) => {
        const original = context.elements.find(element => element.id === id)
        return original && Object.entries(props).every(([key, value]) => (original as unknown as Record<string, unknown>)[key] === value)
      })
      if (unchanged) return
    }
    if (context.kind === 'drag' || context.kind === 'resize' || context.kind === 'rotate') {
      const labels = { drag: 'Move elements', resize: 'Resize elements', rotate: 'Rotate elements' } as const
      runtime.commit(
        labels[context.kind],
        toCommands(finalUpdates),
        context.kind === 'drag' ? { historyKey: 'drag-elements' } : undefined,
      )
      return
    }
    if (context.kind === 'line-point' || context.kind === 'shape-keypoint') {
      runtime.commit(
        context.kind === 'line-point' ? 'Move line control point' : 'Move shape keypoint',
        toCommands(finalUpdates),
      )
    }
  }

  const cancelGesture = (event: ReactPointerEvent<HTMLElement>) => {
    const context = gestureRef.current
    runtime.interaction.cancel()
    gestureRef.current = null
    rawGestureOriginRef.current = null
    setGestureContext(null)
    if (context?.kind === 'drag' && context.duplicateActivated) {
      // The copies were committed (without history) when duplicate mode
      // activated; a cancelled gesture must not leave them stacked on the
      // originals as a silent document mutation.
      runtime.commit('Cancel duplicate drag', [{
        type: 'element.delete',
        elementIds: context.duplicateElements.map(element => element.id),
      }], { recordHistory: false })
      runtime.store.dispatch(editorActions.selectionChanged(context.elements.map(element => element.id)))
      runtime.store.dispatch(editorActions.handleElementChanged(context.sourceHandleElementId))
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const beginResize = (event: ReactPointerEvent<HTMLButtonElement>, handle: ResizeHandle) => {
    event.stopPropagation()
    const point = slidePoint(event.nativeEvent)
    if (!point || !transformElements.length || !canResizeSelection(transformElements)) return
    begin(event, 'resize', point, {
      kind: 'resize',
      elements: structuredClone(transformElements),
      bounds: transformElements.length === 1 && transformElements[0]?.type !== 'line'
        ? {
          minX: transformElements[0].left,
          maxX: transformElements[0].left + transformElements[0].width,
          minY: transformElements[0].top,
          maxY: transformElements[0].top + transformElements[0].height,
        }
        : getTransformBounds(transformElements),
      fixedRatio: transformElements.length === 1 && transformElements[0]?.type !== 'line'
        ? Boolean(
          event.ctrlKey || event.metaKey || event.shiftKey ||
            ('fixedRatio' in transformElements[0] && transformElements[0].fixedRatio),
        )
        : false,
      handle,
      scale,
    })
  }

  const beginRotate = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    const point = slidePoint(event.nativeEvent)
    if (!point || !transformElements.length) return
    const single = transformElements.length === 1 && transformElements[0]?.type !== 'line'
      ? transformElements[0]
      : undefined
    const rotationReference = single ? single.rotate : getGroupRotationReference(transformElements)
    const center = single
      ? { x: single.left + single.width / 2, y: single.top + single.height / 2 }
      : getGroupRotationCenter(transformElements, rotationReference ?? 0)
    begin(event, 'rotate', point, {
      kind: 'rotate',
      elements: structuredClone(transformElements),
      center,
      mode: single ? 'single' : 'group',
      rotationReference,
      startAngle: angleFromPoint(center, point),
    })
  }

  const beginCrop = (event: ReactPointerEvent<HTMLElement>, handle: CropControlHandle) => {
    event.stopPropagation()
    const image = selectedElements.length === 1 && selectedElements[0]?.type === 'image' ? selectedElements[0] : undefined
    const point = slidePoint(event.nativeEvent)
    if (!point || !image) return
    begin(event, 'crop', point, {
      kind: 'crop',
      element: structuredClone(cropDraft?.element.id === image.id ? cropDraft.element : image),
      geometry: structuredClone(cropGeometry ?? getImageCropGeometry(image)),
      handle,
    })
  }

  const beginLinePoint = (event: ReactPointerEvent<HTMLButtonElement>, handle: LineControlHandle) => {
    event.stopPropagation()
    const line = transformElements.length === 1 && transformElements[0]?.type === 'line'
      ? transformElements[0]
      : undefined
    const point = slidePoint(event.nativeEvent)
    if (!point || !line) return
    begin(event, 'resize', point, { kind: 'line-point', element: structuredClone(line), handle })
  }

  const beginShapeKeypoint = (event: ReactPointerEvent<HTMLButtonElement>, index: number) => {
    event.stopPropagation()
    const shape = transformElements.length === 1 && transformElements[0]?.type === 'shape'
      ? transformElements[0]
      : undefined
    const point = slidePoint(event.nativeEvent)
    if (!point || !shape) return
    begin(event, 'resize', point, { kind: 'shape-keypoint', element: structuredClone(shape), index })
  }

  const writeClipboard = async (serialized: string | undefined) => {
    if (!serialized || !navigator.clipboard) return
    try {
      await navigator.clipboard.writeText(serialized)
    }
    catch { /* Native clipboard events and the in-memory fallback remain available. */ }
  }

  const commitPastedElement = (label: string, element: PPTElement, historyKey: 'clipboard-file' | 'clipboard-text') => {
    if (!runtime.commit(label, [{ type: 'element.add', elements: element }], { historyKey })) return
    runtime.store.dispatch(editorActions.selectionChanged([element.id]))
    runtime.store.dispatch(editorActions.canvasFocusChanged(true))
  }

  const createTextFromClipboard = (text: string, contentIsHtml = false) => {
    commitPastedElement('Paste text', {
      type: 'text',
      id: createPresentationId(10),
      left: 0,
      top: 0,
      width: 600,
      height: 50,
      content: contentIsHtml ? text : parseTextToParagraphs(text),
      rotate: 0,
      defaultFontName: presentation.theme.fontName,
      defaultColor: presentation.theme.fontColor,
      vertical: false,
    }, 'clipboard-text')
  }

  const createImageFromClipboard = async (src: string, historyKey: 'clipboard-file' | 'clipboard-text' = 'clipboard-text') => {
    try {
      let { height, width } = await imageSize(src)
      const ratio = height / width
      if (ratio < presentation.viewportRatio && width > presentation.viewportSize) {
        width = presentation.viewportSize
        height = width * ratio
      }
      else if (height > presentation.viewportSize * presentation.viewportRatio) {
        height = presentation.viewportSize * presentation.viewportRatio
        width = height / ratio
      }
      commitPastedElement('Paste image', {
        type: 'image',
        id: createPresentationId(10),
        src,
        width,
        height,
        left: (presentation.viewportSize - width) / 2,
        top: (presentation.viewportSize * presentation.viewportRatio - height) / 2,
        fixedRatio: true,
        rotate: 0,
      }, historyKey)
    }
    catch { /* PPTist also leaves an unreadable image paste as a no-op. */ }
  }

  const createMediaFromClipboard = (file: File) => {
    const src = URL.createObjectURL(file)
    const ext = MEDIA_EXTENSION_BY_MIME[file.type]
    if (file.type.includes('video')) {
      commitPastedElement('Paste video', {
        type: 'video',
        id: createPresentationId(10),
        width: 500,
        height: 300,
        rotate: 0,
        left: (presentation.viewportSize - 500) / 2,
        top: (presentation.viewportSize * presentation.viewportRatio - 300) / 2,
        src,
        autoplay: false,
        ...(ext ? { ext } : {}),
      }, 'clipboard-file')
    }
    else {
      commitPastedElement('Paste audio', {
        type: 'audio',
        id: createPresentationId(10),
        width: 50,
        height: 50,
        rotate: 0,
        left: (presentation.viewportSize - 50) / 2,
        top: (presentation.viewportSize * presentation.viewportRatio - 50) / 2,
        loop: false,
        autoplay: false,
        fixedRatio: true,
        color: presentation.theme.themeColors[0]!,
        src,
        ...(ext ? { ext } : {}),
      }, 'clipboard-file')
    }
  }

  const handlePaste = (event: ClipboardEvent) => {
    const state = runtime.store.getState().session
    if ((!state.canvasFocus && !state.thumbnailsFocus) || state.disableHotkeys) return
    if (!event.clipboardData) return
    let handledFile = false
    for (const item of event.clipboardData.items) {
      if (item.kind !== 'file') continue
      const file = item.getAsFile()
      if (!file) continue
      if (item.type.includes('image')) {
        handledFile = true
        void fileAsDataUrl(file).then(src => createImageFromClipboard(src, 'clipboard-file'))
      }
      else if (item.type.includes('video') || item.type.includes('audio')) {
        handledFile = true
        createMediaFromClipboard(file)
      }
    }
    if (handledFile) return
    const serialized = event.clipboardData.getData(MONA_CLIPBOARD_MIME) || event.clipboardData.getData('text/plain')
    if (!serialized) return
    const payload = parseCustomEditorClipboard(serialized)
    if (typeof payload !== 'string') {
      // PPTist treats every successfully decrypted JSON value as custom
      // clipboard data. Unsupported object shapes are a no-op; they must not
      // fall through and become a text element containing the ciphertext.
      if (payload && typeof payload === 'object' && 'type' in payload) {
        if (payload.type === 'elements') runtime.paste(serialized)
        else if (payload.type === 'slides') runtime.pasteSlides(serialized)
      }
      return
    }
    if (!shiftPressedRef.current && isPptistImageUrl(payload)) void createImageFromClipboard(payload)
    else if (!shiftPressedRef.current && isPptistValidUrl(payload)) {
      createTextFromClipboard(`<a href="${payload}" title="${payload}" target="_blank">${payload}</a>`, true)
    }
    else if (!shiftPressedRef.current && isSvgText(payload)) {
      void createImageFromClipboard(`data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(payload)))}`)
    }
    else createTextFromClipboard(payload)
  }

  // Vue's useDrop: dropped media files insert through the shared paste
  // routing; dropped plain text becomes a 600x50 text element at the origin.
  const handleDrop = (event: ReactDragEvent<HTMLElement>) => {
    event.preventDefault()
    const transfer = event.dataTransfer
    if (!transfer || transfer.items.length === 0) return
    let handledFile = false
    for (const item of transfer.items) {
      if (item.kind !== 'file') continue
      const file = item.getAsFile()
      if (!file) continue
      if (item.type.includes('image')) {
        handledFile = true
        void fileAsDataUrl(file).then(src => createImageFromClipboard(src, 'clipboard-file'))
      }
      else if (item.type.includes('video') || item.type.includes('audio')) {
        handledFile = true
        createMediaFromClipboard(file)
      }
    }
    if (handledFile) return
    const first = transfer.items[0]
    if (first && first.kind === 'string' && first.type === 'text/plain') {
      first.getAsString(text => {
        if (selectSession(runtime.store.getState()).disableHotkeys) return
        createTextFromClipboard(text)
      })
    }
  }

  const nudgeSelection = (elements: readonly PPTElement[], x: number, y: number) => {
    const commands: PresentationCommand[] = elements.map(element => ({
      type: 'element.update',
      payload: { id: element.id, props: { left: element.left + x, top: element.top + y } },
    }))
    runtime.commit('Nudge elements', commands)
  }

  const deleteCurrentSelection = () => {
    const liveSession = selectSession(runtime.store.getState())
    const ids = liveSession.activeGroupElementId
      ? [liveSession.activeGroupElementId]
      : liveSession.activeElementIds
    if (!ids.length) return false
    const changed = runtime.commit('Delete elements', [{ type: 'element.delete', elementIds: ids }])
    if (changed) {
      runtime.store.dispatch(editorActions.selectionChanged([]))
      runtime.store.dispatch(editorActions.activeGroupElementChanged(null))
    }
    return changed
  }

  const flushCurrentTableMeasurements = () => {
    const slide = selectCurrentSlide(runtime.store.getState())
    if (!slide || !canvasRef.current) return
    const commands: PresentationCommand[] = []
    for (const element of slide.elements) {
      if (element.type !== 'table') continue
      const root = canvasRef.current.querySelector<HTMLElement>(
        `[data-element-id="${CSS.escape(element.id)}"].mona-table-element`,
      )
      if (!root) continue
      const height = Number.parseFloat(getComputedStyle(root).height)
      if (!Number.isFinite(height) || Math.abs(height - element.height) < 0.01) continue
      commands.push({
        type: 'element.update',
        payload: { id: element.id, props: { height } },
      })
    }
    if (commands.length) runtime.commit('Measure table elements', commands, { recordHistory: false })
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    const liveState = runtime.store.getState()
    const livePresentation = selectPresentation(liveState)
    const liveSession = selectSession(liveState)
    const liveCurrentSlide = selectCurrentSlide(liveState) ?? EMPTY_EDITOR_SLIDE
    const liveActiveElementIds = liveSession.activeElementIds
    const liveSelectedElements = liveCurrentSlide.elements.filter(element => liveActiveElementIds.includes(element.id))
    const liveActiveGroupElement = liveSession.activeGroupElementId
      ? liveCurrentSlide.elements.find(element => element.id === liveSession.activeGroupElementId)
      : undefined
    const liveTransformElements = liveActiveGroupElement ? [liveActiveGroupElement] : liveSelectedElements
    if (cropElementId && event.key === 'Enter') {
      event.preventDefault()
      finishCropEditing(true)
      return
    }
    // A shape's embedded ProseMirror can retain DOM focus after Shift-click
    // creates a multi-selection. PPTist still handles canvas shortcuts in
    // that state; text-input suppression applies only to an editing selection.
    if (isTextInput(event.target) && liveActiveElementIds.length <= 1) return
    if (!liveSession.canvasFocus && !liveSession.thumbnailsFocus) return
    const modifier = event.ctrlKey || event.metaKey
    const key = event.key.toLowerCase()
    if (liveSession.disableHotkeys) return
    if (event.key === ' ') {
      spacePressedRef.current = true
      setIsSpacePressed(true)
      event.preventDefault()
      return
    }
    if (modifier && key === 'a') {
      event.preventDefault()
      if (liveSession.canvasFocus) runtime.selectAll()
      if (liveSession.thumbnailsFocus) runtime.selectAllSlides()
      return
    }
    if (modifier && key === 'c') {
      event.preventDefault()
      void writeClipboard(liveSelectedElements.length
        ? runtime.copySelection()
        : liveSession.thumbnailsFocus ? runtime.copySlides() : undefined)
      return
    }
    if (modifier && key === 'x') {
      event.preventDefault()
      void writeClipboard(liveSelectedElements.length
        ? runtime.cutSelection()
        : liveSession.thumbnailsFocus ? runtime.cutSlides() : undefined)
      return
    }
    if (modifier && key === 'd') {
      event.preventDefault()
      if (liveSelectedElements.length) {
        runtime.copySelection()
        runtime.paste()
      }
      else if (liveSession.thumbnailsFocus) runtime.duplicateSlides()
      return
    }
    if (modifier && key === 'l' && liveSelectedElements.length) {
      event.preventDefault()
      commitElementLockChange({
        action: 'lock',
        elements: liveCurrentSlide.elements,
        selectedIds: liveActiveElementIds,
      })
      return
    }
    if (modifier && key === 'g' && liveSelectedElements.length) {
      event.preventDefault()
      handleContextAction(event.shiftKey ? 'ungroup' : 'group')
      return
    }
    if (modifier && key === 'z') {
      event.preventDefault()
      if (event.timeStamp - lastUndoAtRef.current >= 100) {
        lastUndoAtRef.current = event.timeStamp
        runtime.undo()
      }
      return
    }
    if (modifier && key === 'y') {
      event.preventDefault()
      if (event.timeStamp - lastRedoAtRef.current >= 100) {
        lastRedoAtRef.current = event.timeStamp
        runtime.redo()
      }
      return
    }
    if (event.altKey && (key === 'f' || key === 'b')) {
      if (liveSession.handleElementId) {
        event.preventDefault()
        handleContextAction(key === 'f' ? 'bring-front' : 'send-back')
      }
      return
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      if (liveActiveElementIds.length) deleteCurrentSelection()
      else if (liveSession.thumbnailsFocus) runtime.deleteSlides()
      return
    }
    if (event.key.startsWith('Arrow') && liveSelectedElements.length) {
      event.preventDefault()
      if (event.key === 'ArrowLeft') nudgeSelection(liveTransformElements, -1, 0)
      if (event.key === 'ArrowRight') nudgeSelection(liveTransformElements, 1, 0)
      if (event.key === 'ArrowUp') nudgeSelection(liveTransformElements, 0, -1)
      if (event.key === 'ArrowDown') nudgeSelection(liveTransformElements, 0, 1)
      return
    }
    if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !liveSelectedElements.length) {
      event.preventDefault()
      const index = livePresentation.slideIndex + (event.key === 'ArrowUp' ? -1 : 1)
      if (index >= 0 && index < livePresentation.slides.length) {
        flushCurrentTableMeasurements()
        navigateWithSlideTransition(() => runtime.focusSlide(index))
      }
      return
    }
    if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault()
      const index = livePresentation.slideIndex + (event.key === 'PageUp' ? -1 : 1)
      if (index >= 0 && index < livePresentation.slides.length) {
        flushCurrentTableMeasurements()
        navigateWithSlideTransition(() => runtime.focusSlide(index))
      }
      return
    }
    if (event.key === 'Enter' && liveSession.thumbnailsFocus) {
      event.preventDefault()
      runtime.createSlide()
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      if (!liveCurrentSlide.elements.length) return
      const currentIndex = liveSession.handleElementId
        ? liveCurrentSlide.elements.findIndex(element => element.id === liveSession.handleElementId)
        : -1
      const next = liveCurrentSlide.elements[currentIndex >= liveCurrentSlide.elements.length - 1 ? 0 : currentIndex + 1]!
      runtime.store.dispatch(editorActions.selectionChanged([next.id]))
      return
    }
    // Vue arms create tools only with editor-area (canvas) focus and without
    // Shift or Ctrl/Meta held.
    if (!modifier && !event.altKey && !event.shiftKey && liveSession.canvasFocus && ['r', 't', 'o', 'l'].includes(key)) {
      const tool = key === 't'
        ? { type: 'text', key: 'text', vertical: false } as const
        : key === 'l'
          ? { type: 'line', key: 'line', data: LINE_LIST[0]!.children[0]! } as const
          : key === 'o'
            ? { type: 'shape', key: 'ellipse', data: SHAPE_LIST.find(category => category.type === 'common')!.children[0]! } as const
            : { type: 'shape', key: 'shape', data: SHAPE_LIST[0]!.children[0]! } as const
      onCreateToolChange(tool)
    }
  }

  function commitElementLockChange(input: {
    action: 'lock' | 'unlock'
    elements: readonly PPTElement[]
    selectedIds: readonly string[]
    targetElementId?: string
  }) {
    const result = setElementLocksLikePptist({
      elements: input.elements,
      lock: input.action === 'lock',
      selectedIds: new Set(input.selectedIds),
      targetElementId: input.targetElementId,
    })
    if (!result) return false
    const changed = runtime.commit(input.action === 'lock' ? 'Lock elements' : 'Unlock elements', [{
      type: 'slide.update',
      props: { elements: result.elements },
    }])
    if (changed) runtime.store.dispatch(editorActions.selectionChanged(result.selectedIds))
    return changed
  }

  function handleContextAction(action: string) {
    setMenu(null)
    stageRef.current?.focus()
    const liveRootState = runtime.store.getState()
    const livePresentation = selectPresentation(liveRootState)
    const liveSession = selectSession(liveRootState)
    const liveCurrentSlide = selectCurrentSlide(liveRootState) ?? EMPTY_EDITOR_SLIDE
    const liveActiveElementIds = liveSession.activeElementIds
    const liveMenuElement = menu?.elementId
      ? liveCurrentSlide.elements.find(element => element.id === menu.elementId)
      : undefined
    if (action.startsWith('table-') && liveMenuElement?.type === 'table' && menu?.cell) {
      const selected = liveSession.selectedTableCells.length
        ? liveSession.selectedTableCells
        : [tableCellKey(menu.cell.row, menu.cell.column)]
      let next: PPTTableElement | null = null
      if (action === 'table-insert-column-left') next = insertTableColumn(liveMenuElement, menu.cell.column)
      else if (action === 'table-insert-column-right') next = insertTableColumn(liveMenuElement, menu.cell.column + 1)
      else if (action === 'table-insert-row-above') next = insertTableRow(liveMenuElement, menu.cell.row)
      else if (action === 'table-insert-row-below') next = insertTableRow(liveMenuElement, menu.cell.row + 1)
      else if (action === 'table-delete-column') next = deleteTableColumn(liveMenuElement, menu.cell.column)
      else if (action === 'table-delete-row') next = deleteTableRow(liveMenuElement, menu.cell.row)
      else if (action === 'table-merge') {
        next = mergeTableCells(liveMenuElement, selected)
        runtime.store.dispatch(editorActions.selectedTableCellsChanged([]))
      }
      else if (action === 'table-split') {
        next = splitTableCell(liveMenuElement, menu.cell.row, menu.cell.column)
        runtime.store.dispatch(editorActions.selectedTableCellsChanged([]))
      }
      else if (action === 'table-select-column') {
        runtime.store.dispatch(editorActions.selectedTableCellsChanged(liveMenuElement.data.map((_row, row) => tableCellKey(row, menu.cell!.column))))
      }
      else if (action === 'table-select-row') {
        runtime.store.dispatch(editorActions.selectedTableCellsChanged(liveMenuElement.data[menu.cell.row]!.map((_cell, column) => tableCellKey(menu.cell!.row, column))))
      }
      else if (action === 'table-select-all') {
        runtime.store.dispatch(editorActions.selectedTableCellsChanged(liveMenuElement.data.flatMap((row, rowIndex) => row.map((_cell, column) => tableCellKey(rowIndex, column)))))
      }
      if (next && next !== liveMenuElement) {
        runtime.commit('Edit table', [{
          type: 'element.update',
          payload: { id: next.id, props: { data: next.data, width: next.width, colWidths: next.colWidths } },
        }])
      }
      return
    }
    if (action === 'copy') void writeClipboard(runtime.copySelection())
    else if (action === 'cut') void writeClipboard(runtime.cutSelection())
    else if (action === 'paste') {
      if (!runtime.paste().length && navigator.clipboard) {
        void navigator.clipboard.readText().then(serialized => runtime.paste(serialized)).catch(() => undefined)
      }
    }
    else if (action === 'delete') deleteCurrentSelection()
    else if (action === 'select-all') runtime.selectAll()
    else if (action === 'ruler') runtime.store.dispatch(editorActions.rulerVisibilityChanged(!showRuler))
    else if (action === 'grid-toggle') runtime.store.dispatch(editorActions.gridLineSizeChanged(gridLineSize ? 0 : 50))
    else if (action.startsWith('grid-')) runtime.store.dispatch(editorActions.gridLineSizeChanged(Number(action.slice(5))))
    else if (action === 'bubble-menu') {
      const visible = !liveSession.showBubbleMenu
      runtime.store.dispatch(editorActions.bubbleMenuVisibilityChanged(visible))
      setNotices(current => [...current, {
        id: ++noticeIdRef.current,
        text: t('foundation.editor.action.bubbleMenuStatus', {
          status: t(visible ? 'foundation.editor.action.enabled' : 'foundation.editor.action.disabled'),
        }),
        type: 'success',
      }])
    }
    else if (action === 'reset-slide') {
      const elementIds = liveCurrentSlide.elements.map(element => element.id)
      if (elementIds.length && runtime.commit('Reset slide', [{ type: 'element.delete', elementIds }])) {
        runtime.store.dispatch(editorActions.selectionChanged([]))
      }
    }
    else if (action === 'slideshow') {
      window.dispatchEvent(new CustomEvent('mona:screening-request', { detail: { fromStart: true } }))
    }
    else if (action.startsWith('align-')) {
      const command = action.slice('align-'.length) as Parameters<typeof alignElementsToCanvasLikePptist>[0]['command']
      const elements = alignElementsToCanvasLikePptist({
        command,
        elements: liveCurrentSlide.elements,
        selectedIds: new Set(liveActiveElementIds),
        viewportHeight: livePresentation.viewportSize * livePresentation.viewportRatio,
        viewportWidth: livePresentation.viewportSize,
      })
      runtime.commit('Align elements to slide', [{ type: 'slide.update', props: { elements } }])
    }
    else if (['bring-front', 'bring-forward', 'send-back', 'send-backward'].includes(action)) {
      const orderTarget = liveMenuElement ?? liveCurrentSlide.elements.find(element => element.id === liveSession.handleElementId)
      if (!orderTarget) return
      const command = ({
        'bring-front': 'top',
        'bring-forward': 'up',
        'send-back': 'bottom',
        'send-backward': 'down',
      } as const)[action as 'bring-front' | 'bring-forward' | 'send-back' | 'send-backward']
      const elements = orderElementLikePptist(liveCurrentSlide.elements, orderTarget.id, command)
      if (elements) runtime.commit('Reorder elements', [{ type: 'slide.update', props: { elements } }])
    }
    else if (action === 'group') {
      const selected = new Set(liveActiveElementIds)
      const elements = groupElementsLikePptist(liveCurrentSlide.elements, selected, createPresentationId(10))
      runtime.commit('Group elements', [{ type: 'slide.update', props: { elements } }])
    }
    else if (action === 'ungroup') {
      const elements = ungroupElementsLikePptist(liveCurrentSlide.elements, new Set(liveActiveElementIds))
      if (!elements) return
      const changed = runtime.commit('Ungroup elements', [{ type: 'slide.update', props: { elements } }])
      const selectedId = liveMenuElement?.id ?? liveSession.handleElementId ?? liveActiveElementIds[0]
      if (changed && selectedId) runtime.store.dispatch(editorActions.selectionChanged([selectedId]))
    }
    else if (action === 'lock' || action === 'unlock') {
      commitElementLockChange({
        action,
        elements: liveCurrentSlide.elements,
        selectedIds: liveActiveElementIds,
        targetElementId: liveMenuElement?.id,
      })
    }
    else if (action === 'set-link' && liveMenuElement) {
      openLinkEditorFor(liveMenuElement)
    }
  }

  function openLinkEditorFor(element: PPTElement) {
    const livePresentation = runtime.store.getState().presentation
    const liveSlide = livePresentation.slides[livePresentation.slideIndex]
    const defaultSlideId = livePresentation.slides.find(slide => slide.id !== liveSlide?.id)?.id ?? ''
    runtime.store.dispatch(editorActions.hotkeysDisabledChanged(true))
    setLinkEditor({
      address: element.link?.type === 'web' ? element.link.target : '',
      elementId: element.id,
      slideId: element.link?.type === 'slide' ? element.link.target : defaultSlideId,
      type: element.link?.type ?? 'web',
    })
  }

  const handleWheel = (event: WheelEvent) => {
    event.preventDefault()
    if (!event.deltaY) return
    const now = event.timeStamp
    if (ctrlOrMetaPressedRef.current) {
      if (now - lastZoomWheelAtRef.current < 100) return
      lastZoomWheelAtRef.current = now
      const zoom = selectCanvasZoom(runtime.store.getState())
      if (event.deltaY > 0 && zoom >= 30) runtime.store.dispatch(editorActions.canvasZoomChanged(zoom - 5))
      else if (event.deltaY < 0 && zoom <= 200) runtime.store.dispatch(editorActions.canvasZoomChanged(zoom + 5))
      return
    }
    if (now - lastSlideWheelAtRef.current < 300) return
    lastSlideWheelAtRef.current = now
    const { slideIndex, slides } = runtime.store.getState().presentation
    if (event.deltaY > 0 && slideIndex < slides.length - 1) {
      flushCurrentTableMeasurements()
      navigateWithSlideTransition(() => runtime.focusSlide(slideIndex + 1))
    }
    else if (event.deltaY < 0 && slideIndex > 0) {
      flushCurrentTableMeasurements()
      navigateWithSlideTransition(() => runtime.focusSlide(slideIndex - 1))
    }
  }

  // useEffectEvent replaces the manual ref-mirroring pattern: the long-lived
  // native listeners below always observe the latest render's handlers.
  const dispatchDocumentKeyDown = useEffectEvent((event: KeyboardEvent) => handleKeyDown(event))
  const dispatchDocumentPaste = useEffectEvent((event: ClipboardEvent) => handlePaste(event))
  const dispatchStageWheel = useEffectEvent((event: WheelEvent) => handleWheel(event))

  useLayoutEffect(() => {
    if (interactionProfile === 'mobile') return undefined
    const listener = (event: KeyboardEvent) => dispatchDocumentKeyDown(event)
    document.addEventListener('keydown', listener)
    return () => document.removeEventListener('keydown', listener)
  }, [interactionProfile])

  useLayoutEffect(() => {
    if (interactionProfile === 'mobile') return undefined
    const listener = (event: ClipboardEvent) => dispatchDocumentPaste(event)
    document.addEventListener('paste', listener)
    return () => document.removeEventListener('paste', listener)
  }, [interactionProfile])

  // Unmounting mid-gesture (e.g. F5 slideshow during a drag) must not leave
  // the shared interaction controller publishing phantom pointer updates.
  useEffect(() => () => {
    runtime.interaction.cancel()
  }, [runtime])

  // Vue prevents the browser's default file-drop navigation across the whole
  // document while the editor is mounted; without this a dropped file
  // replaces the editor page.
  useEffect(() => {
    if (interactionProfile === 'mobile') return undefined
    const prevent = (event: DragEvent) => event.preventDefault()
    document.addEventListener('dragenter', prevent)
    document.addEventListener('dragleave', prevent)
    document.addEventListener('dragover', prevent)
    document.addEventListener('drop', prevent)
    return () => {
      document.removeEventListener('dragenter', prevent)
      document.removeEventListener('dragleave', prevent)
      document.removeEventListener('dragover', prevent)
      document.removeEventListener('drop', prevent)
    }
  }, [interactionProfile])

  // React's root-delegated onWheel listener is passive, so preventDefault()
  // inside it cannot stop browser page zoom (ctrl+wheel) or ancestor scroll.
  // The canvas needs a native non-passive listener.
  const hasCurrentSlide = Boolean(selectedCurrentSlide)
  useEffect(() => {
    if (interactionProfile === 'mobile' || !hasCurrentSlide) return undefined
    const stage = stageRef.current
    if (!stage) return undefined
    const listener = (event: WheelEvent) => dispatchStageWheel(event)
    stage.addEventListener('wheel', listener, { passive: false })
    return () => stage.removeEventListener('wheel', listener)
  }, [interactionProfile, hasCurrentSlide])

  const closeLinkEditor = () => {
    runtime.store.dispatch(editorActions.hotkeysDisabledChanged(false))
    setLinkEditor(null)
  }

  const applyLink = () => {
    if (!linkEditor) return
    const target = linkEditor.type === 'web' ? linkEditor.address : linkEditor.slideId
    if (linkEditor.type === 'web') {
      const linkPattern = /^(https?):\/\/[\w-]+(\.[\w-]+)+([\w-.,@?^=%&:/~+#]*[\w-@?^=%&/~+#])?$/
      if (!linkPattern.test(target)) {
        setLinkEditor({ ...linkEditor, address: '' })
        setNotices(current => [...current, { id: ++noticeIdRef.current, text: t('foundation.editor.link.invalid'), type: 'error' }])
        return
      }
    }
    else if (!target) {
      setNotices(current => [...current, { id: ++noticeIdRef.current, text: t('foundation.editor.link.selectTarget'), type: 'error' }])
      return
    }
    runtime.commit('Set element link', [{
      type: 'element.update',
      payload: {
        id: linkEditor.elementId,
        props: { link: { type: linkEditor.type, target } },
      },
    }])
    closeLinkEditor()
  }

  const frameWidth = presentation.viewportSize * scale
  const frameHeight = presentation.viewportSize * presentation.viewportRatio * scale

  if (!selectedCurrentSlide) return <section className="mona-render-stage">{t('foundation.editor.noSlides')}</section>

  return (
    <section
      aria-label={t('foundation.editor.canvas')}
      className={`mona-render-stage mona-editor-stage${canvasFocus ? ' has-focus' : ''}${activeTool ? ' is-creating' : ''}${isSpacePressed ? ' is-panning' : ''}`}
      data-active-tool={activeTool?.key ?? 'select'}
      onDoubleClick={interactionProfile === 'mobile' ? undefined : event => {
        if ((event.target as HTMLElement).closest('[data-element-hit]')) return
        if (activeElementIds.length) return
        if (!activeTool) createTextAtPoint(inputPoint(event.nativeEvent))
      }}
      onKeyUp={interactionProfile === 'mobile' ? undefined : event => {
        if (event.key === ' ') {
          spacePressedRef.current = false
          setIsSpacePressed(false)
        }
      }}
      onFocus={interactionProfile === 'mobile' ? undefined : () => {
        runtime.store.dispatch(editorActions.canvasFocusChanged(true))
        runtime.store.dispatch(editorActions.thumbnailsFocusChanged(false))
      }}
      onDrop={interactionProfile === 'mobile' ? undefined : handleDrop}
      onPointerCancel={cancelGesture}
      onPointerDown={handleBlankPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishGesture}
      onContextMenu={interactionProfile === 'mobile' ? undefined : event => {
        event.preventDefault()
        if (activeTool) {
          onCreateToolChange(null)
          setMenu(null)
          return
        }
        stageRef.current?.focus()
        setMenu({ position: { x: event.clientX, y: event.clientY }, surface: 'canvas' })
      }}
      ref={stageRef}
      role={interactionProfile === 'mobile' ? undefined : 'application'}
      tabIndex={interactionProfile === 'mobile' ? undefined : 0}
    >
      {viewportFit.dimension > 0 ? (
        <div
          className="mona-editor-viewport-frame"
          ref={frameRef}
          style={{
            width: frameWidth,
            height: frameHeight,
            position: 'absolute',
            left: ((viewportFit.width - frameWidth) / 2) + pan.x,
            top: ((viewportFit.height - frameHeight) / 2) + pan.y,
          }}
        >
          {gridLineSize ? (
            <svg
              aria-hidden="true"
              className="mona-editor-grid"
            >
              <path
                d={buildEditorGridPath(presentation.viewportSize, presentation.viewportRatio, gridLineSize)}
                fill="none"
                stroke={tinycolor.mostReadable(
                  currentSlide.background?.color || '#fff',
                  ['#000', '#fff'],
                  { includeFallbackColors: true },
                ).setAlpha(0.5).toRgbString()}
                strokeDasharray="5"
                strokeWidth="0.3"
                style={{ transform: `scale(${scale})` }}
              />
            </svg>
          ) : null}
          {preview.guides.map((guide, index) => (
            <i
              aria-hidden="true"
              className={`mona-alignment-guide is-${guide.orientation}`}
              key={`${guide.orientation}-${guide.axis}-${index}`}
              style={guide.orientation === 'horizontal'
                ? {
                  left: guide.from * scale,
                  top: guide.axis * scale,
                  width: (guide.to - guide.from) * scale,
                  height: 0,
                }
                : {
                  left: guide.axis * scale,
                  top: guide.from * scale,
                  width: 0,
                  height: (guide.to - guide.from) * scale,
                }}
            />
          ))}
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
              mediaEditor={element => ({
                active: session.handleElementId === element.id,
                onContextMenu: event => handleElementContextMenu(event, element),
                onPointerDown: (event, canMove) => handleMediaPointerDown(event, element, canMove),
                scale,
                viewportRatio: presentation.viewportRatio,
                viewportSize: presentation.viewportSize,
              })}
              shapeEditor={element => ({
                ariaLabel: t('foundation.editor.selectElement', { type: element.name || element.type, id: element.id }),
                content: element.text?.content || shapeTextEditorId === element.id
                  ? (
                    <EditorRichText
                      element={element}
                      fallbackColor={presentation.theme.fontColor}
                      fallbackFontName={presentation.theme.fontName}
                      isHandleElement={session.handleElementId === element.id}
                      modifierPressed={() => ctrlOrMetaPressedRef.current || shiftPressedRef.current}
                      onMouseDown={event => handleTextEditorMouseDown(event, element)}
                      runtime={runtime}
                    />
                  )
                  : undefined,
                onContextMenu: event => handleElementContextMenu(event, element),
                onDoubleClick: event => {
                  event.stopPropagation()
                  if (element.lock) return
                  setShapeTextEditorId(element.id)
                  requestAnimationFrame(() => {
                    document.querySelector<HTMLElement>(`[data-element-id="${CSS.escape(element.id)}"] .ProseMirror`)?.focus()
                  })
                },
                onPointerDown: event => handleElementPointerDown(event, element),
                onPointerUp: () => runtime.shapeFormatPainter.apply(element),
              })}
              slide={renderedSlide}
              tableEditor={element => ({
                editable: tableEditorId === element.id,
                isHandle: session.handleElementId === element.id,
                scale,
                selectedCells: session.selectedTableCells,
                onContextMenu: (event, row, column) => handleTableCellContextMenu(event, element, row, column),
                onElementChange: (next, label) => {
                  runtime.commit(label, [{
                    type: 'element.update',
                    payload: {
                      id: next.id,
                      props: {
                        data: next.data,
                        width: next.width,
                        colWidths: next.colWidths,
                      },
                    },
                  }])
                },
                onHeightChange: height => runtime.commit('Measure table element', [{
                  type: 'element.update', payload: { id: element.id, props: { height } },
                }], { recordHistory: false }),
                onPointerDown: event => handleElementPointerDown(event, element),
                onSelectedCellsChange: cells => runtime.store.dispatch(editorActions.selectedTableCellsChanged(cells)),
                onStartEdit: () => {
                  setTableEditorId(element.id)
                  runtime.store.dispatch(editorActions.hotkeysDisabledChanged(true))
                },
              })}
              textEditor={element => ({
                content: (
                  <EditorRichText
                    element={element}
                    isHandleElement={session.handleElementId === element.id}
                    modifierPressed={() => ctrlOrMetaPressedRef.current || shiftPressedRef.current}
                    onMouseDown={event => handleTextEditorMouseDown(event, element)}
                    runtime={runtime}
                  />
                ),
                onContextMenu: event => handleElementContextMenu(event, element),
                onPointerDown: event => handleElementPointerDown(event, element),
              })}
              theme={presentation.theme}
              viewportRatio={presentation.viewportRatio}
              viewportSize={presentation.viewportSize}
            />
            {cropSourceImage ? (
              <EditorImageCropEditor
                element={cropSourceImage}
                geometry={cropGeometry}
                onCropPointerDown={beginCrop}
              />
            ) : null}
            {previewSlide.elements.map((element, index) => {
              if (element.id === cropElementId) return null
              if (element.type === 'text' || element.type === 'shape' || element.type === 'table' || element.type === 'video' || element.type === 'audio') return null
              const bounds = element.type === 'line' ? getElementBounds(element) : undefined
              return (
                <button
                  aria-label={t('foundation.editor.selectElement', { type: element.name || element.type, id: element.id })}
                  className="mona-element-hit-target"
                  data-element-hit={element.id}
                  key={element.id}
                  onContextMenu={event => handleElementContextMenu(event, element)}
                  onDoubleClick={event => {
                    event.stopPropagation()
                    if (element.type === 'chart' && !element.lock) onEditChart(element.id)
                    if (element.type === 'latex' && !element.lock) onEditLatex(element.id)
                  }}
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
            {preview.lasso ? <div className="mona-lasso-selection" style={preview.lasso} /> : null}
          </div>
          <div className="mona-editor-operation-layer">
            <EditorSelectionOverlay
              activeGroupElementId={session.activeGroupElementId}
              cropElementId={cropElementId}
              elements={mobileInteraction ? selectedElements.filter(element => element.type !== 'line') : selectedElements}
              handleElementId={session.handleElementId}
              interactionProfile={interactionProfile}
              onLinePointerDown={beginLinePoint}
              onResizePointerDown={beginResize}
              onRotatePointerDown={beginRotate}
              onShapeKeypointPointerDown={beginShapeKeypoint}
              scale={scale}
            />
            <div className="mona-editor-float-layer">
              {!mobileInteraction && session.toolbarState === 'elAnimation' ? (() => {
                // Vue overlays 1-based animation order badges on every
                // animated element while the animation panel is open.
                const formatted = selectFormattedCurrentSlideAnimations(presentation)
                return currentSlide.elements.map(element => {
                  if (session.hiddenElementIds.includes(element.id)) return null
                  const indexList = formatted.flatMap((group, index) => (
                    group.animations.some(animation => animation.elId === element.id) ? [index] : []
                  ))
                  if (!indexList.length) return null
                  const range = getElementBounds(element)
                  return (
                    <div className="mona-animation-index" key={element.id} style={{ left: range.minX * scale - 24, top: range.minY * scale }}>
                      {indexList.map(index => <div className="mona-animation-index-item" key={index}>{index + 1}</div>)}
                    </div>
                  )
                })
              })() : null}
              {!mobileInteraction && session.showBubbleMenu && (() => {
                const targetId = session.activeGroupElementId || (activeElementIds.length === 1 ? activeElementIds[0] : null)
                // Vue suppresses the floating toolbar for hidden elements
                // ("hide all" keeps them selected).
                const visibleTargetId = targetId && !session.hiddenElementIds.includes(targetId) ? targetId : null
                const target = visibleTargetId ? currentSlide.elements.find(element => element.id === visibleTargetId) : undefined
                return target?.type === 'text' ? (
                  <EditorFloatingTextToolbar element={target} frameRef={frameRef} runtime={runtime} scale={scale} stageRef={stageRef} />
                ) : target?.type === 'shape' || target?.type === 'line' ? (
                  <EditorFloatingElementToolbar element={target} frameRef={frameRef} presentation={presentation} runtime={runtime} scale={scale} stageRef={stageRef} />
                ) : target?.type === 'image' ? (
                  <EditorFloatingImageToolbar element={target} frameRef={frameRef} runtime={runtime} scale={scale} stageRef={stageRef} />
                ) : target?.type === 'table' ? (
                  <EditorFloatingTableToolbar element={target} frameRef={frameRef} presentation={presentation} runtime={runtime} scale={scale} selectedCells={session.selectedTableCells} stageRef={stageRef} />
                ) : target?.type === 'chart' ? (
                  <EditorFloatingChartToolbar element={target} frameRef={frameRef} onEditData={() => onEditChart(target.id)} runtime={runtime} scale={scale} stageRef={stageRef} />
                ) : target?.type === 'latex' ? (
                  <EditorFloatingLatexToolbar element={target} frameRef={frameRef} onEdit={() => onEditLatex(target.id)} runtime={runtime} scale={scale} stageRef={stageRef} />
                ) : null
              })()}
              {!mobileInteraction ? (() => {
                // Vue shows an open/change/remove hyperlink bubble under the
                // handle element whenever it carries a link.
                const linkElement = session.handleElementId && !session.hiddenElementIds.includes(session.handleElementId)
                  ? currentSlide.elements.find(element => element.id === session.handleElementId)
                  : undefined
                if (!linkElement?.link) return null
                const toolbarTargetId = session.activeGroupElementId || (activeElementIds.length === 1 ? activeElementIds[0] : null)
                const toolbarVisible = Boolean(
                  session.showBubbleMenu &&
                  toolbarTargetId === linkElement.id &&
                  linkElement.type !== 'video' && linkElement.type !== 'audio',
                )
                return (
                  <EditorFloatingLinkHandler
                    element={linkElement}
                    frameRef={frameRef}
                    key={linkElement.id}
                    onChangeLink={() => openLinkEditorFor(linkElement)}
                    runtime={runtime}
                    scale={scale}
                    stageRef={stageRef}
                    toolbarVisible={toolbarVisible}
                  />
                )
              })() : null}
            </div>
          </div>
        </div>
      ) : null}
      {activeTool ? (
        <div aria-hidden="true" className="mona-element-create-selection">
          {preview.createRect ? (
            <div
              className={`mona-create-selection is-${activeTool.type}`}
              style={{
                ...preview.createRect,
                height: activeTool.type === 'line' ? Math.max(preview.createRect.height, 24) : preview.createRect.height,
                width: activeTool.type === 'line' ? Math.max(preview.createRect.width, 24) : preview.createRect.width,
              }}
            >
              {activeTool.type === 'line' && preview.createLinePath ? (
                <svg height={Math.max(preview.createRect.height, 24)} overflow="visible" width={Math.max(preview.createRect.width, 24)}>
                  <path d={preview.createLinePath} fill="none" stroke="#d14424" strokeWidth="2" />
                </svg>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {customShapeActive ? (
        <EditorCustomShapeCreator
          color={presentation.theme.themeColors[0] ?? '#d14424'}
          onCancel={() => onCustomShapeChange(false)}
          onCreated={result => {
            const element: PPTShapeElement = {
              id: createPresentationId(),
              type: 'shape',
              left: result.left,
              top: result.top,
              width: result.width,
              height: result.height,
              rotate: 0,
              fixedRatio: false,
              viewBox: result.viewBox,
              path: result.path,
              fill: result.fill ?? presentation.theme.themeColors[0] ?? '#d14424',
              ...(result.outline ? { outline: result.outline } : {}),
            }
            if (runtime.commit('Create custom shape', [{ type: 'element.add', elements: element }])) {
              runtime.store.dispatch(editorActions.selectionChanged([element.id]))
            }
          }}
          scale={scale}
          stageRef={stageRef}
          viewportRef={canvasRef}
        />
      ) : null}
      {isSpacePressed ? <div aria-hidden="true" className="mona-drag-mask" /> : null}
      {viewportFit.dimension > 0 && showRuler ? (
        <EditorRulers
          frameHeight={frameHeight}
          frameWidth={frameWidth}
          height={presentation.viewportSize * presentation.viewportRatio}
          pan={pan}
          scale={scale}
          selection={selectionBounds}
          width={presentation.viewportSize}
        />
      ) : null}
      {menu ? (
        <EditorContextMenu
          canDeleteTableColumn={menuElement?.type === 'table' ? canDeleteTableAxis(menuElement).column : false}
          canDeleteTableRow={menuElement?.type === 'table' ? canDeleteTableAxis(menuElement).row : false}
          canGroup={activeElementIds.length > 1}
          canMergeTableCells={menu?.surface === 'table-cell' && session.selectedTableCells.length > 1}
          canOrder={activeElementIds.length <= 1 || !!menuElement?.groupId}
          canPaste={!!runtime.getClipboardText() || !!navigator.clipboard}
          canSplitTableCell={menuElement?.type === 'table' && !!menu.cell && session.selectedTableCells.length <= 1 && (() => {
            const cell = menuElement.data[menu.cell.row]?.[menu.cell.column]
            return !!cell && (cell.rowspan > 1 || cell.colspan > 1)
          })()}
          gridLineSize={gridLineSize}
          grouped={!!menuElement?.groupId}
          locked={!!menuElement?.lock}
          onAction={handleContextAction}
          onDismiss={() => setMenu(null)}
          position={menu.position}
          showBubbleMenu={session.showBubbleMenu}
          showRuler={showRuler}
          surface={menu.surface}
        />
      ) : null}
      {linkEditor ? (
        <LinkEditor
          address={linkEditor.address}
          linkType={linkEditor.type}
          onCancel={closeLinkEditor}
          onAddressChange={address => setLinkEditor({ ...linkEditor, address })}
          onSlideChange={slideId => setLinkEditor({ ...linkEditor, slideId })}
          onSubmit={applyLink}
          onTypeChange={type => setLinkEditor({ ...linkEditor, type })}
          slideId={linkEditor.slideId}
          slideOptions={presentation.slides.map((slide, index) => ({
            disabled: slide.id === currentSlide.id,
            id: slide.id,
            label: t('foundation.editor.link.slideOption', { number: index + 1 }),
          }))}
          slides={presentation.slides}
          theme={presentation.theme}
          viewportRatio={presentation.viewportRatio}
          viewportSize={presentation.viewportSize}
        />
      ) : null}
      <EditorNoticeStack notices={notices} onClose={id => setNotices(current => current.filter(notice => notice.id !== id))} />
      <span aria-live="polite" className="mona-editor-status">
        {activeTool
          ? t('foundation.editor.creationToolActive', { tool: t(`foundation.editor.tool.${activeTool.key}`) })
          : t('foundation.editor.selection', { count: selectedElements.length })}
      </span>
    </section>
  )
}
