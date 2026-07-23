import { describe, expect, it } from 'vitest'
import { createTestPresentation } from '@mona/test-fixtures'
import { createPresentationTransaction } from '@mona/presentation-core'
import {
  createEditorStore,
  editorActions,
  makeSelectElementById,
  selectElementIndex,
} from './index'

describe('canonical editor state adapter', () => {
  it('applies one semantic transaction and preserves unrelated references', () => {
    const store = createEditorStore({ presentation: createTestPresentation() })
    const previous = store.getState()
    const selectUnchangedElement = makeSelectElementById('fixture-shape-2')
    const unchangedElement = selectUnchangedElement(previous)
    const index = selectElementIndex(previous)

    store.dispatch(editorActions.transactionCommitted(createPresentationTransaction({
      id: 'tx-update',
      label: 'Move one element',
      origin: 'test',
      commands: [{
        type: 'element.update',
        payload: { id: 'fixture-shape-1', props: { left: 444 } },
      }],
    })))

    const next = store.getState()
    expect(next.presentation.slides[0]).not.toBe(previous.presentation.slides[0])
    expect(next.presentation.slides[1]).toBe(previous.presentation.slides[1])
    expect(selectUnchangedElement(next)).toBe(unchangedElement)
    expect(selectElementIndex(next)).not.toBe(index)
    expect(next.lastAppliedTransactionId).toBe('tx-update')
  })

  it('does not rebuild the element index for title-only changes', () => {
    const store = createEditorStore({ presentation: createTestPresentation() })
    const index = selectElementIndex(store.getState())
    store.dispatch(editorActions.transactionCommitted(createPresentationTransaction({
      id: 'tx-title',
      label: 'Rename',
      origin: 'test',
      commands: [{
        type: 'presentation.title.set',
        title: 'New title',
        fallbackTitle: 'Untitled presentation',
      }],
    })))
    expect(selectElementIndex(store.getState())).toBe(index)
  })

  it('rejects invalid transactions without changing the live presentation', () => {
    const store = createEditorStore({ presentation: createTestPresentation() })
    const presentation = store.getState().presentation
    store.dispatch(editorActions.transactionCommitted(createPresentationTransaction({
      id: 'tx-invalid',
      label: 'Duplicate ID',
      origin: 'test',
      commands: [{ type: 'slide.add', slides: { id: 'fixture-slide-1', elements: [] } }],
    })))
    expect(store.getState().presentation).toBe(presentation)
    expect(store.getState().lastRejectedTransaction?.transactionId).toBe('tx-invalid')
  })

  it('keeps viewport and editing focus in session state', () => {
    const store = createEditorStore({ presentation: createTestPresentation() })
    const presentation = store.getState().presentation
    expect(store.getState().session.canvasZoom).toBe(90)
    store.dispatch(editorActions.canvasZoomChanged(135))
    store.dispatch(editorActions.canvasPanChanged({ x: 24, y: -12 }))
    store.dispatch(editorActions.canvasDraggedChanged(true))
    store.dispatch(editorActions.canvasFocusChanged(true))
    store.dispatch(editorActions.thumbnailsFocusChanged(true))
    store.dispatch(editorActions.hotkeysDisabledChanged(true))
    store.dispatch(editorActions.gridLineSizeChanged(50))
    store.dispatch(editorActions.rulerVisibilityChanged(true))
    store.dispatch(editorActions.drawingModeChanged(true))
    store.dispatch(editorActions.sketchesVisibilityChanged(false))

    expect(store.getState().session).toMatchObject({
      canvasZoom: 135,
      canvasPan: { x: 24, y: -12 },
      canvasDragged: true,
      canvasFocus: true,
      thumbnailsFocus: true,
      disableHotkeys: true,
      gridLineSize: 50,
      showRuler: true,
      drawingMode: true,
      sketchesVisible: false,
    })
    expect(store.getState().presentation).toBe(presentation)
  })

  it('clamps canvas zoom to the supported command extrema', () => {
    const store = createEditorStore({ presentation: createTestPresentation() })
    store.dispatch(editorActions.canvasZoomChanged(500))
    expect(store.getState().session.canvasZoom).toBe(300)
    store.dispatch(editorActions.canvasZoomChanged(-500))
    expect(store.getState().session.canvasZoom).toBe(10)
  })

  it('restores history atomically and preserves still-valid document selection', () => {
    const initial = createTestPresentation()
    const store = createEditorStore({ presentation: initial })
    store.dispatch(editorActions.selectionChanged(['fixture-shape-1']))
    store.dispatch(editorActions.transactionCommitted(createPresentationTransaction({
      id: 'tx-history-target',
      label: 'Move before restore',
      origin: 'test',
      commands: [{
        type: 'element.update',
        payload: { id: 'fixture-shape-1', props: { left: 777 } },
      }],
    })))

    store.dispatch(editorActions.historyRestored(initial))
    expect(store.getState().presentation).toBe(initial)
    expect(store.getState().session.activeElementIds).toEqual(['fixture-shape-1'])
    expect(store.getState().lastAppliedTransactionId).toBeNull()
  })
})
