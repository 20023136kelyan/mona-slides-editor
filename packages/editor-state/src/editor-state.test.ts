import { describe, expect, it } from 'vitest'
import { createGate2Presentation } from '@mona/parity-fixtures'
import { createPresentationTransaction } from '@mona/presentation-core'
import {
  createEditorStore,
  editorActions,
  makeSelectElementById,
  selectElementIndex,
} from './index'

describe('canonical editor state adapter', () => {
  it('applies one semantic transaction and preserves unrelated references', () => {
    const store = createEditorStore({ presentation: createGate2Presentation() })
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
    const store = createEditorStore({ presentation: createGate2Presentation() })
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
    const store = createEditorStore({ presentation: createGate2Presentation() })
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
})
