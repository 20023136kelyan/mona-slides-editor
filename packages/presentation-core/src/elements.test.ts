import { describe, expect, it } from 'vitest'

import { applyPresentationCommand } from './commands'
import {
  collectElementTreeIds,
  detachElementTreeSources,
  findElementById,
  flattenElementTree,
  remapElementTreeIds,
} from './elements'
import type { PPTElement, PPTGroupElement, PPTTextElement } from './model'
import type { PresentationState } from './state'
import { validateImportedSlides, validatePresentationState } from './validation'

const text = (id: string, left = 0): PPTTextElement => ({
  content: `<p>${id}</p>`,
  defaultColor: '#111111',
  defaultFontName: 'Arial',
  height: 40,
  id,
  left,
  rotate: 0,
  top: 0,
  type: 'text',
  width: 100,
})

const nestedGroup = (): PPTGroupElement => ({
  coordinateHeight: 200,
  coordinateWidth: 400,
  elements: [
    text('child-1'),
    {
      coordinateHeight: 100,
      coordinateWidth: 200,
      elements: [text('grandchild-1', 25)],
      height: 100,
      id: 'nested-group',
      left: 150,
      rotate: 5,
      top: 50,
      type: 'group',
      width: 200,
    },
  ],
  height: 200,
  id: 'root-group',
  left: 40,
  rotate: 15,
  semanticType: 'group',
  top: 60,
  type: 'group',
  width: 400,
})

const presentation = (elements: PPTElement[]): PresentationState => ({
  slides: [{ elements, id: 'slide-1' }],
  slideIndex: 0,
  templates: [],
  theme: {
    backgroundColor: '#ffffff',
    fontColor: '#111111',
    fontName: 'Arial',
    outline: { color: '#111111', style: 'solid', width: 1 },
    shadow: { blur: 0, color: '#000000', h: 0, v: 0 },
    themeColors: [],
  },
  title: 'Nested elements',
  viewportRatio: 0.5625,
  viewportSize: 1000,
})

describe('semantic element trees', () => {
  it('walks and addresses nested native groups without flattening them', () => {
    const group = nestedGroup()

    expect(collectElementTreeIds([group])).toEqual([
      'root-group',
      'child-1',
      'nested-group',
      'grandchild-1',
    ])
    expect(flattenElementTree([group])).toHaveLength(4)
    expect(findElementById([group], 'grandchild-1')).toMatchObject({ left: 25, type: 'text' })
  })

  it('updates and deletes nested children through normal presentation commands', () => {
    const initial = presentation([nestedGroup()])
    const updated = applyPresentationCommand(initial, {
      type: 'element.update',
      payload: { id: 'grandchild-1', props: { left: 88 } },
    }).state

    expect(findElementById(updated.slides[0]!.elements, 'grandchild-1')).toMatchObject({ left: 88 })
    expect(updated.slides[0]!.elements[0]).not.toBe(initial.slides[0]!.elements[0])

    const deleted = applyPresentationCommand(updated, {
      type: 'element.delete',
      elementIds: 'child-1',
    }).state
    expect(findElementById(deleted.slides[0]!.elements, 'child-1')).toBeUndefined()
    expect(findElementById(deleted.slides[0]!.elements, 'grandchild-1')).toBeDefined()
  })

  it('remaps every nested identity during duplication', () => {
    const source = [nestedGroup()]
    source[0]!.source = {
      kind: 'pptx',
      packageId: 'package-1',
      slidePart: 'ppt/slides/slide1.xml',
      sourceLayer: 'slide',
      stableId: 'package-1/ppt/slides/slide1.xml#1',
    }
    source[0]!.elements[0]!.source = {
      kind: 'pptx',
      packageId: 'package-1',
      slidePart: 'ppt/slides/slide1.xml',
      sourceLayer: 'slide',
      stableId: 'package-1/ppt/slides/slide1.xml#2',
    }
    let nextId = 0
    const duplicate = remapElementTreeIds(source, () => `copy-${++nextId}`)
    detachElementTreeSources(duplicate.elements)

    expect(collectElementTreeIds(duplicate.elements)).toEqual(['copy-1', 'copy-2', 'copy-3', 'copy-4'])
    expect([...duplicate.idMap.entries()]).toEqual([
      ['root-group', 'copy-1'],
      ['child-1', 'copy-2'],
      ['nested-group', 'copy-3'],
      ['grandchild-1', 'copy-4'],
    ])
    expect(source[0]!.id).toBe('root-group')
    expect(source[0]!.source).toBeDefined()
    expect(source[0]!.elements[0]!.source).toBeDefined()
    expect(flattenElementTree(duplicate.elements).every(element => element.source === undefined)).toBe(true)
  })

  it('accepts groups and opaque objects at imported-data and state validation gates', () => {
    const state = presentation([
      nestedGroup(),
      {
        height: 80,
        id: 'opaque-1',
        left: 20,
        opaqueType: 'urn:example:unsupported',
        rotate: 0,
        top: 20,
        type: 'opaque',
        width: 120,
      },
    ])

    expect(validateImportedSlides(state.slides)).toMatchObject({ valid: true })
    expect(validatePresentationState(state)).toMatchObject({ valid: true })
  })
})
