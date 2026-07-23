import { describe, expect, it } from 'vitest'
import type { NativeObjectIdentity } from '@mona/pptx-parser'

import type {
  PowerPointPackageManifest,
  PowerPointPackageReference,
  SlideTheme,
} from '@mona/presentation-core'

import {
  convertParsedPptxPresentation,
  type ParsedPptxPresentation,
} from '@/features/editor/editor-pptx-import'

const native = (
  id: string,
  partPath: string,
  kind: NativeObjectIdentity['kind'],
  name?: string,
): NativeObjectIdentity => ({
  id,
  kind,
  ...(name ? { name } : {}),
  partPath,
  sourceLayer: partPath.includes('/slideLayouts/')
    ? 'layout'
    : partPath.includes('/slideMasters/')
      ? 'master'
      : 'slide',
})

const image = (order: number, ref: string, identity?: NativeObjectIdentity) => ({
  base64: `data:image/png;base64,${ref}`,
  blob: '',
  borderColor: '#000000',
  borderStrokeDasharray: '0',
  borderType: 'solid' as const,
  borderWidth: 0,
  geom: 'rect',
  height: 100,
  isFlipH: false,
  isFlipV: false,
  left: 10,
  order,
  ref,
  rotate: 0,
  top: 20,
  type: 'image' as const,
  width: 200,
  ...(identity ? { native: identity } : {}),
})

const shape = (order: number, name: string, identity?: NativeObjectIdentity) => ({
  borderColor: '#000000',
  borderStrokeDasharray: '0',
  borderType: 'solid' as const,
  borderWidth: 0,
  content: '',
  fill: { type: 'color' as const, value: '#ffffff' },
  height: 100,
  isFlipH: false,
  isFlipV: false,
  keypoints: {},
  left: 10,
  name,
  order,
  path: 'M 0 0 L 200 0 L 200 200 L 0 200 Z',
  pathViewBox: { height: 200, width: 200, x: 0, y: 0 },
  rotate: 0,
  shapType: 'rect',
  top: 20,
  type: 'shape' as const,
  vAlign: 'mid',
  width: 200,
  ...(identity ? { native: identity } : {}),
})

const theme: SlideTheme = {
  backgroundColor: '#ffffff',
  fontColor: '#111111',
  fontName: 'Arial',
  outline: { color: '#000000', style: 'solid', width: 1 },
  shadow: { blur: 0, color: '#000000', h: 0, v: 0 },
  themeColors: ['#336699'],
}

const sourcePackage: PowerPointPackageReference = {
  byteLength: 100,
  fileName: 'source.pptx',
  kind: 'pptx',
  packageId: 'pptx:source',
  slides: [{
    layoutPart: 'ppt/slideLayouts/slideLayout1.xml',
    masterPart: 'ppt/slideMasters/slideMaster1.xml',
    presentationSlideId: '256',
    relationshipId: 'rId1',
    slidePart: 'ppt/slides/slide1.xml',
    themePart: 'ppt/theme/theme1.xml',
  }],
}

const sourceManifest: PowerPointPackageManifest = {
  ...sourcePackage,
  issues: [],
  objects: [],
  parts: [
    { kind: 'presentation', path: 'ppt/presentation.xml' },
    { kind: 'slide', path: 'ppt/slides/slide1.xml' },
    { kind: 'unknown', path: 'ppt/extensions/future.xml' },
  ],
  relationships: [{
    external: false,
    id: 'rId1',
    sourcePart: 'ppt/presentation.xml',
    target: 'ppt/slides/slide1.xml',
    type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide',
  }],
  schemaVersion: 1,
}

describe('PowerPoint import provenance', () => {
  it('keeps inherited objects beneath local objects and records their source package', () => {
    const layoutIdentity = {
      kind: 'picture' as const,
      nativeId: '8',
      partPath: 'ppt/slideLayouts/slideLayout1.xml',
      sourceIndex: 0,
      stableId: 'pptx:source/ppt/slideLayouts/slideLayout1.xml#8',
    }
    const slideIdentity = {
      kind: 'picture' as const,
      nativeId: '9',
      partPath: 'ppt/slides/slide1.xml',
      sourceIndex: 0,
      stableId: 'pptx:source/ppt/slides/slide1.xml#9',
    }
    const parsed: ParsedPptxPresentation = {
      size: { height: 540, width: 960 },
      slides: [{
        elements: [image(1, 'slide', native('9', slideIdentity.partPath, 'picture'))],
        fill: { type: 'color', value: '#ffffff' },
        layoutElements: [image(99, 'layout', native('8', layoutIdentity.partPath, 'picture'))],
        note: '',
      }],
      themeColors: [],
      usedFonts: [],
    }
    const conversion = convertParsedPptxPresentation({
      coordinateLabel: index => String(index),
      parsed,
      ratio: 1,
      sourceManifest: { ...sourceManifest, objects: [layoutIdentity, slideIdentity] },
      sourcePackage,
      theme,
    })

    expect(conversion.slides[0]?.source).toEqual({
      ...sourcePackage.slides[0],
      kind: 'pptx',
      packageId: 'pptx:source',
    })
    expect(conversion.slides[0]?.elements.map(element => element.source?.sourceLayer)).toEqual(['slide'])
    expect(conversion.sourcePackage?.hierarchy?.layouts[0]?.elements?.[0]?.source).toMatchObject({
      packageId: 'pptx:source',
      slidePart: 'ppt/slides/slide1.xml',
      stableId: layoutIdentity.stableId,
      sourceLayer: 'layout',
      sourceOrder: 99,
      sourcePart: layoutIdentity.partPath,
    })
    expect(conversion.slides[0]?.elements[0]?.source).toMatchObject({
      packageId: 'pptx:source',
      slidePart: 'ppt/slides/slide1.xml',
      stableId: slideIdentity.stableId,
      sourceLayer: 'slide',
      sourceOrder: 1,
      sourcePart: slideIdentity.partPath,
    })
  })

  it('produces a deterministic package and per-slide loss report', () => {
    const layoutIdentity = {
      kind: 'picture' as const,
      nativeId: '8',
      partPath: 'ppt/slideLayouts/slideLayout1.xml',
      sourceIndex: 0,
      stableId: 'pptx:source/ppt/slideLayouts/slideLayout1.xml#8',
    }
    const slideIdentity = {
      kind: 'picture' as const,
      nativeId: '9',
      partPath: 'ppt/slides/slide1.xml',
      sourceIndex: 0,
      stableId: 'pptx:source/ppt/slides/slide1.xml#9',
    }
    const parsed: ParsedPptxPresentation = {
      size: { height: 540, width: 960 },
      slides: [{
        elements: [image(1, 'slide', native('9', slideIdentity.partPath, 'picture'))],
        fill: { type: 'color', value: '#ffffff' },
        layoutElements: [image(99, 'layout', native('8', layoutIdentity.partPath, 'picture'))],
        note: '',
      }],
      themeColors: [],
      usedFonts: [],
    }
    const conversion = convertParsedPptxPresentation({
      coordinateLabel: index => String(index),
      parsed,
      ratio: 1,
      sourceManifest: { ...sourceManifest, objects: [layoutIdentity, slideIdentity] },
      sourcePackage,
      theme,
    })

    expect(conversion.report).toMatchObject({
      counts: { approximated: 2, dropped: 0, modeled: 0, opaque: 0 },
      packageId: 'pptx:source',
      packageIssues: [],
      packageParts: {
        preserved: 3,
        relationships: 1,
        total: 3,
        unknown: 1,
      },
      schemaVersion: 1,
      status: 'complete-with-approximations',
    })
    expect(conversion.report.slides).toEqual([expect.objectContaining({
      capabilities: [{
        approximated: 2,
        dropped: 0,
        modeled: 0,
        opaque: 0,
        sourceType: 'image',
      }],
      counts: { approximated: 2, dropped: 0, modeled: 0, opaque: 0 },
      issues: [],
      outputElementCount: 2,
      slideIndex: 0,
      slidePart: 'ppt/slides/slide1.xml',
      sourceObjectCount: 2,
    })])
  })

  it('resolves by native part and id even when names are duplicated', () => {
    const nativeIdentity = {
      kind: 'shape' as const,
      name: 'Duplicate name',
      nativeId: '7',
      partPath: 'ppt/slides/slide1.xml',
      sourceIndex: 0,
      stableId: 'pptx:source/ppt/slides/slide1.xml#7',
    }
    const sameNameIdentity = {
      ...nativeIdentity,
      nativeId: '8',
      sourceIndex: 1,
      stableId: 'pptx:source/ppt/slides/slide1.xml#8',
    }
    const parsed: ParsedPptxPresentation = {
      size: { height: 540, width: 960 },
      slides: [{
        elements: [shape(10, nativeIdentity.name, native(
          nativeIdentity.nativeId,
          nativeIdentity.partPath,
          'shape',
          nativeIdentity.name,
        ))],
        fill: { type: 'color', value: '#ffffff' },
        layoutElements: [],
        note: '',
      }],
      themeColors: [],
      usedFonts: [],
    }
    const conversion = convertParsedPptxPresentation({
      coordinateLabel: index => String(index),
      parsed,
      ratio: 1,
      sourceManifest: { ...sourceManifest, objects: [nativeIdentity, sameNameIdentity] },
      sourcePackage,
      theme,
    })

    expect(conversion.slides[0]?.elements[0]?.source).toMatchObject({
      nativeShapeId: '7',
      sourceObjectId: nativeIdentity.stableId,
      sourcePart: 'ppt/slides/slide1.xml',
      stableId: nativeIdentity.stableId,
    })
  })

  it('resolves native inherited objects to their layout layer', () => {
    const layoutIdentity = {
      kind: 'shape' as const,
      name: 'Layout title',
      nativeId: '11',
      partPath: 'ppt/slideLayouts/slideLayout1.xml',
      placeholderType: 'title',
      sourceIndex: 0,
      stableId: 'pptx:source/ppt/slideLayouts/slideLayout1.xml#11',
    }
    const parsed: ParsedPptxPresentation = {
      size: { height: 540, width: 960 },
      slides: [{
        elements: [],
        fill: { type: 'color', value: '#ffffff' },
        layoutElements: [shape(4, layoutIdentity.name, native(
          layoutIdentity.nativeId,
          layoutIdentity.partPath,
          'shape',
          layoutIdentity.name,
        ))],
        note: '',
      }],
      themeColors: [],
      usedFonts: [],
    }
    const conversion = convertParsedPptxPresentation({
      coordinateLabel: index => String(index),
      parsed,
      ratio: 1,
      sourceManifest: { ...sourceManifest, objects: [layoutIdentity] },
      sourcePackage,
      theme,
    })

    expect(conversion.sourcePackage?.hierarchy?.layouts[0]?.elements?.[0]?.source).toMatchObject({
      nativeShapeId: '11',
      sourceLayer: 'layout',
      sourceObjectId: layoutIdentity.stableId,
      sourcePart: layoutIdentity.partPath,
    })
  })

  it('refuses to invent an exact patch target for malformed duplicate native ids', () => {
    const first = {
      kind: 'picture' as const,
      nativeId: '2',
      partPath: 'ppt/slides/slide1.xml',
      sourceIndex: 0,
      stableId: 'pptx:source/ppt/slides/slide1.xml#2',
    }
    const duplicate = {
      ...first,
      sourceIndex: 1,
      stableId: 'pptx:source/ppt/slides/slide1.xml#2:1',
    }
    const parsed: ParsedPptxPresentation = {
      size: { height: 540, width: 960 },
      slides: [{
        elements: [image(1, 'duplicate', native('2', first.partPath, 'picture'))],
        fill: { type: 'color', value: '#ffffff' },
        layoutElements: [],
        note: '',
      }],
      themeColors: [],
      usedFonts: [],
    }
    const conversion = convertParsedPptxPresentation({
      coordinateLabel: String,
      parsed,
      ratio: 1,
      sourceManifest: { ...sourceManifest, objects: [first, duplicate] },
      sourcePackage,
      theme,
    })

    expect(conversion.slides[0]?.elements[0]?.source).toBeUndefined()
    expect(conversion.report.slides[0]?.issues).toContainEqual(expect.objectContaining({
      code: 'pptx.identity.not-in-manifest',
      sourceType: 'image',
    }))
  })

  it('retains native group coordinate trees and source-backed opaque graphic frames', () => {
    const partPath = 'ppt/slides/slide1.xml'
    const groupIdentity = {
      kind: 'group' as const,
      nativeId: '10',
      partPath,
      sourceIndex: 0,
      stableId: 'pptx:source/ppt/slides/slide1.xml#10',
    }
    const childIdentity = {
      kind: 'shape' as const,
      nativeId: '11',
      partPath,
      sourceIndex: 1,
      stableId: 'pptx:source/ppt/slides/slide1.xml#11',
    }
    const opaqueIdentity = {
      kind: 'graphic-frame' as const,
      nativeId: '12',
      partPath,
      sourceIndex: 2,
      stableId: 'pptx:source/ppt/slides/slide1.xml#12',
    }
    const parsed: ParsedPptxPresentation = {
      size: { height: 540, width: 960 },
      slides: [{
        elements: [{
          elements: [shape(1, 'Local child', native('11', partPath, 'shape'))],
          height: 200,
          isFlipH: true,
          isFlipV: false,
          left: 300,
          native: native('10', partPath, 'group'),
          order: 1,
          rotate: 25,
          top: 100,
          type: 'group',
          width: 400,
        }, {
          height: 80,
          label: 'Embedded object',
          left: 20,
          native: native('12', partPath, 'graphic-frame'),
          opaqueType: 'http://schemas.openxmlformats.org/presentationml/2006/ole',
          order: 2,
          reason: 'No semantic renderer',
          relationshipIds: ['rId7'],
          rotate: 5,
          top: 30,
          type: 'opaque',
          width: 160,
        }],
        fill: { type: 'color', value: '#ffffff' },
        layoutElements: [],
        note: '',
      }],
      themeColors: [],
      usedFonts: [],
    }

    const conversion = convertParsedPptxPresentation({
      coordinateLabel: index => String(index),
      parsed,
      ratio: 1,
      sourceManifest: {
        ...sourceManifest,
        objects: [groupIdentity, childIdentity, opaqueIdentity],
      },
      sourcePackage,
      theme,
    })

    const group = conversion.slides[0]!.elements[0]!
    expect(group).toMatchObject({
      coordinateHeight: 200,
      coordinateWidth: 400,
      flipH: true,
      height: 200,
      left: 300,
      rotate: 25,
      semanticType: 'group',
      top: 100,
      type: 'group',
      width: 400,
    })
    expect(group.type === 'group' ? group.elements[0] : undefined).toMatchObject({
      left: 10,
      source: {
        sourceObjectId: childIdentity.stableId,
        sourcePart: partPath,
      },
      top: 20,
      type: 'shape',
    })
    expect(conversion.slides[0]!.elements[1]).toMatchObject({
      label: 'Embedded object',
      opaqueType: 'http://schemas.openxmlformats.org/presentationml/2006/ole',
      relationshipIds: ['rId7'],
      source: {
        sourceObjectId: opaqueIdentity.stableId,
        sourcePart: partPath,
      },
      type: 'opaque',
    })
    expect(conversion.report).toMatchObject({
      counts: { approximated: 2, dropped: 0, modeled: 0, opaque: 1 },
      status: 'complete-with-approximations',
    })
  })
})
