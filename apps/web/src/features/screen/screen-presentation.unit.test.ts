import { describe, expect, it } from 'vitest'

import type { PresentationState } from '@mona/presentation-core'

import { projectPresentationForScreen, resolveSourceSlideIndex } from '@/features/screen/screen-presentation'

const presentation = (slideIndex = 0): PresentationState => ({
  slideIndex,
  slides: [
    { id: 'one', elements: [] },
    { id: 'hidden', elements: [], hidden: true },
    { id: 'three', elements: [] },
  ],
  templates: [],
  theme: {
    backgroundColor: '#fff',
    fontColor: '#000',
    fontName: 'Arial',
    outline: { color: '#000', style: 'solid', width: 1 },
    shadow: { blur: 0, color: '#000', h: 0, v: 0 },
    themeColors: [],
  },
  title: 'Screen projection',
  viewportRatio: 0.5625,
  viewportSize: 1000,
})

describe('screen presentation projection', () => {
  it('removes hidden pages and maps presented indexes back to authoring indexes', () => {
    const source = presentation(0)
    const projected = projectPresentationForScreen(source)

    expect(projected.slides.map(slide => slide.id)).toEqual(['one', 'three'])
    expect(resolveSourceSlideIndex(source, projected, 1)).toBe(2)
  })

  it('starts on the next visible page when the authored current page is hidden', () => {
    const projected = projectPresentationForScreen(presentation(1))
    expect(projected.slides[projected.slideIndex]?.id).toBe('three')
  })

  it('falls back to the complete deck when every page is hidden', () => {
    const source = presentation(1)
    source.slides = source.slides.map(slide => ({ ...slide, hidden: true }))

    const projected = projectPresentationForScreen(source)
    expect(projected.slides).toHaveLength(3)
    expect(projected.slideIndex).toBe(1)
  })
})
