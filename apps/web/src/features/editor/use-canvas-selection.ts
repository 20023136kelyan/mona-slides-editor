import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'

import { editorActions, selectCurrentSlide, selectSession } from '@mona/editor-state'
import type { PPTElement, PPTShapeElement, PPTTextElement } from '@mona/presentation-core/model'

import { EMPTY_EDITOR_SLIDE } from '@/features/editor/editor-canvas-preview'
import type { EditorRuntime } from '@/features/editor/editor-runtime'

/**
 * Pointer handling that only settles selection — media and text surfaces,
 * plus the shared `selectElement` primitive. Handlers that also start a drag
 * (element and blank-canvas) stay with the gesture code, since they need the
 * gesture primitives; this split keeps that dependency out of here.
 */
export function useCanvasSelection({
  finishCropEditing,
  onElementPointerDown,
  runtime,
  spacePressedRef,
  stageRef,
}: {
  finishCropEditing: (commit: boolean) => void
  onElementPointerDown: (event: ReactPointerEvent<HTMLElement>, element: PPTElement) => void
  runtime: EditorRuntime
  spacePressedRef: RefObject<boolean>
  stageRef: RefObject<HTMLElement | null>
}) {
  const focusCanvas = () => {
    stageRef.current?.focus()
    runtime.store.dispatch(editorActions.canvasFocusChanged(true))
    runtime.store.dispatch(editorActions.thumbnailsFocusChanged(false))
  }

  const selectElement = (event: Pick<MouseEvent, 'ctrlKey' | 'metaKey' | 'shiftKey'>, element: PPTElement) => {
    const liveState = runtime.store.getState()
    const liveSession = selectSession(liveState)
    const liveSlide = selectCurrentSlide(liveState) ?? EMPTY_EDITOR_SLIDE
    const liveElement = liveSlide.elements.find(item => item.id === element.id) ?? element
    const liveActiveElementIds = liveSession.activeElementIds
    if (liveSession.cropElementId) finishCropEditing(true)
    const modifier = event.ctrlKey || event.metaKey || event.shiftKey
    const groupMemberIds = liveElement.groupId
      ? liveSlide.elements.filter(item => item.groupId === liveElement.groupId).map(item => item.id)
      : [liveElement.id]
    // the source editor seeds a grouped selection with the element that was actually
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

  const handleMediaPointerDown = (event: ReactPointerEvent<HTMLElement>, element: PPTElement, canMove: boolean) => {
    if (canMove) {
      onElementPointerDown(event, element)
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
    focusCanvas()
    if (!liveSession.activeElementIds.includes(liveElement.id)) selectElement(event, liveElement)
    else if (event.ctrlKey || event.metaKey || event.shiftKey) selectElement(event, liveElement)
    else if (liveSession.handleElementId !== liveElement.id) {
      runtime.store.dispatch(editorActions.handleElementChanged(liveElement.id))
      runtime.store.dispatch(editorActions.activeGroupElementChanged(null))
    }
    if (liveSession.cropElementId) finishCropEditing(true)
  }

  const handleTextEditorMouseDown = (event: MouseEvent, element: PPTShapeElement | PPTTextElement) => {
    const liveRootState = runtime.store.getState()
    const liveSlide = selectCurrentSlide(liveRootState) ?? EMPTY_EDITOR_SLIDE
    const liveElement = liveSlide.elements.find((item): item is PPTShapeElement | PPTTextElement => (
      item.id === element.id && (item.type === 'text' || item.type === 'shape')
    )) ?? element
    if (liveElement.lock) return
    event.stopPropagation()
    focusCanvas()
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
      // Entering a group requires a click that did not move: a drag on an
      // already-active element is a move, not a step into the group.
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

  return { handleMediaPointerDown, handleTextEditorMouseDown, selectElement }
}
