import { describe, expect, it } from 'vitest'

import { flattenElementTree, type PPTGroupElement } from '@mona/presentation-core'

import { duplicatePreviewElements } from '@/features/editor/editor-canvas-preview'

const source = (): PPTGroupElement => ({
  coordinateHeight: 100,
  coordinateWidth: 200,
  elements: [{
    content: '<p>Child</p>',
    defaultColor: '#111111',
    defaultFontName: 'Arial',
    height: 40,
    id: 'child-1',
    left: 20,
    rotate: 0,
    source: {
      kind: 'pptx',
      packageId: 'package-1',
      nativeShapeId: '2',
      slidePart: 'ppt/slides/slide1.xml',
      sourceLayer: 'slide',
      sourceObjectId: 'package-1/ppt/slides/slide1.xml#2',
      sourcePart: 'ppt/slides/slide1.xml',
      stableId: 'package-1/ppt/slides/slide1.xml#2',
    },
    top: 20,
    type: 'text',
    width: 100,
  }],
  height: 100,
  id: 'group-1',
  left: 40,
  rotate: 0,
  source: {
    kind: 'pptx',
    packageId: 'package-1',
    nativeShapeId: '1',
    slidePart: 'ppt/slides/slide1.xml',
    sourceLayer: 'slide',
    sourceObjectId: 'package-1/ppt/slides/slide1.xml#1',
    sourcePart: 'ppt/slides/slide1.xml',
    stableId: 'package-1/ppt/slides/slide1.xml#1',
  },
  top: 40,
  type: 'group',
  width: 200,
})

describe('canvas duplicate previews', () => {
  it('assigns fresh IDs and retains native payload origins without aliasing the originals', () => {
    const original = source()
    const [duplicate] = duplicatePreviewElements([original])

    expect(duplicate?.id).not.toBe(original.id)
    expect(duplicate?.type).toBe('group')
    expect(duplicate?.type === 'group' && duplicate.elements[0]?.id).not.toBe(original.elements[0]?.id)
    const copiedSources = flattenElementTree([duplicate!]).map(element => element.source)
    expect(copiedSources).toEqual([
      expect.objectContaining({
        copyOnWrite: expect.objectContaining({
          mode: 'copy',
          sourceObjectId: 'package-1/ppt/slides/slide1.xml#1',
        }),
      }),
      expect.objectContaining({
        copyOnWrite: expect.objectContaining({
          mode: 'copy',
          sourceObjectId: 'package-1/ppt/slides/slide1.xml#2',
        }),
      }),
    ])
    expect(copiedSources.every(copiedSource => copiedSource?.sourceObjectId === undefined)).toBe(true)
    expect(flattenElementTree([original]).every(element => element.source !== undefined)).toBe(true)
  })
})
