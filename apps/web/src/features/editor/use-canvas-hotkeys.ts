import { useRef, type RefObject } from 'react'

import {
  editorActions,
  selectCanvasZoom,
  selectCurrentSlide,
  selectPresentation,
  selectSession,
} from '@mona/editor-state'
import { LINE_LIST, SHAPE_LIST, type PresentationCommand } from '@mona/presentation-core'
import type { PPTElement } from '@mona/presentation-core/model'

import { EMPTY_EDITOR_SLIDE, isTextInput } from '@/features/editor/editor-canvas-preview'
import type { EditorCreateTool } from '@/features/editor/editor-create-tool'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { navigateWithSlideTransition } from '@/features/editor/editor-view-transition'

// Keyboard shortcuts and stage-wheel navigation for the slide canvas, split
// from EditorCanvas by input domain. The handlers mirror Vue's useKeyboard /
// useScreening wheel semantics exactly; EditorCanvas bridges them onto
// document/stage listeners through useEffectEvent.

export const writeClipboard = async (serialized: string | undefined) => {
  if (!serialized || !navigator.clipboard) return
  try {
    await navigator.clipboard.writeText(serialized)
}
  catch { /* Native clipboard events and the in-memory fallback remain available. */ }
}

export function useCanvasHotkeys({
  commitElementLockChange,
  ctrlOrMetaPressedRef,
  deleteCurrentSelection,
  finishCropEditing,
  flushCurrentTableMeasurements,
  handleContextAction,
  isCropping,
  onCreateToolChange,
  runtime,
  setIsSpacePressed,
  spacePressedRef,
}: {
  commitElementLockChange: (input: {
    action: 'lock' | 'unlock'
    elements: readonly PPTElement[]
    selectedIds: readonly string[]
    targetElementId?: string
  }) => boolean
  ctrlOrMetaPressedRef: RefObject<boolean>
  deleteCurrentSelection: () => boolean
  finishCropEditing: (commit: boolean) => void
  flushCurrentTableMeasurements: () => void
  handleContextAction: (action: string) => void
  isCropping: () => boolean
  onCreateToolChange: (tool: EditorCreateTool) => void
  runtime: EditorRuntime
  setIsSpacePressed: (pressed: boolean) => void
  spacePressedRef: RefObject<boolean>
}) {
  const lastUndoAtRef = useRef(Number.NEGATIVE_INFINITY)
  const lastRedoAtRef = useRef(Number.NEGATIVE_INFINITY)
  const lastSlideWheelAtRef = useRef(Number.NEGATIVE_INFINITY)
  const lastZoomWheelAtRef = useRef(Number.NEGATIVE_INFINITY)

  const nudgeSelection = (elements: readonly PPTElement[], x: number, y: number) => {
    const commands: PresentationCommand[] = elements.map(element => ({
      type: 'element.update',
      payload: { id: element.id, props: { left: element.left + x, top: element.top + y } },
    }))
    runtime.commit('Nudge elements', commands)
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
    if (liveSession.drawingMode) return
    if (isCropping() && event.key === 'Enter') {
      event.preventDefault()
      finishCropEditing(true)
      return
    }
    // A shape's embedded ProseMirror can retain DOM focus after Shift-click
    // creates a multi-selection. the source editor still handles canvas shortcuts in
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
    // The horizontal filmstrip also steps on Left/Right; on the canvas those
    // stay unbound (with nothing selected) exactly as before.
    const stepsSlides = event.key === 'ArrowUp' || event.key === 'ArrowDown'
      || (liveSession.thumbnailsFocus && (event.key === 'ArrowLeft' || event.key === 'ArrowRight'))
    if (stepsSlides && !liveSelectedElements.length) {
      event.preventDefault()
      const index = livePresentation.slideIndex + (event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1)
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
  return { handleKeyDown, handleWheel }
}
