import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'

import { editorActions } from '@mona/editor-state'
import type { PresentationState } from '@mona/presentation-core'
import type { PPTElement, Slide } from '@mona/presentation-core/model'
import type { EditorSessionState } from '@mona/editor-state'
import type { PointerPosition } from '@mona/editor-interactions'

import { rectToBounds } from '@mona/editor-interactions/geometry'

import {
  createElementFromGesture,
  derivePreview,
  exceedsActivationDistance,
  toCommands,
  TRANSFORM_ACTIVATION_DISTANCE,
  type CropDraft,
  type GestureContext,
} from '@/features/editor/editor-canvas-preview'
import {
  getLassoSelectionIds,
  resolveCreateGestureSelection,
} from '@/features/editor/editor-geometry'
import type { EditorRuntime } from '@/features/editor/editor-runtime'

export interface CommitGestureContext {
  canvasRef: RefObject<HTMLDivElement | null>
  currentSlide: Slide
  gestureRef: RefObject<GestureContext | null>
  inputPoint: (event: Pick<PointerEvent, 'clientX' | 'clientY'>) => PointerPosition
  onCreateToolChange: (tool: null) => void
  presentation: PresentationState
  rawGestureOriginRef: RefObject<PointerPosition | null>
  runtime: EditorRuntime
  session: EditorSessionState
  setGestureContext: (context: GestureContext | null) => void
  updateCropDraft: (draft: CropDraft | null) => void
}

/**
 * Commits whatever gesture just ended. Each `context.kind` branch owns how its
 * gesture turns into document commands - text and table resizes measure the
 * rendered DOM first, because their final height is only known after layout.
 *
 * Extracted as a plain function: it holds no state of its own, so the pieces
 * of canvas state it needs arrive explicitly rather than by closure.
 */
export function commitCanvasGesture(event: ReactPointerEvent<HTMLElement>, deps: CommitGestureContext) {
  const {
    canvasRef, currentSlide, gestureRef, inputPoint, onCreateToolChange,
    presentation, rawGestureOriginRef, runtime, session, setGestureContext, updateCropDraft,
  } = deps
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
      // Quirk retired: the source editor recorded a history snapshot for sub-threshold
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
      // Quirk retired: the source editor recorded a duplicate snapshot when the handle
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
