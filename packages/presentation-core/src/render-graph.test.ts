import { describe, expect, it } from 'vitest'

import type {
  PPTImageElement,
  PPTTextElement,
  Slide,
  SlideTheme,
  StructuredTextParagraphProperties,
} from './model'
import {
  compileSlideTheme,
  resolveSlideRenderGraph,
  resolveSlideRenderState,
} from './render-graph'
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

const field = (
  id: string,
  placeholderType: 'dt' | 'ftr' | 'sldNum',
  sourceLayer: 'layout' | 'master',
): PPTTextElement => ({
  content: `<p><span>${placeholderType === 'sldNum' ? '‹#›' : id}</span></p>`,
  defaultColor: '#111111',
  defaultFontName: 'Arial',
  height: 20,
  id,
  left: 10,
  rotate: 0,
  source: {
    kind: 'pptx',
    packageId: 'pptx:source',
    placeholderType,
    slidePart: 'ppt/slides/slide1.xml',
    sourceLayer,
    stableId: `pptx:source/${sourceLayer}/${id}`,
  },
  top: 10,
  type: 'text',
  width: 80,
})

const structuredTitle = (
  id: string,
  sourceLayer: 'layout' | 'master' | 'slide',
  paragraph: StructuredTextParagraphProperties = {},
): PPTTextElement => ({
  content: '<p>Compatibility adapter</p>',
  defaultColor: '#111111',
  defaultFontName: 'Arial',
  height: 80,
  id,
  left: 20,
  rotate: 0,
  source: {
    kind: 'pptx',
    packageId: 'pptx:source',
    placeholderIndex: '1',
    placeholderType: 'title',
    slidePart: 'ppt/slides/slide1.xml',
    sourceLayer,
    sourceObjectId: `${sourceLayer}-title-object`,
    stableId: `${sourceLayer}-title-object`,
  },
  structuredText: {
    listStyle: [],
    paragraphs: [{
      level: 0,
      properties: paragraph,
      runs: [{ kind: 'text', sourceId: `${id}.p0.r0`, text: 'Inherited title' }],
      sourceId: `${id}.p0`,
    }],
    scale: 2,
    schemaVersion: 1,
  },
  top: 20,
  type: 'text',
  width: 400,
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

  it('resolves inherited backgrounds and compiles the slide-specific PowerPoint theme', () => {
    const fallback: SlideTheme = {
      backgroundColor: '#ffffff',
      fontColor: '#111111',
      fontName: 'Arial',
      outline: { color: '#111111', style: 'solid', width: 1 },
      shadow: { blur: 0, color: '#000000', h: 0, v: 0 },
      themeColors: [],
    }
    const sourcePackage: PowerPointPackageReference = {
      byteLength: 10,
      fileName: 'theme.pptx',
      hierarchy: {
        layouts: [{
          background: { color: '#224466', type: 'solid' },
          elements: [],
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
          colorMap: { bg1: 'lt1', tx1: 'dk1' },
          elements: [],
          id: 'master-1',
          layoutIds: ['layout-1'],
          objectIds: [],
          packageId: 'pptx:source',
          partPath: 'ppt/slideMasters/slideMaster1.xml',
          preserve: false,
          themeId: 'theme-1',
        }],
        placeholders: [],
        themes: [{
          colors: [
            { name: 'dk1', type: 'srgb', value: '102030' },
            { name: 'lt1', type: 'srgb', value: 'f8f9fa' },
            { name: 'accent1', type: 'srgb', value: 'ff0000' },
            { name: 'accent2', type: 'srgb', value: '00ff00' },
          ],
          id: 'theme-1',
          minorFont: { latin: 'Aptos', supplemental: [] },
          packageId: 'pptx:source',
          partPath: 'ppt/theme/theme1.xml',
        }],
      },
      kind: 'pptx',
      packageId: 'pptx:source',
      slides: [{
        backgroundSource: 'layout',
        layoutPart: 'ppt/slideLayouts/slideLayout1.xml',
        masterPart: 'ppt/slideMasters/slideMaster1.xml',
        slidePart: 'ppt/slides/slide1.xml',
        themeId: 'theme-1',
      }],
    }
    const slide: Slide = {
      background: { color: '#224466', type: 'solid' },
      elements: [],
      id: 'slide-1',
      source: {
        ...sourcePackage.slides[0]!,
        kind: 'pptx',
        packageId: sourcePackage.packageId,
      },
    }

    const state = resolveSlideRenderState(slide, [sourcePackage])
    expect(state.background).toEqual({ color: '#224466', type: 'solid' })
    expect(compileSlideTheme(fallback, state.theme, state.master)).toMatchObject({
      backgroundColor: '#f8f9fa',
      fontColor: '#102030',
      fontName: 'Aptos',
      themeColors: ['#ff0000', '#00ff00'],
    })
  })

  it('compiles structured text through master, layout, placeholder, paragraph, run, and theme layers', () => {
    const masterTitle = structuredTitle('master-title', 'master', {
      defaultRun: { fontFamily: '+mj-lt', fontSize: 30 },
      lineSpacing: { unit: 'percent', value: 110 },
    })
    const layoutTitle = structuredTitle('layout-title', 'layout', {
      alignment: 'ctr',
      spaceAfter: { unit: 'points', value: 4 },
    })
    const slideTitle = structuredTitle('slide-title', 'slide', {
      defaultRun: { bold: true },
    })
    slideTitle.source = {
      ...slideTitle.source!,
      placeholderLayoutObjectId: 'layout-title-object',
      placeholderMasterObjectId: 'master-title-object',
    }
    const sourcePackage: PowerPointPackageReference = {
      byteLength: 10,
      fileName: 'structured-text.pptx',
      hierarchy: {
        layouts: [{
          elements: [layoutTitle],
          id: 'layout-1',
          masterId: 'master-1',
          objectIds: ['layout-title-object'],
          packageId: 'pptx:source',
          partPath: 'ppt/slideLayouts/slideLayout1.xml',
          preserve: false,
          showMasterPlaceholderAnimations: true,
          showMasterShapes: true,
        }],
        masters: [{
          elements: [masterTitle],
          id: 'master-1',
          layoutIds: ['layout-1'],
          objectIds: ['master-title-object'],
          packageId: 'pptx:source',
          partPath: 'ppt/slideMasters/slideMaster1.xml',
          preserve: false,
          textStyles: {
            body: [],
            other: [],
            title: [{
              level: 1,
              run: {
                color: { type: 'scheme', value: 'tx1' },
                fontFamily: '+mj-lt',
              },
            }],
          },
          themeId: 'theme-1',
        }],
        placeholders: [],
        themes: [{
          colors: [{ name: 'dk1', type: 'srgb', value: '123456' }],
          id: 'theme-1',
          majorFont: { latin: 'Aptos Display', supplemental: [] },
          packageId: 'pptx:source',
          partPath: 'ppt/theme/theme1.xml',
        }],
      },
      kind: 'pptx',
      packageId: 'pptx:source',
      slides: [{
        layoutPart: 'ppt/slideLayouts/slideLayout1.xml',
        masterPart: 'ppt/slideMasters/slideMaster1.xml',
        slidePart: 'ppt/slides/slide1.xml',
        themeId: 'theme-1',
      }],
    }
    const slide: Slide = {
      elements: [slideTitle],
      id: 'slide-1',
      source: {
        ...sourcePackage.slides[0]!,
        kind: 'pptx',
        packageId: sourcePackage.packageId,
      },
    }

    const rendered = resolveSlideRenderState(slide, [sourcePackage]).nodes[0]?.element
    expect(rendered?.type).toBe('text')
    if (rendered?.type !== 'text') return
    expect(rendered.defaultFontName).toBe('Aptos Display')
    expect(rendered.defaultColor).toBe('#123456')
    expect(rendered.content).toContain('font-family:&quot;Aptos Display&quot;')
    expect(rendered.content).toContain('font-size:60px')
    expect(rendered.content).toContain('font-weight:700')
    expect(rendered.content).toContain('text-align:center')
    expect(rendered.content).toContain('line-height:1.1')
    expect(rendered.content).toContain('margin-bottom:8px')
    expect(rendered.structuredText?.paragraphs[0]?.properties).toMatchObject({
      alignment: 'ctr',
      defaultRun: {
        bold: true,
        color: { type: 'srgb', value: '#123456' },
        fontFamily: 'Aptos Display',
        fontSize: 30,
      },
      lineSpacing: { unit: 'percent', value: 110 },
    })
  })

  it('renders enabled header/footer fields once and materializes the current slide number', () => {
    const masterSlideNumber = field('master-number', 'sldNum', 'master')
    const layoutSlideNumber = field('layout-number', 'sldNum', 'layout')
    const footer = field('master-footer', 'ftr', 'master')
    const layoutFooter = field('layout-footer', 'ftr', 'layout')
    const hiddenDate = field('master-date', 'dt', 'master')
    const sourcePackage: PowerPointPackageReference = {
      byteLength: 10,
      fileName: 'fields.pptx',
      hierarchy: {
        layouts: [{
          elements: [layoutFooter, layoutSlideNumber],
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
          elements: [masterSlideNumber, footer, hiddenDate],
          headerFooter: {
            dateTime: false,
            footer: true,
            header: true,
            slideNumber: true,
          },
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
      slides: [
        { slidePart: 'ppt/slides/slide1.xml' },
        {
          layoutPart: 'ppt/slideLayouts/slideLayout1.xml',
          masterPart: 'ppt/slideMasters/slideMaster1.xml',
          slidePart: 'ppt/slides/slide2.xml',
        },
      ],
    }
    const slide: Slide = {
      elements: [],
      id: 'slide-2',
      source: {
        ...sourcePackage.slides[1]!,
        kind: 'pptx',
        packageId: sourcePackage.packageId,
      },
    }

    const graph = resolveSlideRenderGraph(slide, [sourcePackage])
    expect(graph.map(node => node.element.id)).toEqual(['layout-footer', 'layout-number'])
    expect((graph[1]!.element as PPTTextElement).content).toContain('2')
    expect((graph[1]!.element as PPTTextElement).content).not.toContain('‹#›')
  })
})
