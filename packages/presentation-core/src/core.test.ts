import { describe, expect, it } from 'vitest'
import type { PPTAnimation, PPTShapeElement } from './model'
import { applyPresentationCommand } from './commands'
import { createDeterministicIdFactory } from './ids'
import {
  selectCurrentSlide,
  selectCurrentSlideAnimations,
  selectElementById,
  selectFormattedCurrentSlideAnimations,
} from './queries'
import type { PresentationState } from './state'
import { applyPresentationTransaction, createPresentationTransaction } from './transactions'
import { validateImportedSlides, validatePresentationState } from './validation'

const shape = (id: string, left = 0): PPTShapeElement => ({
  type: 'shape',
  id,
  left,
  top: 0,
  width: 100,
  height: 100,
  rotate: 0,
  viewBox: [100, 100],
  path: 'M 0 0 L 100 0 L 100 100 Z',
  fixedRatio: false,
  fill: '#000',
})

const fixture = (): PresentationState => ({
  title: 'Fixture',
  theme: {
    themeColors: ['#000'],
    fontColor: '#111',
    fontName: '',
    backgroundColor: '#fff',
    shadow: { h: 1, v: 1, blur: 1, color: '#000' },
    outline: { width: 1, color: '#000', style: 'solid' },
  },
  slides: [
    { id: 'slide-1', elements: [shape('shape-1')] },
    { id: 'slide-2', elements: [shape('shape-2', 200)], sectionTag: { id: 'section-1' } },
    { id: 'slide-3', elements: [shape('shape-3', 400)] },
  ],
  slideIndex: 0,
  viewportSize: 1000,
  viewportRatio: 0.5625,
  templates: [],
})

describe('presentation core', () => {
  it('updates only the target slide and element references', () => {
    const state = fixture()
    const result = applyPresentationCommand(state, {
      type: 'element.update',
      payload: { id: 'shape-1', props: { left: 42 } },
    })

    expect(selectElementById(result.state, 'shape-1')?.left).toBe(42)
    expect(result.state.slides[0]).not.toBe(state.slides[0])
    expect(result.state.slides[1]).toBe(state.slides[1])
    expect(result.state.slides[1]?.elements[0]).toBe(state.slides[1]?.elements[0])
  })

  it('adds a slide without mutating the caller and preserves insertion semantics', () => {
    const state = fixture()
    const input = { id: 'added', elements: [], sectionTag: { id: 'discard-me' } }
    const result = applyPresentationCommand(state, { type: 'slide.add', slides: input })

    expect(input.sectionTag).toEqual({ id: 'discard-me' })
    expect(result.state.slides.map(slide => slide.id)).toEqual(['slide-1', 'added', 'slide-2', 'slide-3'])
    expect(result.state.slides[1]?.sectionTag).toBeUndefined()
    expect(result.state.slideIndex).toBe(1)
  })

  it('transfers a deleted section marker to the following slide', () => {
    const state = { ...fixture(), slideIndex: 1 }
    const result = applyPresentationCommand(state, { type: 'slide.delete', slideIds: 'slide-2' })

    expect(result.state.slides.map(slide => slide.id)).toEqual(['slide-1', 'slide-3'])
    expect(result.state.slides[1]?.sectionTag).toEqual({ id: 'section-1' })
    expect(result.state.slideIndex).toBe(1)
  })

  it('applies valid transactions atomically and rejects invalid output', () => {
    const state = fixture()
    const idFactory = createDeterministicIdFactory('tx')
    const valid = createPresentationTransaction({
      label: 'Move shape',
      origin: 'test',
      commands: [{ type: 'element.update', payload: { id: 'shape-1', props: { left: 80 } } }],
    }, idFactory)
    const validResult = applyPresentationTransaction(state, valid)
    expect(validResult.ok).toBe(true)
    if (validResult.ok) expect(selectElementById(validResult.state, 'shape-1')?.left).toBe(80)

    const invalid = createPresentationTransaction({
      label: 'Duplicate slide ID',
      origin: 'test',
      commands: [{ type: 'slide.add', slides: { id: 'slide-1', elements: [] } }],
    }, idFactory)
    const invalidResult = applyPresentationTransaction(state, invalid)
    expect(invalidResult.ok).toBe(false)
    expect(invalidResult.state).toBe(state)
    if (!invalidResult.ok) {
      expect(invalidResult.issues.some(issue => issue.code === 'slide.id.duplicate')).toBe(true)
    }
  })

  it('queries and validates the unchanged persisted schema', () => {
    const state = fixture()
    expect(selectCurrentSlide(state)?.id).toBe('slide-1')
    expect(validatePresentationState(state)).toEqual({ valid: true, issues: [] })
  })

  it('preserves the empty-deck getter behavior from the Vue reference store', () => {
    const state = { ...fixture(), slides: [] }

    expect(selectCurrentSlide(state)).toBeUndefined()
    expect(selectCurrentSlideAnimations(state)).toEqual([])
    expect(selectFormattedCurrentSlideAnimations(state)).toEqual([])
  })

  it('filters and formats current-slide animations with the Vue ordering semantics', () => {
    const animations: PPTAnimation[] = [
      { id: 'animation-1', elId: 'shape-1', effect: 'fadeIn', type: 'in', trigger: 'click', duration: 1000 },
      { id: 'animation-2', elId: 'shape-1', effect: 'fadeOut', type: 'out', trigger: 'meantime', duration: 1000 },
      { id: 'animation-orphan', elId: 'missing', effect: 'fadeIn', type: 'in', trigger: 'auto', duration: 1000 },
      { id: 'animation-3', elId: 'shape-1', effect: 'fadeIn', type: 'in', trigger: 'auto', duration: 1000 },
    ]
    const state = fixture()
    const firstSlide = state.slides[0]
    if (!firstSlide) throw new Error('Animation fixture requires a first slide')
    state.slides[0] = { ...firstSlide, animations }

    expect(selectCurrentSlideAnimations(state).map(animation => animation.id)).toEqual([
      'animation-1',
      'animation-2',
      'animation-3',
    ])
    expect(selectFormattedCurrentSlideAnimations(state)).toEqual([
      { animations: [animations[1]], autoNext: true },
      { animations: [animations[3]], autoNext: false },
    ])
  })
})

describe('validateImportedSlides', () => {
  const validSlide = () => ({
    id: 'slide-1',
    elements: [
      { id: 'element-1', type: 'text', content: '<p>hi</p>', left: 0, top: 0, width: 100, height: 50 },
      { id: 'element-2', type: 'line', left: 0, top: 0, width: 100, start: [0, 0], end: [1, 1] },
    ],
  })

  it('accepts structurally sound slides', () => {
    expect(validateImportedSlides([validSlide()]).valid).toBe(true)
  })

  it('accepts page metadata and rejects invalid title, hidden, and duration values', () => {
    expect(validateImportedSlides([{
      ...validSlide(),
      durationMs: 45_000,
      hidden: true,
      title: 'Opening',
    }]).valid).toBe(true)

    for (const slide of [
      { ...validSlide(), title: 42 },
      { ...validSlide(), hidden: 'yes' },
      { ...validSlide(), durationMs: 999 },
      { ...validSlide(), durationMs: 3_600_001 },
      { ...validSlide(), durationMs: Number.NaN },
    ]) {
      expect(validateImportedSlides([slide]).valid).toBe(false)
    }
  })

  it('rejects non-arrays, empty arrays, and non-object slides', () => {
    expect(validateImportedSlides(undefined).valid).toBe(false)
    expect(validateImportedSlides({}).valid).toBe(false)
    expect(validateImportedSlides([]).valid).toBe(false)
    expect(validateImportedSlides(['slide']).valid).toBe(false)
    expect(validateImportedSlides([null]).valid).toBe(false)
  })

  it('rejects missing ids, unknown element types, and non-finite geometry', () => {
    expect(validateImportedSlides([{ ...validSlide(), id: '' }]).valid).toBe(false)
    expect(validateImportedSlides([{ id: 's', elements: [{ id: 'e', type: 'iframe', left: 0, top: 0, width: 1, height: 1 }] }]).valid).toBe(false)
    expect(validateImportedSlides([{ id: 's', elements: [{ id: 'e', type: 'text', left: Number.NaN, top: 0, width: 1, height: 1 }] }]).valid).toBe(false)
    expect(validateImportedSlides([{ id: 's', elements: [{ id: 'e', type: 'text', left: '10', top: 0, width: 1, height: 1 }] }]).valid).toBe(false)
    expect(validateImportedSlides([{ id: 's', elements: 'none' }]).valid).toBe(false)
  })

  it('does not require height for line elements but requires it elsewhere', () => {
    expect(validateImportedSlides([{ id: 's', elements: [{ id: 'e', type: 'line', left: 0, top: 0, width: 1 }] }]).valid).toBe(true)
    expect(validateImportedSlides([{ id: 's', elements: [{ id: 'e', type: 'text', left: 0, top: 0, width: 1 }] }]).valid).toBe(false)
  })
})

describe('cross-slide element commands', () => {
  it('targets an explicit slide and rejects missing or duplicate element identities atomically', () => {
    const state = fixture()
    const added = applyPresentationCommand(state, {
      type: 'element.add',
      slideId: 'slide-2',
      elements: shape('agent-shape'),
    })
    expect(added.state.slides[0]?.elements.map(element => element.id)).toEqual(['shape-1'])
    expect(added.state.slides[1]?.elements.map(element => element.id)).toEqual(['shape-2', 'agent-shape'])

    expect(() => applyPresentationCommand(state, {
      type: 'element.add',
      slideId: 'slide-1',
      elements: shape('shape-1'),
    })).toThrow(/duplicate element id/i)
    expect(() => applyPresentationCommand(state, {
      type: 'element.update',
      payload: { id: 'missing', slideId: 'slide-2', props: { left: 100 } },
    })).toThrow(/element not found/i)
    expect(() => applyPresentationCommand(state, {
      type: 'element.delete',
      slideId: 'slide-2',
      elementIds: 'missing',
    })).toThrow(/element not found/i)
  })
})
