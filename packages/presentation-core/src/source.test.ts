import { describe, expect, it } from 'vitest'

import { applyPresentationCommand } from './commands'
import { resolveSlideRenderState } from './render-graph'
import type { PPTChartElement } from './model'
import type { PresentationState } from './state'
import type { PowerPointPackageReference } from './source'

const presentation = (): PresentationState => ({
  slides: [{ elements: [], id: 'slide-1' }],
  slideIndex: 0,
  templates: [],
  theme: {
    backgroundColor: '#fff',
    fontColor: '#111',
    fontName: 'Arial',
    outline: { color: '#000', style: 'solid', width: 1 },
    shadow: { blur: 0, color: '#000', h: 0, v: 0 },
    themeColors: [],
  },
  title: 'Fixture',
  viewportRatio: 0.5625,
  viewportSize: 1000,
})

const sourcePackage: PowerPointPackageReference = {
  byteLength: 1024,
  fileName: 'source.pptx',
  kind: 'pptx',
  packageId: 'pptx:fixture',
  slides: [{
    layoutPart: 'ppt/slideLayouts/slideLayout1.xml',
    masterPart: 'ppt/slideMasters/slideMaster1.xml',
    slidePart: 'ppt/slides/slide1.xml',
    themePart: 'ppt/theme/theme1.xml',
  }],
}

describe('PowerPoint source package state', () => {
  it('attaches serializable package references without placing archive bytes in presentation history', () => {
    const state = presentation()
    const result = applyPresentationCommand(state, {
      type: 'presentation.source-packages.replace',
      sourcePackages: [sourcePackage],
    })

    expect(result.state.sourcePackages).toEqual([sourcePackage])
    expect(result.state.slides).toBe(state.slides)
    expect(JSON.stringify(result.state)).toContain('"packageId":"pptx:fixture"')
    expect(JSON.stringify(result.state)).not.toContain('Uint8Array')
  })

  it('journals the exact OOXML parts and native objects touched by an element edit', () => {
    const state: PresentationState = {
      ...presentation(),
      slides: [{
        elements: [{
          fixedRatio: true,
          height: 100,
          id: 'source-image',
          left: 0,
          rotate: 0,
          source: {
            kind: 'pptx',
            nativeShapeId: '7',
            packageId: sourcePackage.packageId,
            slidePart: sourcePackage.slides[0]!.slidePart,
            sourceLayer: 'slide',
            sourceObjectId: 'pptx:fixture/ppt/slides/slide1.xml#7',
            sourceOrder: 1,
            sourcePart: sourcePackage.slides[0]!.slidePart,
            stableId: 'pptx:fixture/ppt/slides/slide1.xml#7',
          },
          src: 'data:image/png;base64,',
          top: 0,
          type: 'image',
          width: 100,
        }, {
          fixedRatio: true,
          height: 100,
          id: 'diagram-image',
          left: 0,
          rotate: 0,
          source: {
            kind: 'pptx',
            nativeShapeId: '12',
            packageId: sourcePackage.packageId,
            slidePart: sourcePackage.slides[0]!.slidePart,
            sourceLayer: 'slide',
            sourceObjectId: 'pptx:fixture/ppt/diagrams/drawing1.xml#12',
            sourceOrder: 2,
            sourcePart: 'ppt/diagrams/drawing1.xml',
            stableId: 'pptx:fixture/ppt/diagrams/drawing1.xml#12',
          },
          src: 'data:image/png;base64,',
          top: 0,
          type: 'image',
          width: 100,
        }],
        id: 'slide-1',
        source: {
          ...sourcePackage.slides[0]!,
          kind: 'pptx',
          packageId: sourcePackage.packageId,
        },
      }],
      sourcePackages: [sourcePackage],
    }

    const result = applyPresentationCommand(state, {
      payload: { id: ['source-image', 'diagram-image'], props: { left: 10 } },
      type: 'element.update',
    })

    expect(result.state.sourcePackages?.[0]?.dirty).toEqual({
      parts: [{
        objectIds: ['pptx:fixture/ppt/diagrams/drawing1.xml#12'],
        partPath: 'ppt/diagrams/drawing1.xml',
        properties: ['left'],
        reasons: ['element.update'],
      }, {
        objectIds: ['pptx:fixture/ppt/slides/slide1.xml#7'],
        partPath: 'ppt/slides/slide1.xml',
        properties: ['left'],
        reasons: ['element.update'],
      }],
      revision: 1,
    })
    expect(result.state.sourcePackages?.[0]?.dirty?.parts).toHaveLength(2)
  })

  it('turns a background edit into a slide-local override instead of leaving inherited rendering active', () => {
    const importedPackage: PowerPointPackageReference = {
      ...sourcePackage,
      hierarchy: {
        layouts: [],
        masters: [{
          background: { color: '#112233', type: 'solid' },
          id: 'master-1',
          layoutIds: [],
          objectIds: [],
          packageId: sourcePackage.packageId,
          partPath: sourcePackage.slides[0]!.masterPart!,
          preserve: false,
        }],
        placeholders: [],
        themes: [],
      },
    }
    const initial: PresentationState = {
      ...presentation(),
      slides: [{
        background: { color: '#112233', type: 'solid' },
        elements: [],
        id: 'slide-1',
        source: {
          ...sourcePackage.slides[0]!,
          backgroundSource: 'master',
          kind: 'pptx',
          packageId: sourcePackage.packageId,
        },
      }],
      sourcePackages: [importedPackage],
    }

    const result = applyPresentationCommand(initial, {
      props: { background: { color: '#abcdef', type: 'solid' } },
      type: 'slide.update',
    })
    const slide = result.state.slides[0]!

    expect(slide.source?.backgroundSource).toBe('slide')
    expect(result.state.sourcePackages?.[0]?.dirty?.parts).toContainEqual(expect.objectContaining({
      partPath: 'ppt/slides/slide1.xml',
      reasons: ['slide.update'],
    }))
    expect(resolveSlideRenderState(slide, result.state.sourcePackages).background).toEqual({
      color: '#abcdef',
      type: 'solid',
    })

    const replaced = applyPresentationCommand(initial, {
      slides: [{
        ...initial.slides[0]!,
        background: { color: '#fedcba', type: 'solid' },
      }],
      type: 'presentation.slides.replace',
    })
    expect(replaced.state.slides[0]!.source?.backgroundSource).toBe('slide')
    expect(replaced.state.sourcePackages?.[0]?.dirty?.parts).toContainEqual(expect.objectContaining({
      partPath: 'ppt/slides/slide1.xml',
      reasons: ['presentation.slides.replace'],
    }))
  })

  it('journals chart, workbook, notes, and comment parts instead of over-marking the slide', () => {
    const semanticPackage: PowerPointPackageReference = {
      ...sourcePackage,
      document: {
        commentAuthors: [],
        comments: [{ id: '1', partPath: 'ppt/comments/comment1.xml', slidePart: 'ppt/slides/slide1.xml', text: 'Review' }],
        customShows: [],
        notesMasters: [],
        notesSlides: [],
        properties: {},
        sections: [],
        timings: [],
      },
      slides: [{ ...sourcePackage.slides[0]!, notesPart: 'ppt/notesSlides/notesSlide1.xml' }],
    }
    const chart: PPTChartElement = {
      chartSource: {
        partPath: 'ppt/charts/chart1.xml',
        relationshipIds: { chart: 'rIdChart' },
        workbookPart: 'ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx',
      },
      chartType: 'bar',
      data: { labels: ['A'], legends: ['Series 1'], series: [[1]] },
      height: 100,
      id: 'chart-1',
      left: 0,
      rotate: 0,
      source: {
        kind: 'pptx',
        nativeShapeId: '9',
        packageId: sourcePackage.packageId,
        slidePart: sourcePackage.slides[0]!.slidePart,
        sourceLayer: 'slide',
        sourceObjectId: 'pptx:fixture/ppt/slides/slide1.xml#9',
        sourcePart: sourcePackage.slides[0]!.slidePart,
        stableId: 'pptx:fixture/ppt/slides/slide1.xml#9',
      },
      themeColors: ['#123456'],
      top: 0,
      type: 'chart',
      width: 100,
    }
    const initial: PresentationState = {
      ...presentation(),
      slides: [{
        elements: [chart],
        id: 'slide-1',
        source: { ...semanticPackage.slides[0]!, kind: 'pptx', packageId: sourcePackage.packageId },
      }],
      sourcePackages: [semanticPackage],
    }

    const chartEdit = applyPresentationCommand(initial, {
      payload: { id: chart.id, props: { data: { labels: ['B'], legends: ['Series 1'], series: [[2]] } } },
      type: 'element.update',
    })
    expect(chartEdit.state.sourcePackages?.[0]?.dirty?.parts.map(part => part.partPath)).toEqual([
      'ppt/charts/chart1.xml',
      'ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx',
    ])

    const notesEdit = applyPresentationCommand(initial, {
      props: { remark: '<p>Updated notes</p>' },
      type: 'slide.update',
    })
    expect(notesEdit.state.sourcePackages?.[0]?.dirty?.parts.map(part => part.partPath)).toEqual([
      'ppt/notesSlides/notesSlide1.xml',
    ])

    const commentsEdit = applyPresentationCommand(initial, {
      props: { notes: [{ content: 'Updated', id: '1', time: 0, user: 'Ada' }] },
      type: 'slide.update',
    })
    expect(commentsEdit.state.sourcePackages?.[0]?.dirty?.parts.map(part => part.partPath)).toEqual([
      'ppt/comments/comment1.xml',
    ])
  })
})
