import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { editorActions } from '@mona/editor-state'
import type { PresentationState } from '@mona/presentation-core'

import { parseEditorClipboard } from '@/features/editor/editor-clipboard'
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
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('commits an atomic change and restores it through undo and redo', () => {
    const runtime = createEditorRuntime(presentation)
    expect(runtime.commit('Move', [{
      type: 'element.update',
      payload: { id: 'shape-1', props: { left: 90 } },
    }])).toBe(true)
    expect(runtime.store.getState().presentation.slides[0]?.elements[0]?.left).toBe(90)
    expect(runtime.canUndo()).toBe(false)
    vi.advanceTimersByTime(300)
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
    expect(pasted[0]?.left).toBe(30)
    expect(runtime.store.getState().session.activeElementIds).toEqual(ids)

    runtime.copySelection()
    const secondIds = runtime.paste()
    const second = runtime.store.getState().presentation.slides[0]!.elements.filter(element => secondIds.includes(element.id))
    expect(second.map(element => [element.left, element.top])).toEqual([[40, 50], [180, 50]])
  })

  it('uses PPTist-compatible encrypted payloads and remaps complete slide relationships', () => {
    const linkedPresentation: PresentationState = {
      ...presentation,
      slides: [
        {
          ...structuredClone(presentation.slides[0]!),
          animations: [{ id: 'animation-1', elId: 'shape-1', effect: 'fade', type: 'in', duration: 500, trigger: 'click' }],
          elements: structuredClone(presentation.slides[0]!.elements).map((element, index) => index === 0
            ? { ...element, link: { type: 'slide' as const, target: 'slide-2' } }
            : element),
        },
        { id: 'slide-2', elements: [] },
      ],
    }
    const runtime = createEditorRuntime(linkedPresentation)
    runtime.store.dispatch(editorActions.selectedSlideIndexesChanged([0, 1]))
    const serialized = runtime.copySlides()!
    const payload = parseEditorClipboard(serialized)
    expect(typeof payload).not.toBe('string')
    expect(typeof payload !== 'string' && payload.type).toBe('slides')

    const ids = runtime.pasteSlides(serialized)
    const state = runtime.store.getState()
    expect(ids).toHaveLength(2)
    expect(state.presentation.slideIndex).toBe(1)
    expect(state.session.selectedSlideIndexes).toEqual([])
    const copied = state.presentation.slides.slice(1, 3)
    expect(copied.map(slide => slide.id)).toEqual(ids)
    expect(copied[0]!.elements[0]!.id).not.toBe('shape-1')
    expect(copied[0]!.elements[0]!.groupId).not.toBe('group-1')
    expect(copied[0]!.elements[0]!.link).toEqual({ type: 'slide', target: copied[1]!.id })
    expect(copied[0]!.animations![0]!.id).not.toBe('animation-1')
    expect(copied[0]!.animations![0]!.elId).toBe(copied[0]!.elements[0]!.id)
  })

  it('duplicates only the current slide and resets an all-slide deletion to one themed blank slide', () => {
    const runtime = createEditorRuntime({
      ...presentation,
      slides: [structuredClone(presentation.slides[0]!), { id: 'slide-2', elements: [] }],
    })
    runtime.store.dispatch(editorActions.selectedSlideIndexesChanged([0, 1]))
    const duplicated = runtime.duplicateSlides()
    expect(duplicated).toHaveLength(1)
    expect(runtime.store.getState().presentation.slides).toHaveLength(3)
    expect(runtime.store.getState().presentation.slideIndex).toBe(1)

    runtime.store.dispatch(editorActions.selectedSlideIndexesChanged([0, 1, 2]))
    expect(runtime.deleteSlides()).toBe(true)
    const state = runtime.store.getState()
    expect(state.presentation.slides).toHaveLength(1)
    expect(state.presentation.slides[0]!.elements).toEqual([])
    expect(state.presentation.slides[0]!.background).toEqual({ type: 'solid', color: '#fff' })
  })

  it('reproduces PPTist section-aware slide reordering without creating history', () => {
    const runtime = createEditorRuntime({
      ...presentation,
      slides: [
        { id: 'slide-a', elements: [], sectionTag: { id: 'section-a', title: 'A' } },
        { id: 'slide-b', elements: [] },
        { id: 'slide-c', elements: [], sectionTag: { id: 'section-c', title: 'C' } },
        { id: 'slide-d', elements: [] },
      ],
    })
    expect(runtime.reorderSlide(0, 3)).toBe(true)
    expect(runtime.store.getState().presentation.slides.map(slide => [slide.id, slide.sectionTag?.id])).toEqual([
      ['slide-b', 'section-a'],
      ['slide-c', 'section-c'],
      ['slide-d', undefined],
      ['slide-a', undefined],
    ])
    expect(runtime.store.getState().presentation.slideIndex).toBe(3)
    expect(runtime.getHistoryState()).toEqual({ cursor: 0, length: 1 })

    expect(runtime.reorderSlide(3, 0)).toBe(true)
    expect(runtime.store.getState().presentation.slides.map(slide => [slide.id, slide.sectionTag?.id])).toEqual([
      ['slide-a', 'section-a'],
      ['slide-b', undefined],
      ['slide-c', 'section-c'],
      ['slide-d', undefined],
    ])
  })

  it('creates, renames, removes, and deletes complete sections with source history boundaries', () => {
    const runtime = createEditorRuntime({
      ...presentation,
      slides: [
        { id: 'slide-a', elements: [] },
        { id: 'slide-b', elements: [], sectionTag: { id: 'section-b' } },
        { id: 'slide-c', elements: [] },
        { id: 'slide-d', elements: [], sectionTag: { id: 'section-d', title: 'D' } },
      ],
    })
    expect(runtime.updateSectionTitle('default', 'Default title')).toBe(true)
    const defaultSection = runtime.store.getState().presentation.slides[0]!.sectionTag
    expect(defaultSection?.title).toBe('Default title')
    expect(defaultSection?.id).toHaveLength(6)
    expect(runtime.updateSectionTitle('section-b', 'B')).toBe(true)
    expect(runtime.store.getState().presentation.slides[1]!.sectionTag).toEqual({ id: 'section-b', title: 'B' })
    vi.advanceTimersByTime(300)
    expect(runtime.getHistoryState()).toEqual({ cursor: 1, length: 2 })

    expect(runtime.removeSection('section-b')).toBe(true)
    expect(runtime.store.getState().presentation.slides[1]!.sectionTag).toBeUndefined()
    expect(runtime.removeAllSections()).toBe(true)
    expect(runtime.store.getState().presentation.slides.every(slide => !slide.sectionTag)).toBe(true)

    const sectioned = createEditorRuntime({
      ...presentation,
      slides: [
        { id: 'slide-a', elements: [] },
        { id: 'slide-b', elements: [], sectionTag: { id: 'section-b' } },
        { id: 'slide-c', elements: [] },
        { id: 'slide-d', elements: [], sectionTag: { id: 'section-d' } },
      ],
      slideIndex: 1,
    })
    expect(sectioned.removeSectionSlides('section-b')).toBe(true)
    expect(sectioned.store.getState().presentation.slides.map(slide => slide.id)).toEqual(['slide-a', 'slide-d'])
    expect(sectioned.store.getState().presentation.slideIndex).toBe(1)
  })

  it('inserts one template with fresh element/group IDs and handles insert-all empty/non-empty branches', () => {
    const template = {
      id: 'template-slide',
      type: 'cover' as const,
      sectionTag: { id: 'discarded-section' },
      elements: structuredClone(presentation.slides[0]!.elements),
    }
    const runtime = createEditorRuntime(presentation)
    const insertedId = runtime.createSlideFromTemplate(template)
    const inserted = runtime.store.getState().presentation.slides[1]!
    expect(inserted.id).toBe(insertedId)
    expect(inserted.id).not.toBe(template.id)
    expect(inserted.sectionTag).toBeUndefined()
    expect(inserted.elements.map(element => element.id)).not.toEqual(template.elements.map(element => element.id))
    expect(inserted.elements[0]!.groupId).toBe(inserted.elements[1]!.groupId)
    expect(inserted.elements[0]!.groupId).not.toBe('group-1')

    const emptyRuntime = createEditorRuntime({
      ...presentation,
      slides: [{ id: 'empty', elements: [] }],
    })
    const replacementIds = emptyRuntime.insertTemplateSlides([template], { backgroundColor: '#abc' })
    expect(replacementIds).toEqual(['template-slide'])
    expect(emptyRuntime.store.getState().presentation.theme.backgroundColor).toBe('#abc')
    expect(emptyRuntime.getHistoryState()).toEqual({ cursor: 0, length: 1 })

    const appendedIds = runtime.insertTemplateSlides([template], {})
    expect(appendedIds).toHaveLength(1)
    expect(appendedIds[0]).not.toBe(template.id)
    expect(runtime.store.getState().presentation.slides[runtime.store.getState().presentation.slideIndex]!.id).toBe(appendedIds[0])
    vi.advanceTimersByTime(300)
    expect(runtime.canUndo()).toBe(true)
  })

  it('cuts selection as one history entry and selects all unlocked elements', () => {
    const runtime = createEditorRuntime(presentation)
    runtime.selectAll()
    expect(runtime.store.getState().session.activeElementIds).toEqual(['shape-1', 'shape-2'])
    expect(runtime.cutSelection()).toBeTypeOf('string')
    expect(runtime.store.getState().presentation.slides[0]?.elements).toEqual([])
    vi.advanceTimersByTime(300)
    expect(runtime.undo()).toBe(true)
    expect(runtime.store.getState().presentation.slides[0]?.elements).toHaveLength(2)
  })

  it('keeps pointer-frequency updates outside Redux and commits once at gesture completion', () => {
    const runtime = createEditorRuntime(presentation)
    let storeNotifications = 0
    const unsubscribe = runtime.store.subscribe(() => {
      storeNotifications += 1
    })
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

  it('debounces changes into one snapshot and truncates the redo branch', () => {
    const runtime = createEditorRuntime(presentation)
    runtime.commit('Move', [{ type: 'element.update', payload: { id: 'shape-1', props: { left: 50 } } }])
    vi.advanceTimersByTime(200)
    runtime.commit('Move', [{ type: 'element.update', payload: { id: 'shape-1', props: { left: 80 } } }])
    vi.advanceTimersByTime(299)
    expect(runtime.getHistoryState()).toEqual({ cursor: 0, length: 1 })
    vi.advanceTimersByTime(1)
    expect(runtime.getHistoryState()).toEqual({ cursor: 1, length: 2 })
    expect(runtime.undo()).toBe(true)
    expect(runtime.store.getState().presentation.slides[0]!.elements[0]!.left).toBe(20)
    expect(runtime.canRedo()).toBe(true)

    runtime.commit('Replace redo', [{ type: 'element.update', payload: { id: 'shape-1', props: { left: 120 } } }])
    vi.advanceTimersByTime(300)
    expect(runtime.getHistoryState()).toEqual({ cursor: 1, length: 2 })
    expect(runtime.canRedo()).toBe(false)
    expect(runtime.undo()).toBe(true)
    expect(runtime.store.getState().presentation.slides[0]!.elements[0]!.left).toBe(20)
    expect(runtime.redo()).toBe(true)
    expect(runtime.store.getState().presentation.slides[0]!.elements[0]!.left).toBe(120)
  })

  it('caps history at 20 snapshots', () => {
    const runtime = createEditorRuntime(presentation)
    for (let left = 21; left <= 41; left += 1) {
      runtime.commit(`Move ${left}`, [{ type: 'element.update', payload: { id: 'shape-1', props: { left } } }])
      vi.advanceTimersByTime(300)
    }
    expect(runtime.getHistoryState()).toEqual({ cursor: 19, length: 20 })
    let undoCount = 0
    while (runtime.undo()) undoCount += 1
    expect(undoCount).toBe(19)
    expect(runtime.store.getState().presentation.slides[0]!.elements[0]!.left).toBe(22)
  })

  it('keeps independent debounce channels for different action sources', () => {
    const runtime = createEditorRuntime(presentation)
    runtime.commit('Nudge elements', [{ type: 'element.update', payload: { id: 'shape-1', props: { left: 21 } } }])
    runtime.commit('Delete elements', [{ type: 'element.delete', elementIds: ['shape-2'] }])
    vi.advanceTimersByTime(300)
    expect(runtime.getHistoryState()).toEqual({ cursor: 2, length: 3 })
    expect(runtime.undo()).toBe(true)
    expect(runtime.store.getState().presentation.slides[0]!.elements).toHaveLength(1)
    expect(runtime.undo()).toBe(true)
    expect(runtime.store.getState().presentation.slides[0]!.elements).toHaveLength(2)
  })

  it('preserves the working slide index and clears selection on history restoration', () => {
    const runtime = createEditorRuntime({
      ...presentation,
      slides: [...presentation.slides, {
        id: 'slide-2',
        elements: structuredClone(presentation.slides[0]!.elements).map((element, index) => ({
          ...element,
          id: `slide-2-shape-${index + 1}`,
        })),
      }],
    })
    runtime.focusSlide(1)
    runtime.store.dispatch(editorActions.selectionChanged(['slide-2-shape-1']))
    runtime.commit('Move on slide 2', [{ type: 'element.update', payload: { id: 'slide-2-shape-1', props: { left: 75 } } }])
    vi.advanceTimersByTime(300)
    expect(runtime.undo()).toBe(true)
    expect(runtime.store.getState().presentation.slideIndex).toBe(1)
    expect(runtime.store.getState().session.activeElementIds).toEqual([])
    expect(runtime.store.getState().presentation.slides[1]!.elements[0]!.left).toBe(20)
  })
})
