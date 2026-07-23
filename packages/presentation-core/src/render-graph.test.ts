import { describe, expect, it } from 'vitest'

import type { PPTImageElement, Slide } from './model'
import { resolveSlideRenderGraph } from './render-graph'
import type {
  PowerPointElementSourceLayer,
  PowerPointPackageReference,
} from './source'

const image = (id: string, sourceLayer?: PowerPointElementSourceLayer): PPTImageElement => ({
  fixedRatio: true,
  height: 10,
  id,
  left: 0,
  rotate: 0,
  ...(sourceLayer ? {
    source: {
      kind: 'pptx',
      packageId: 'pptx:source',
      slidePart: 'ppt/slides/slide1.xml',
      sourceLayer,
      stableId: `pptx:source/${sourceLayer}/${id}`,
    },
  } : {}),
  src: 'data:image/png;base64,',
  top: 0,
  type: 'image',
  width: 10,
})

describe('PowerPoint render graph', () => {
  it('layers master, layout, unresolved inherited, and slide-local elements deterministically', () => {
    const slide: Slide = {
      elements: [
        image('local-imported', 'slide'),
        image('layout', 'layout'),
        image('native-mona'),
        image('master', 'master'),
        image('inherited', 'inherited'),
      ],
      id: 'slide-1',
    }

    const graph = resolveSlideRenderGraph(slide)

    expect(graph.map(node => node.element.id)).toEqual([
      'master',
      'layout',
      'inherited',
      'local-imported',
      'native-mona',
    ])
    expect(graph.map(node => node.zIndex)).toEqual([1, 2, 3, 4, 5])
  })

  it('resolves shared master and layout trees without copying them into the slide', () => {
    const master = image('master', 'master')
    const layout = image('layout', 'layout')
    const placeholder = image('layout-placeholder', 'layout')
    placeholder.source = {
      ...placeholder.source!,
      placeholderType: 'title',
    }
    const sourcePackage: PowerPointPackageReference = {
      byteLength: 10,
      fileName: 'shared.pptx',
      hierarchy: {
        layouts: [{
          elements: [layout, placeholder],
          id: 'layout-1',
          masterId: 'master-1',
          objectIds: [],
          packageId: 'pptx:source',
          partPath: 'ppt/slideLayouts/slideLayout1.xml',
          preserve: false,
          showMasterPlaceholderAnimations: true,
          showMasterShapes: true,
        }],
        masters: [{
          elements: [master],
          id: 'master-1',
          layoutIds: ['layout-1'],
          objectIds: [],
          packageId: 'pptx:source',
          partPath: 'ppt/slideMasters/slideMaster1.xml',
          preserve: false,
        }],
        placeholders: [],
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
    const slide: Slide = {
      elements: [image('slide')],
      id: 'slide-1',
      source: {
        ...sourcePackage.slides[0]!,
        kind: 'pptx',
        packageId: sourcePackage.packageId,
      },
    }

    expect(resolveSlideRenderGraph(slide, [sourcePackage]).map(node => node.element.id)).toEqual([
      'master',
      'layout',
      'slide',
    ])
    expect(slide.elements).toHaveLength(1)
  })

  it('honors a layout that suppresses master shapes', () => {
    const master = image('master', 'master')
    const sourcePackage: PowerPointPackageReference = {
      byteLength: 10,
      fileName: 'hidden-master.pptx',
      hierarchy: {
        layouts: [{
          elements: [],
          id: 'layout-1',
          objectIds: [],
          packageId: 'pptx:source',
          partPath: 'ppt/slideLayouts/slideLayout1.xml',
          preserve: false,
          showMasterPlaceholderAnimations: true,
          showMasterShapes: false,
        }],
        masters: [{
          elements: [master],
          id: 'master-1',
          layoutIds: ['layout-1'],
          objectIds: [],
          packageId: 'pptx:source',
          partPath: 'ppt/slideMasters/slideMaster1.xml',
          preserve: false,
        }],
        placeholders: [],
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
    const slide: Slide = {
      elements: [image('slide')],
      id: 'slide-1',
      source: {
        ...sourcePackage.slides[0]!,
        kind: 'pptx',
        packageId: sourcePackage.packageId,
      },
    }

    expect(resolveSlideRenderGraph(slide, [sourcePackage]).map(node => node.element.id)).toEqual(['slide'])
  })

  it('honors a slide that suppresses master shapes', () => {
    const master = image('master', 'master')
    const layout = image('layout', 'layout')
    const sourcePackage: PowerPointPackageReference = {
      byteLength: 10,
      fileName: 'hidden-master-on-slide.pptx',
      hierarchy: {
        layouts: [{
          elements: [layout],
          id: 'layout-1',
          objectIds: [],
          packageId: 'pptx:source',
          partPath: 'ppt/slideLayouts/slideLayout1.xml',
          preserve: false,
          showMasterPlaceholderAnimations: true,
          showMasterShapes: true,
        }],
        masters: [{
          elements: [master],
          id: 'master-1',
          layoutIds: ['layout-1'],
          objectIds: [],
          packageId: 'pptx:source',
          partPath: 'ppt/slideMasters/slideMaster1.xml',
          preserve: false,
        }],
        placeholders: [],
        themes: [],
      },
      kind: 'pptx',
      packageId: 'pptx:source',
      slides: [{
        layoutPart: 'ppt/slideLayouts/slideLayout1.xml',
        masterPart: 'ppt/slideMasters/slideMaster1.xml',
        showMasterShapes: false,
        slidePart: 'ppt/slides/slide1.xml',
      }],
    }
    const slide: Slide = {
      elements: [image('slide')],
      id: 'slide-1',
      source: {
        ...sourcePackage.slides[0]!,
        kind: 'pptx',
        packageId: sourcePackage.packageId,
      },
    }

    expect(resolveSlideRenderGraph(slide, [sourcePackage]).map(node => node.element.id)).toEqual([
      'layout',
      'slide',
    ])
  })
})
