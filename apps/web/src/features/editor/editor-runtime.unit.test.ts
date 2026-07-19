import { describe, expect, it } from 'vitest'

import { editorActions } from '@mona/editor-state'
import type { PresentationState } from '@mona/presentation-core'

import { createEditorRuntime } from '@/features/editor/editor-runtime'

const presentation: PresentationState = {
  title: 'Editor runtime fixture',
  slides: [{
    id: 'slide-1',
    elements: [
      {
        id: 'shape-1',
        groupId: 'group-1',
        type: 'shape',
        left: 20,
        top: 30,
        width: 100,
        height: 80,
        rotate: 0,
        fixedRatio: false,
        viewBox: [100, 80],
        path: 'M0 0 H100 V80 H0 Z',
        fill: '#d14424',
      },
      {
        id: 'shape-2',
        groupId: 'group-1',
        type: 'shape',
        left: 160,
        top: 30,
        width: 100,
        height: 80,
        rotate: 0,
        fixedRatio: false,
        viewBox: [100, 80],
        path: 'M0 0 H100 V80 H0 Z',
        fill: '#22577a',
      },
    ],
  }],
  slideIndex: 0,
  viewportSize: 1000,
  viewportRatio: 0.5625,
  theme: {
    themeColors: [],
    fontColor: '#000',
    fontName: 'Arial',
    backgroundColor: '#fff',
    shadow: { h: 0, v: 0, blur: 0, color: '#000' },
    outline: { width: 1, color: '#000', style: 'solid' },
  },
  templates: [],
}

describe('editor runtime', () => {
  it('commits an atomic change and restores it through undo and redo', () => {
    const runtime = createEditorRuntime(presentation)
    expect(runtime.commit('Move', [{
      type: 'element.update',
      payload: { id: 'shape-1', props: { left: 90 } },
    }])).toBe(true)
    expect(runtime.store.getState().presentation.slides[0]?.elements[0]?.left).toBe(90)
    expect(runtime.canUndo()).toBe(true)

    expect(runtime.undo()).toBe(true)
    expect(runtime.store.getState().presentation.slides[0]?.elements[0]?.left).toBe(20)
    expect(runtime.redo()).toBe(true)
    expect(runtime.store.getState().presentation.slides[0]?.elements[0]?.left).toBe(90)
  })

  it('copies and pastes selected groups with fresh element and group IDs', () => {
    const runtime = createEditorRuntime(presentation)
    runtime.store.dispatch(editorActions.selectionChanged(['shape-1', 'shape-2']))
    const serialized = runtime.copySelection()
    const ids = runtime.paste(serialized)
    const elements = runtime.store.getState().presentation.slides[0]?.elements ?? []
    const pasted = elements.filter(element => ids.includes(element.id))

    expect(ids).toHaveLength(2)
    expect(new Set(ids).has('shape-1')).toBe(false)
    expect(pasted[0]?.groupId).toBe(pasted[1]?.groupId)
    expect(pasted[0]?.groupId).not.toBe('group-1')
    expect(pasted[0]?.left).toBe(40)
    expect(runtime.store.getState().session.activeElementIds).toEqual(ids)
  })

  it('cuts selection as one history entry and selects all unlocked elements', () => {
    const runtime = createEditorRuntime(presentation)
    runtime.selectAll()
    expect(runtime.store.getState().session.activeElementIds).toEqual(['shape-1', 'shape-2'])
    expect(runtime.cutSelection()).toBeTypeOf('string')
    expect(runtime.store.getState().presentation.slides[0]?.elements).toEqual([])
    expect(runtime.undo()).toBe(true)
    expect(runtime.store.getState().presentation.slides[0]?.elements).toHaveLength(2)
  })

  it('keeps pointer-frequency updates outside Redux and commits once at gesture completion', () => {
    const runtime = createEditorRuntime(presentation)
    let storeNotifications = 0
    const unsubscribe = runtime.store.subscribe(() => { storeNotifications += 1 })
    runtime.interaction.begin({ gestureId: 'drag-performance', kind: 'drag', pointer: { x: 0, y: 0 } })
    for (let index = 0; index < 10_000; index += 1) {
      runtime.interaction.updatePointer({ x: index, y: index / 2 })
    }
    const completion = runtime.interaction.complete()
    expect(storeNotifications).toBe(0)

    runtime.commit('Move after pointer completion', [{
      type: 'element.update',
      payload: { id: 'shape-1', props: { left: completion!.delta.x } },
    }])
    expect(storeNotifications).toBe(1)
    unsubscribe()
  })
})
