import { describe, expect, it } from 'vitest'

import { resolvePowerPointPlaceholderChain } from './source-graph'
import type {
  PowerPointElementSource,
  PowerPointPackageReference,
  PowerPointSlideSource,
} from './source'

const sourcePackage: PowerPointPackageReference = {
  byteLength: 100,
  fileName: 'placeholder.pptx',
  hierarchy: {
    layouts: [],
    masters: [],
    placeholders: [
      {
        index: '1',
        layer: 'layout',
        objectId: 'layout-title',
        partId: 'layout-1',
        partPath: 'ppt/slideLayouts/slideLayout1.xml',
        type: 'title',
      },
      {
        index: '1',
        layer: 'master',
        objectId: 'master-title',
        partId: 'master-1',
        partPath: 'ppt/slideMasters/slideMaster1.xml',
        type: 'title',
      },
    ],
    themes: [],
  },
  kind: 'pptx',
  packageId: 'pptx:source',
  slides: [{
    layoutPart: 'ppt/slideLayouts/slideLayout1.xml',
    masterPart: 'ppt/slideMasters/slideMaster1.xml',
    slidePart: 'ppt/slides/slide1.xml',
  }],
}

const slide: PowerPointSlideSource = {
  ...sourcePackage.slides[0]!,
  kind: 'pptx',
  packageId: sourcePackage.packageId,
}

describe('PowerPoint placeholder inheritance', () => {
  it('resolves layout and master placeholders by native index before type', () => {
    const element: PowerPointElementSource = {
      kind: 'pptx',
      packageId: sourcePackage.packageId,
      placeholderIndex: '1',
      placeholderType: 'title',
      slidePart: slide.slidePart,
      sourceLayer: 'slide',
      stableId: 'slide-title',
    }

    expect(resolvePowerPointPlaceholderChain(sourcePackage, slide, element)).toEqual({
      layout: expect.objectContaining({ objectId: 'layout-title' }),
      master: expect.objectContaining({ objectId: 'master-title' }),
    })
  })
})
