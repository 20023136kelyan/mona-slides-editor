import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import {
  flattenElementTree,
  retainElementTreeCopyOrigins,
  resolveSlideRenderState,
  type PPTElement,
  type SlideTheme,
} from '@mona/presentation-core'
import { ingestPowerPoint } from '@mona/pptx-ingestion'

import {
  analyzePowerPointWriteback,
  PowerPointWritebackError,
  writeBackPowerPoint,
} from './index'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const FIXTURE = join(REPO_ROOT, 'tests/corpus/public/corpus-01-text.pptx')
const PUBLIC_FIXTURES = [
  'corpus-01-text.pptx',
  'corpus-02-shapes-lines.pptx',
  'corpus-03-media.pptx',
  'corpus-04-chart-table.pptx',
  'corpus-05-groups.pptx',
]
const PRIVATE_FIXTURE_ROOT = join(REPO_ROOT, 'tests/corpus/private')
const PRIVATE_FIXTURES = (await readdir(PRIVATE_FIXTURE_ROOT).catch(() => []))
  .filter(fileName => fileName.toLowerCase().endsWith('.pptx'))
  .sort()

const writeReferenceArtifact = async (name: string, bytes: ArrayBuffer): Promise<void> => {
  if (process.env.MONA_WRITE_PPTX_ROUNDTRIP_ARTIFACTS !== '1') return
  const target = join(REPO_ROOT, '.artifacts/pptx-roundtrip')
  await mkdir(target, { recursive: true })
  await writeFile(join(target, name), Buffer.from(bytes))
}

const theme: SlideTheme = {
  backgroundColor: '#ffffff',
  fontColor: '#333333',
  fontName: '',
  outline: { color: '#525252', style: 'solid', width: 2 },
  shadow: { blur: 2, color: '#808080', h: 3, v: 3 },
  themeColors: ['#5b9bd5', '#ed7d31', '#a5a5a5', '#ffc000', '#4472c4', '#70ad47'],
}

const source = async () => {
  const bytes = await readFile(FIXTURE)
  return {
    bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    ingested: await ingestPowerPoint(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      { fileName: 'corpus-01-text.pptx', theme },
    ),
  }
}

const sourceWithNotes = async () => {
  const bytes = await readFile(FIXTURE)
  const zip = await JSZip.loadAsync(bytes)
  const relationshipPath = 'ppt/slides/_rels/slide1.xml.rels'
  const relationships = await zip.file(relationshipPath)!.async('text')
  zip.file(relationshipPath, relationships.replace(
    '</Relationships>',
    '<Relationship Id="rIdMonaNotes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/>'
      + '<Relationship Id="rIdMonaComments" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="../comments/comment1.xml"/></Relationships>',
  ))
  zip.file(
    'ppt/notesSlides/notesSlide1.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes Placeholder"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>Original notes</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>',
  )
  zip.file(
    'ppt/comments/comment1.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:cmLst xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cm authorId="0" dt="2026-08-01T12:00:00Z" idx="5"><p:pos x="120" y="240"/><p:text>Original comment</p:text></p:cm></p:cmLst>',
  )
  zip.file(
    'ppt/commentAuthors.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:cmAuthorLst xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cmAuthor id="0" name="Ada" initials="AL" lastIdx="5"/></p:cmAuthorLst>',
  )
  const archive = await zip.generateAsync({ type: 'arraybuffer' })
  return {
    bytes: archive,
    ingested: await ingestPowerPoint(archive, { fileName: 'notes.pptx', theme }),
  }
}

const patchableElement = (
  presentation: Awaited<ReturnType<typeof source>>['ingested']['presentation'],
): Exclude<PPTElement, { type: 'line' }> => {
  const element = presentation.slides.flatMap(slide => slide.elements).find(
    candidate => (
      candidate.type !== 'line'
      && candidate.source?.sourceLayer === 'slide'
      && candidate.source.sourcePart === candidate.source.slidePart
      && candidate.width > 0
      && candidate.height > 0
    ),
  )
  if (!element || element.type === 'line') throw new Error('Fixture has no patchable slide-local element.')
  return element
}

const elementBySource = (
  presentation: Awaited<ReturnType<typeof source>>['ingested']['presentation'],
  sourceElement: PPTElement,
): PPTElement | undefined => (
  presentation.slides.flatMap(slide => flattenElementTree(slide.elements)).find(element => (
    element.source?.nativeShapeId === sourceElement.source?.nativeShapeId
    && element.source?.sourcePart === sourceElement.source?.sourcePart
  ))
)

const editableTextElement = (
  presentation: Awaited<ReturnType<typeof source>>['ingested']['presentation'],
): Extract<PPTElement, { type: 'shape' | 'text' }> => {
  const element = presentation.slides.flatMap(slide => flattenElementTree(slide.elements)).find(
    (candidate): candidate is Extract<PPTElement, { type: 'shape' | 'text' }> => (
      (candidate.type === 'text' || (candidate.type === 'shape' && Boolean(candidate.text)))
      && candidate.source?.sourceLayer === 'slide'
      && candidate.source.sourcePart === candidate.source.slidePart
    ),
  )
  if (!element) throw new Error('Fixture has no editable source text body.')
  return element
}

const editableLineElement = (
  presentation: Awaited<ReturnType<typeof source>>['ingested']['presentation'],
): Extract<PPTElement, { type: 'line' }> => {
  const element = presentation.slides.flatMap(slide => flattenElementTree(slide.elements)).find(
    (candidate): candidate is Extract<PPTElement, { type: 'line' }> => (
      candidate.type === 'line'
      && !candidate.broken
      && !candidate.broken2
      && !candidate.curve
      && !candidate.cubic
      && candidate.source?.sourceLayer === 'slide'
      && candidate.source.sourcePart === candidate.source.slidePart
    ),
  )
  if (!element) throw new Error('Fixture has no editable source straight line.')
  return element
}

const editableTableElement = (
  presentation: Awaited<ReturnType<typeof source>>['ingested']['presentation'],
): Extract<PPTElement, { type: 'table' }> => {
  const element = presentation.slides.flatMap(slide => flattenElementTree(slide.elements)).find(
    (candidate): candidate is Extract<PPTElement, { type: 'table' }> => (
      candidate.type === 'table'
      && candidate.data.length >= 2
      && (candidate.data[0]?.length ?? 0) >= 2
      && candidate.source?.sourceLayer === 'slide'
      && candidate.source.sourcePart === candidate.source.slidePart
    ),
  )
  if (!element) throw new Error('Fixture has no editable source table.')
  return element
}

const editableChartElement = (
  presentation: Awaited<ReturnType<typeof source>>['ingested']['presentation'],
  preferredType?: Extract<PPTElement, { type: 'chart' }>['chartType'],
): Extract<PPTElement, { type: 'chart' }> => {
  const charts = presentation.slides.flatMap(slide => flattenElementTree(slide.elements)).filter(
    (candidate): candidate is Extract<PPTElement, { type: 'chart' }> => (
      candidate.type === 'chart'
      && Boolean(candidate.chartSource?.partPath)
      && Boolean(candidate.chartSource?.workbookPart)
      && candidate.source?.sourceLayer === 'slide'
      && candidate.source.sourcePart === candidate.source.slidePart
    ),
  )
  const element = charts.find(chart => !preferredType || chart.chartType === preferredType) ?? charts[0]
  if (!element) throw new Error('Fixture has no editable native chart.')
  return element
}

const absoluteLinePoint = (
  line: Extract<PPTElement, { type: 'line' }>,
  endpoint: 'end' | 'start',
): [number, number] => [
  line.left + line[endpoint][0],
  line.top + line[endpoint][1],
]

describe('PowerPoint source-package writeback', () => {
  it.each(PUBLIC_FIXTURES)(
    'keeps every byte of an unchanged public corpus deck: %s',
    async fileName => {
      const bytes = await readFile(join(REPO_ROOT, 'tests/corpus/public', fileName))
      const archive = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer
      const ingested = await ingestPowerPoint(archive, { fileName, theme })
      const result = await writeBackPowerPoint({
        baseline: ingested.presentation,
        bytes: archive,
        manifest: ingested.backing.manifest,
        presentation: structuredClone(ingested.presentation),
      })

      expect(result.plan).toMatchObject({
        mode: 'noop',
        operations: [],
        touchedParts: [],
        unsupported: [],
      })
      expect(Buffer.from(result.bytes).equals(Buffer.from(archive))).toBe(true)
    },
  )

  it('serializes a Mona-authored text box into an imported slide as editable native text', async () => {
    const fixture = await source()
    const desired = structuredClone(fixture.ingested.presentation)
    const slide = desired.slides[0]!
    const template = editableTextElement(desired)
    const generated = structuredClone(template)
    delete generated.source
    generated.id = 'generated-text-box'
    generated.left += 72
    generated.top += 24
    if (generated.type === 'text') {
      generated.content = '<p><strong>Generated title</strong></p><p>Editable body</p>'
      delete generated.structuredText
    }
    else if (generated.text) {
      generated.text.content = '<p><strong>Generated title</strong></p><p>Editable body</p>'
      delete generated.text.structuredText
    }
    slide.elements.push(generated)

    const result = await writeBackPowerPoint({
      baseline: fixture.ingested.presentation,
      bytes: fixture.bytes,
      manifest: fixture.ingested.backing.manifest,
      presentation: desired,
    })

    expect(result.plan.unsupported).toEqual([])
    expect(result.plan.operations).toContainEqual(expect.objectContaining({
      elementId: generated.id,
      kind: 'insert-element',
      targetPart: slide.source?.slidePart,
    }))
    const reimported = await ingestPowerPoint(result.bytes, {
      fileName: 'generated-text-box.pptx',
      theme,
    })
    const generatedText = flattenElementTree(reimported.presentation.slides[0]!.elements).find(element => (
      (element.type === 'text' && element.content.includes('Generated title'))
      || (element.type === 'shape' && element.text?.content.includes('Generated title'))
    ))
    expect(['shape', 'text']).toContain(generatedText?.type)
    const content = generatedText?.type === 'text'
      ? generatedText.content
      : generatedText?.type === 'shape'
        ? generatedText.text?.content
        : undefined
    expect(content).toContain('Editable body')
    expect(generatedText?.source?.sourceObjectId).toBeTruthy()
  })

  it('serializes Mona-authored image bytes into the retained package and relationship graph', async () => {
    const fixture = await source()
    const desired = structuredClone(fixture.ingested.presentation)
    const slide = desired.slides[0]!
    const assetReference = 'mona-test://generated-pixel.png'
    const generated: Extract<PPTElement, { type: 'image' }> = {
      fixedRatio: true,
      height: 72,
      id: 'generated-image',
      left: 40,
      rotate: 0,
      src: assetReference,
      top: 40,
      type: 'image',
      width: 72,
    }
    slide.elements.push(generated)
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    )

    const result = await writeBackPowerPoint({
      baseline: fixture.ingested.presentation,
      bytes: fixture.bytes,
      manifest: fixture.ingested.backing.manifest,
      presentation: desired,
      resolveAsset: async reference => reference === assetReference
        ? { bytes: png, mediaType: 'image/png' }
        : undefined,
    })
    const zip = await JSZip.loadAsync(result.bytes)
    expect(Object.keys(zip.files).some(path => /^ppt\/media\/.+\.png$/i.test(path))).toBe(true)
    const reimported = await ingestPowerPoint(result.bytes, {
      fileName: 'generated-image.pptx',
      theme,
    })
    const inserted = flattenElementTree(reimported.presentation.slides[0]!.elements).find(element => (
      element.type === 'image'
      && Math.abs(element.left - generated.left) < 0.1
      && Math.abs(element.top - generated.top) < 0.1
    ))
    expect(inserted?.type).toBe('image')
    expect(inserted?.source?.sourceObjectId).toBeTruthy()
  })

  it('serializes a Mona-authored chart with an independently editable workbook', async () => {
    const bytes = await readFile(join(REPO_ROOT, 'tests/corpus/public/corpus-04-chart-table.pptx'))
    const archive = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    const ingested = await ingestPowerPoint(archive, { fileName: 'generated-chart-source.pptx', theme })
    const desired = structuredClone(ingested.presentation)
    const slide = desired.slides[0]!
    const generated = structuredClone(editableChartElement(desired))
    delete generated.source
    delete generated.chartSource
    delete generated.chartSpace
    generated.id = 'generated-chart'
    generated.left += 56
    generated.top += 32
    generated.data = {
      labels: ['North', 'South', 'West'],
      legends: ['Plan', 'Actual'],
      series: [[12, 18, 23], [10, 21, 20]],
    }
    generated.options = { legendPosition: 'bottom', showLegend: true }
    slide.elements.push(generated)

    const result = await writeBackPowerPoint({
      baseline: ingested.presentation,
      bytes: archive,
      manifest: ingested.backing.manifest,
      presentation: desired,
    })
    const reimported = await ingestPowerPoint(result.bytes, {
      fileName: 'generated-chart-roundtrip.pptx',
      theme,
    })
    const inserted = flattenElementTree(reimported.presentation.slides[0]!.elements).find(
      (element): element is Extract<PPTElement, { type: 'chart' }> => (
        element.type === 'chart'
        && element.data.legends.includes('Plan')
        && element.data.legends.includes('Actual')
      ),
    )
    expect(inserted).toBeTruthy()
    expect(inserted?.chartSource?.partPath).toBeTruthy()
    expect(inserted?.chartSource?.workbookPart).toBeTruthy()
    expect(inserted?.data.series).toEqual(generated.data.series)
  })

  it('authors a generated editable text box directly into an explicit shared master layer', async () => {
    const fixture = await source()
    const desired = structuredClone(fixture.ingested.presentation)
    const sourcePackage = desired.sourcePackages?.[0]
    const master = sourcePackage?.hierarchy?.masters[0]
    if (!sourcePackage || !master) throw new Error('Fixture has no retained PowerPoint master.')
    const generated: Extract<PPTElement, { type: 'text' }> = {
      content: '<p><strong>Shared master label</strong></p>',
      defaultColor: '#222222',
      defaultFontName: 'Arial',
      height: 28,
      id: 'generated-master-text',
      left: 24,
      rotate: 0,
      top: 500,
      type: 'text',
      width: 220,
    }
    master.elements = [...(master.elements ?? []), generated]
    sourcePackage.sharedAuthoring = {
      partPaths: [master.partPath],
      revision: 1,
    }

    const result = await writeBackPowerPoint({
      baseline: fixture.ingested.presentation,
      bytes: fixture.bytes,
      manifest: fixture.ingested.backing.manifest,
      presentation: desired,
    })

    expect(result.plan.unsupported).toEqual([])
    expect(result.plan.operations).toContainEqual(expect.objectContaining({
      elementId: generated.id,
      kind: 'insert-element',
      targetPart: master.partPath,
    }))
    const reimported = await ingestPowerPoint(result.bytes, {
      fileName: 'generated-shared-master-text.pptx',
      theme,
    })
    const roundTrippedMaster = reimported.presentation.sourcePackages?.[0]?.hierarchy?.masters.find(
      candidate => candidate.partPath === master.partPath,
    )
    const inserted = flattenElementTree(roundTrippedMaster?.elements ?? []).find(element => (
      (element.type === 'text' && element.content.includes('Shared master label'))
      || (element.type === 'shape' && element.text?.content.includes('Shared master label'))
    ))
    expect(['shape', 'text']).toContain(inserted?.type)
    expect(inserted?.source?.sourcePart).toBe(master.partPath)
  })

  it.skipIf(!PRIVATE_FIXTURES.length)('patches a source-backed object in an explicitly authored real shared layer', async () => {
    const fileName = PRIVATE_FIXTURES.find(name => name.includes('corporate')) ?? PRIVATE_FIXTURES[0]!
    const bytes = await readFile(join(PRIVATE_FIXTURE_ROOT, fileName))
    const archive = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    const ingested = await ingestPowerPoint(archive, { fileName, theme })
    const desired = structuredClone(ingested.presentation)
    const sourcePackage = desired.sourcePackages?.[0]
    const candidate = [
      ...(sourcePackage?.hierarchy?.layouts ?? []),
      ...(sourcePackage?.hierarchy?.masters ?? []),
    ].flatMap(layer => flattenElementTree(layer.elements ?? []).map(element => ({ element, layer })))
      .find(({ element }) => element.type !== 'line' && Boolean(element.source?.sourceObjectId))
    if (!sourcePackage || !candidate || candidate.element.type === 'line') {
      throw new Error('Private fixture has no addressable shared-layer object.')
    }
    const objectId = candidate.element.source?.sourceObjectId
    const nativeShapeId = candidate.element.source?.nativeShapeId
    candidate.element.left += 14
    sourcePackage.sharedAuthoring = { partPaths: [candidate.layer.partPath], revision: 1 }

    const result = await writeBackPowerPoint({
      baseline: ingested.presentation,
      bytes: archive,
      manifest: ingested.backing.manifest,
      presentation: desired,
    })
    expect(result.plan.unsupported).toEqual([])
    expect(result.plan.operations).toContainEqual(expect.objectContaining({
      kind: 'transform',
      objectId,
      partPath: candidate.layer.partPath,
    }))
    const reimported = await ingestPowerPoint(result.bytes, {
      fileName: `shared-${fileName}`,
      theme,
    })
    const roundTripped = [
      ...(reimported.presentation.sourcePackages?.[0]?.hierarchy?.layouts ?? []),
      ...(reimported.presentation.sourcePackages?.[0]?.hierarchy?.masters ?? []),
    ].flatMap(layer => flattenElementTree(layer.elements ?? []))
      .find(element => (
        element.source?.sourcePart === candidate.layer.partPath
        && element.source?.nativeShapeId === nativeShapeId
      ))
    expect(roundTripped?.left).toBeCloseTo(candidate.element.left, 2)
  }, 15_000)

  it('serializes generated native tables and semantic connector groups', async () => {
    const bytes = await readFile(join(REPO_ROOT, 'tests/corpus/public/corpus-04-chart-table.pptx'))
    const archive = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    const ingested = await ingestPowerPoint(archive, { fileName: 'generated-objects-source.pptx', theme })
    const desired = structuredClone(ingested.presentation)
    const slide = desired.slides[0]!
    const table: Extract<PPTElement, { type: 'table' }> = {
      cellMinHeight: 28,
      colWidths: [0.5, 0.5],
      data: [[
        { colspan: 1, id: 'table-a1', rowspan: 1, style: { backcolor: '#E5E7EB', bold: true }, text: 'Metric' },
        { colspan: 1, id: 'table-b1', rowspan: 1, style: { backcolor: '#E5E7EB', bold: true }, text: 'Value' },
      ], [
        { colspan: 1, id: 'table-a2', rowspan: 1, text: 'Growth' },
        { colspan: 1, id: 'table-b2', rowspan: 1, text: '24%' },
      ]],
      height: 120,
      id: 'generated-table',
      left: 60,
      outline: { color: '#9CA3AF', style: 'solid', width: 1 },
      rotate: 0,
      top: 40,
      type: 'table',
      width: 320,
    }
    const group: Extract<PPTElement, { type: 'group' }> = {
      coordinateHeight: 160,
      coordinateWidth: 260,
      elements: [{
        color: '#C2410C',
        end: [220, 120],
        id: 'generated-group-line',
        left: 10,
        points: ['', 'arrow'],
        start: [0, 0],
        style: 'dashed',
        top: 10,
        type: 'line',
        width: 3,
      }, {
        content: '<p>Grouped and editable</p>',
        defaultColor: '#111827',
        defaultFontName: 'Arial',
        height: 36,
        id: 'generated-group-text',
        left: 20,
        rotate: 0,
        top: 80,
        type: 'text',
        width: 190,
      }],
      height: 160,
      id: 'generated-group',
      left: 500,
      rotate: 0,
      top: 220,
      type: 'group',
      width: 260,
    }
    slide.elements.push(table, group)

    const result = await writeBackPowerPoint({
      baseline: ingested.presentation,
      bytes: archive,
      manifest: ingested.backing.manifest,
      presentation: desired,
    })
    expect(result.plan.unsupported).toEqual([])
    const reimported = await ingestPowerPoint(result.bytes, {
      fileName: 'generated-objects-roundtrip.pptx',
      theme,
    })
    const elements = flattenElementTree(reimported.presentation.slides[0]!.elements)
    expect(elements.some(element => element.type === 'table' && Math.abs(element.left - table.left) < 0.1)).toBe(true)
    const insertedGroup = reimported.presentation.slides[0]!.elements.find(element => (
      element.type === 'group' && Math.abs(element.left - group.left) < 0.1
    ))
    expect(insertedGroup?.type).toBe('group')
    if (insertedGroup?.type !== 'group') return
    expect(flattenElementTree(insertedGroup.elements).some(element => element.type === 'line')).toBe(true)
    expect(flattenElementTree(insertedGroup.elements).some(element => (
      (element.type === 'text' && element.content.includes('Grouped and editable'))
      || (element.type === 'shape' && element.text?.content.includes('Grouped and editable'))
    ))).toBe(true)
  })

  it('serializes generated picture-filled shapes, vector formulas, audio, and video dependencies', async () => {
    const fixture = await source()
    const desired = structuredClone(fixture.ingested.presentation)
    const slide = desired.slides[0]!
    const pictureReference = 'mona-test://shape-fill.png'
    const videoReference = 'mona-test://clip.mp4'
    const audioReference = 'mona-test://sound.mp3'
    const posterReference = 'mona-test://poster.png'
    const shape: Extract<PPTElement, { type: 'shape' }> = {
      fill: '#FFFFFF',
      fixedRatio: false,
      height: 90,
      id: 'generated-picture-shape',
      left: 30,
      path: 'M 0 0 L 100 0 L 100 100 L 0 100 Z',
      pattern: pictureReference,
      patternFit: { mode: 'tile', scaleX: 0.5, scaleY: 0.5 },
      rotate: 0,
      top: 30,
      type: 'shape',
      viewBox: [100, 100],
      width: 140,
    }
    const formula: Extract<PPTElement, { type: 'latex' }> = {
      color: '#111827',
      fixedRatio: true,
      height: 55,
      id: 'generated-vector-formula',
      latex: 'x^2+y^2',
      left: 200,
      path: 'M 2 25 L 22 5 M 2 5 L 22 25',
      rotate: 0,
      strokeWidth: 2,
      top: 40,
      type: 'latex',
      viewBox: [24, 30],
      width: 90,
    }
    const video: Extract<PPTElement, { type: 'video' }> = {
      autoplay: false,
      ext: 'mp4',
      height: 90,
      id: 'generated-video',
      left: 320,
      poster: posterReference,
      rotate: 0,
      src: videoReference,
      top: 30,
      type: 'video',
      width: 160,
    }
    const audio: Extract<PPTElement, { type: 'audio' }> = {
      autoplay: false,
      color: '#111827',
      ext: 'mp3',
      fixedRatio: true,
      height: 48,
      id: 'generated-audio',
      left: 510,
      loop: false,
      rotate: 0,
      src: audioReference,
      top: 50,
      type: 'audio',
      width: 48,
    }
    slide.elements.push(shape, formula, video, audio)
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    )
    const assets = new Map<string, { bytes: Uint8Array; mediaType: string }>([
      [pictureReference, { bytes: png, mediaType: 'image/png' }],
      [posterReference, { bytes: png, mediaType: 'image/png' }],
      [videoReference, {
        bytes: Buffer.from('000000186674797069736f6d0000020069736f6d69736f32', 'hex'),
        mediaType: 'video/mp4',
      }],
      [audioReference, { bytes: Buffer.from('49443304000000000000', 'hex'), mediaType: 'audio/mpeg' }],
    ])

    const result = await writeBackPowerPoint({
      baseline: fixture.ingested.presentation,
      bytes: fixture.bytes,
      manifest: fixture.ingested.backing.manifest,
      presentation: desired,
      resolveAsset: async reference => assets.get(reference),
    })
    expect(result.plan.unsupported).toEqual([])
    const zip = await JSZip.loadAsync(result.bytes)
    expect(Object.keys(zip.files).some(path => /^ppt\/media\/.+\.mp4$/i.test(path))).toBe(true)
    expect(Object.keys(zip.files).some(path => /^ppt\/media\/.+\.mp3$/i.test(path))).toBe(true)
    expect(Object.keys(zip.files).some(path => /^ppt\/media\/.+\.svg$/i.test(path))).toBe(true)

    const reimported = await ingestPowerPoint(result.bytes, {
      fileName: 'generated-rich-media-roundtrip.pptx',
      theme,
    })
    const elements = flattenElementTree(reimported.presentation.slides[0]!.elements)
    const pictureShape = elements.find(element => (
      element.type === 'shape'
      && Math.abs(element.left - shape.left) < 0.1
      && Boolean(element.pattern)
    ))
    expect(pictureShape?.type).toBe('shape')
    if (pictureShape?.type === 'shape') expect(pictureShape.patternFit?.mode).toBe('tile')
    expect(elements.some(element => element.type === 'video')).toBe(true)
    expect(elements.some(element => element.type === 'audio')).toBe(true)
    expect(elements.some(element => (
      element.type === 'image'
      && Math.abs(element.left - formula.left) < 0.1
      && Math.abs(element.top - formula.top) < 0.1
    ))).toBe(true)
  })

  it('replaces retained native image media with document-owned bytes', async () => {
    const bytes = await readFile(join(REPO_ROOT, 'tests/corpus/public/corpus-03-media.pptx'))
    const archive = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    const ingested = await ingestPowerPoint(archive, { fileName: 'image-replacement-source.pptx', theme })
    const desired = structuredClone(ingested.presentation)
    const image = flattenElementTree(desired.slides[0]!.elements).find(
      (element): element is Extract<PPTElement, { type: 'image' }> => (
        element.type === 'image' && Boolean(element.source?.sourceObjectId)
      ),
    )
    if (!image) throw new Error('Media fixture has no retained native image.')
    const reference = 'mona-test://replacement.png'
    image.src = reference
    image.clip = { range: [[10, 15], [90, 85]], shape: 'rect' }
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    )
    const result = await writeBackPowerPoint({
      baseline: ingested.presentation,
      bytes: archive,
      manifest: ingested.backing.manifest,
      presentation: desired,
      resolveAsset: async value => value === reference
        ? { bytes: png, mediaType: 'image/png' }
        : undefined,
    })
    expect(result.plan.operations).toContainEqual(expect.objectContaining({
      kind: 'replace-element',
      objectId: image.source?.sourceObjectId,
    }))
    const reimported = await ingestPowerPoint(result.bytes, {
      fileName: 'image-replacement-roundtrip.pptx',
      theme,
    })
    const replacement = flattenElementTree(reimported.presentation.slides[0]!.elements).find(
      (element): element is Extract<PPTElement, { type: 'image' }> => (
        element.type === 'image'
        && Math.abs(element.left - image.left) < 0.1
        && Math.abs(element.top - image.top) < 0.1
      ),
    )
    expect(replacement?.clip?.range).toEqual(image.clip.range)
    expect(replacement?.source?.sourceObjectId).toBeTruthy()
  })

  it('allocates native media and relationships for an authored image background', async () => {
    const fixture = await source()
    const desired = structuredClone(fixture.ingested.presentation)
    const reference = 'mona-test://background.png'
    desired.slides[0]!.background = {
      image: { size: 'cover', src: reference },
      type: 'image',
    }
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    )
    const result = await writeBackPowerPoint({
      baseline: fixture.ingested.presentation,
      bytes: fixture.bytes,
      manifest: fixture.ingested.backing.manifest,
      presentation: desired,
      resolveAsset: async value => value === reference
        ? { bytes: png, mediaType: 'image/png' }
        : undefined,
    })
    expect(result.plan.unsupported).toEqual([])
    const reimported = await ingestPowerPoint(result.bytes, {
      fileName: 'generated-background-roundtrip.pptx',
      theme,
    })
    expect(reimported.presentation.slides[0]?.background?.type).toBe('image')
    expect(reimported.presentation.slides[0]?.background?.image?.src).toBeTruthy()
  })

  if (PRIVATE_FIXTURES.length) {
    it.each(PRIVATE_FIXTURES)(
      'keeps every byte of an unchanged private corpus deck: %s',
      async fileName => {
        const bytes = await readFile(join(PRIVATE_FIXTURE_ROOT, fileName))
        const archive = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer
        const ingested = await ingestPowerPoint(archive, { fileName, theme })
        const result = await writeBackPowerPoint({
          baseline: ingested.presentation,
          bytes: archive,
          manifest: ingested.backing.manifest,
          presentation: structuredClone(ingested.presentation),
        })

        expect(result.plan).toMatchObject({
          mode: 'noop',
          operations: [],
          touchedParts: [],
          unsupported: [],
        })
        expect(Buffer.from(result.bytes).equals(Buffer.from(archive))).toBe(true)
      },
    )
  }

  it('returns the exact retained archive for a no-op export', async () => {
    const fixture = await source()
    const result = await writeBackPowerPoint({
      baseline: fixture.ingested.presentation,
      bytes: fixture.bytes,
      manifest: fixture.ingested.backing.manifest,
      presentation: structuredClone(fixture.ingested.presentation),
    })

    expect(result.plan).toMatchObject({
      mode: 'noop',
      operations: [],
      touchedParts: [],
      unsupported: [],
    })
    expect(Buffer.from(result.bytes).equals(Buffer.from(fixture.bytes))).toBe(true)
  })

  it('round-trips editable alt text, title, hidden, and decorative metadata', async () => {
    const fixture = await source()
    const presentation = structuredClone(fixture.ingested.presentation)
    const element = patchableElement(presentation)
    element.accessibility = {
      decorative: true,
      description: 'Accessible chart description',
      hidden: true,
      title: 'Quarterly results',
    }

    const result = await writeBackPowerPoint({
      baseline: fixture.ingested.presentation,
      bytes: fixture.bytes,
      manifest: fixture.ingested.backing.manifest,
      presentation,
    })
    expect(result.plan.unsupported).toEqual([])
    const reimported = await ingestPowerPoint(result.bytes, { fileName: 'accessibility.pptx', theme })
    expect(elementBySource(reimported.presentation, element)?.accessibility).toEqual(element.accessibility)
  })

  it('writes a slide-local gradient background without changing the inherited master', async () => {
    const fixture = await source()
    const presentation = structuredClone(fixture.ingested.presentation)
    presentation.slides[0]!.background = {
      gradient: {
        colors: [
          { color: '#112233', pos: 0 },
          { color: '#DDEEFF', pos: 100 },
        ],
        rotate: 35,
        type: 'linear',
      },
      type: 'gradient',
    }
    if (presentation.slides[0]!.source) presentation.slides[0]!.source!.backgroundSource = 'slide'

    const result = await writeBackPowerPoint({
      baseline: fixture.ingested.presentation,
      bytes: fixture.bytes,
      manifest: fixture.ingested.backing.manifest,
      presentation,
    })
    expect(result.plan).toMatchObject({ mode: 'patch', unsupported: [] })
    await writeReferenceArtifact('background-gradient.pptx', result.bytes)
    const reimported = await ingestPowerPoint(result.bytes, { fileName: 'background.pptx', theme })
    expect(reimported.presentation.slides[0]?.background).toMatchObject({
      gradient: {
        colors: [
          { color: '#112233', pos: 0 },
          { color: '#DDEEFF', pos: 100 },
        ],
        rotate: 35,
        type: 'linear',
      },
      type: 'gradient',
    })
    expect(reimported.presentation.slides[0]?.source?.backgroundSource).toBe('slide')
  })

  it('writes edited speaker notes into the existing native notes part', async () => {
    const fixture = await sourceWithNotes()
    const presentation = structuredClone(fixture.ingested.presentation)
    expect(presentation.slides[0]?.remark).toContain('Original notes')
    presentation.slides[0]!.remark = '<p>Updated notes</p><p>Second line &amp; details</p>'

    const result = await writeBackPowerPoint({
      baseline: fixture.ingested.presentation,
      bytes: fixture.bytes,
      manifest: fixture.ingested.backing.manifest,
      presentation,
    })
    expect(result.plan).toMatchObject({
      mode: 'patch',
      touchedParts: ['ppt/notesSlides/notesSlide1.xml'],
      unsupported: [],
    })
    const reimported = await ingestPowerPoint(result.bytes, { fileName: 'notes.pptx', theme })
    expect(reimported.presentation.slides[0]?.remark).toContain('Updated notes')
    expect(reimported.presentation.slides[0]?.remark).toContain('Second line & details')
  })

  it('surfaces and writes text edits to existing native PowerPoint comments', async () => {
    const fixture = await sourceWithNotes()
    const presentation = structuredClone(fixture.ingested.presentation)
    expect(presentation.slides[0]?.notes?.[0]).toMatchObject({
      content: 'Original comment',
      user: 'Ada',
    })
    presentation.slides[0]!.notes![0]!.content = 'Updated review comment'

    const result = await writeBackPowerPoint({
      baseline: fixture.ingested.presentation,
      bytes: fixture.bytes,
      manifest: fixture.ingested.backing.manifest,
      presentation,
    })
    expect(result.plan).toMatchObject({
      mode: 'patch',
      touchedParts: ['ppt/comments/comment1.xml'],
      unsupported: [],
    })
    const reimported = await ingestPowerPoint(result.bytes, { fileName: 'comments.pptx', theme })
    expect(reimported.presentation.slides[0]?.notes?.[0]?.content).toBe('Updated review comment')
  })

  it('patches geometry on the exact native object and preserves every untouched part', async () => {
    const fixture = await source()
    const baseline = fixture.ingested.presentation
    const desired = structuredClone(baseline)
    const target = patchableElement(desired)
    target.left += 17.25
    target.top += 9.5
    target.width += 22
    target.height += 11
    target.rotate = 23

    const result = await writeBackPowerPoint({
      baseline,
      bytes: fixture.bytes,
      manifest: fixture.ingested.backing.manifest,
      presentation: desired,
    })
    expect(result.plan.mode).toBe('patch')
    expect(result.plan.operations).toHaveLength(1)
    expect(result.plan.touchedParts).toEqual([target.source!.sourcePart])

    const [beforeZip, afterZip] = await Promise.all([
      JSZip.loadAsync(fixture.bytes),
      JSZip.loadAsync(result.bytes),
    ])
    for (const path of Object.keys(beforeZip.files)) {
      if (path === target.source!.sourcePart || beforeZip.files[path]!.dir) continue
      const [before, after] = await Promise.all([
        beforeZip.file(path)!.async('nodebuffer'),
        afterZip.file(path)!.async('nodebuffer'),
      ])
      expect(after.equals(before), `untouched package part changed: ${path}`).toBe(true)
    }

    const reimported = await ingestPowerPoint(result.bytes, {
      fileName: 'round-trip.pptx',
      theme,
    })
    const roundTripped = elementBySource(reimported.presentation, target)
    expect(roundTripped).toBeDefined()
    expect(roundTripped?.left).toBeCloseTo(target.left, 2)
    expect(roundTripped?.top).toBeCloseTo(target.top, 2)
    expect(roundTripped?.width).toBeCloseTo(target.width, 2)
    expect(roundTripped && 'height' in roundTripped ? roundTripped.height : 0)
      .toBeCloseTo(target.height, 2)
    expect(roundTripped && 'rotate' in roundTripped ? roundTripped.rotate : 0)
      .toBeCloseTo(target.rotate, 2)
  })

  it('removes a deleted native object without regenerating the slide', async () => {
    const fixture = await source()
    const baseline = fixture.ingested.presentation
    const desired = structuredClone(baseline)
    const target = patchableElement(desired)
    const slide = desired.slides.find(
      candidate => candidate.source?.slidePart === target.source?.slidePart,
    )!
    slide.elements = slide.elements.filter(element => element.id !== target.id)

    const result = await writeBackPowerPoint({
      baseline,
      bytes: fixture.bytes,
      manifest: fixture.ingested.backing.manifest,
      presentation: desired,
    })
    expect(result.plan.operations).toContainEqual(expect.objectContaining({
      kind: 'delete',
      objectId: target.source?.sourceObjectId,
    }))
    const reimported = await ingestPowerPoint(result.bytes, {
      fileName: 'deleted-object.pptx',
      theme,
    })
    expect(elementBySource(reimported.presentation, target)).toBeUndefined()
  })

  it('writes an arbitrary text rewrite into the retained native text body', async () => {
    const fixture = await source()
    const desired = structuredClone(fixture.ingested.presentation)
    const target = editableTextElement(desired)
    const authored = '<p>AI rewrote this slide &amp; kept it editable.</p><p>A second paragraph.</p>'
    if (target.type === 'text') {
      target.content = authored
      delete target.structuredText
    }
    else {
      target.text!.content = authored
      delete target.text!.structuredText
    }

    const plan = analyzePowerPointWriteback(
      fixture.ingested.presentation,
      desired,
      fixture.ingested.backing.manifest.packageId,
    )
    expect(plan.mode).toBe('patch')
    expect(plan.operations).toContainEqual(expect.objectContaining({
      kind: 'text',
      objectId: target.source?.sourceObjectId,
    }))
    const result = await writeBackPowerPoint({
      baseline: fixture.ingested.presentation,
      bytes: fixture.bytes,
      manifest: fixture.ingested.backing.manifest,
      presentation: desired,
    })
    const reimported = await ingestPowerPoint(result.bytes, {
      fileName: 'text-rewrite.pptx',
      theme,
    })
    const roundTripped = elementBySource(reimported.presentation, target)
    const content = roundTripped?.type === 'text'
      ? roundTripped.content
      : roundTripped?.type === 'shape'
        ? roundTripped.text?.content
        : undefined
    expect(content).toContain('AI rewrote this slide & kept it editable.')
    expect(content).toContain('A second paragraph.')
  })

  it('round-trips authored run formatting and text-body layout properties', async () => {
    const fixture = await source()
    const desired = structuredClone(fixture.ingested.presentation)
    const target = editableTextElement(desired)
    const authored = '<p><span style="font-family: Aptos; font-size: 30px; color: #1256a0; font-weight: 700; font-style: italic; text-decoration-line: underline; letter-spacing: 2px">Styled text</span></p>'
    const text = target.type === 'text' ? target : target.text!
    text.content = authored
    delete text.structuredText
    text.columns = 2
    text.columnGap = 18
    text.inset = [12, 14, 16, 18]
    text.lineHeight = 1.25
    text.paragraphSpace = 9
    text.wordSpace = 1.5
    if (target.type === 'text') {
      target.fixedHeight = true
      target.vAlign = 'bottom'
    }
    else target.text!.align = 'bottom'

    const result = await writeBackPowerPoint({
      baseline: fixture.ingested.presentation,
      bytes: fixture.bytes,
      manifest: fixture.ingested.backing.manifest,
      presentation: desired,
    })
    const reimported = await ingestPowerPoint(result.bytes, {
      fileName: 'formatted-text.pptx',
      theme,
    })
    const roundTripped = elementBySource(reimported.presentation, target)
    const roundTripText = roundTripped?.type === 'text'
      ? roundTripped
      : roundTripped?.type === 'shape'
        ? roundTripped.text
        : undefined
    expect(roundTripText?.content).toContain('Styled text')
    expect(roundTripText?.content).toContain('font-family: Aptos')
    expect(roundTripText?.content.toLowerCase()).toContain('color: #1256a0')
    expect(roundTripText?.content).toContain('font-style: italic')
    expect(roundTripText?.structuredText?.bodyProperties?.columnCount).toBe(2)
    expect(
      (roundTripText?.structuredText?.bodyProperties?.columnSpacing ?? 0)
      * (roundTripText?.structuredText?.scale ?? 1),
    ).toBeCloseTo(18, 1)
    expect(roundTripText?.inset).toEqual(expect.arrayContaining([
      expect.closeTo(12, 1),
      expect.closeTo(14, 1),
      expect.closeTo(16, 1),
      expect.closeTo(18, 1),
    ]))
    expect(roundTripText?.lineHeight).toBeCloseTo(1.25, 2)
  })

  it('round-trips solid fill and outline changes without regenerating the slide', async () => {
    const bytes = await readFile(join(REPO_ROOT, 'tests/corpus/public/corpus-02-shapes-lines.pptx'))
    const archive = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer
    const ingested = await ingestPowerPoint(archive, {
      fileName: 'corpus-02-shapes-lines.pptx',
      theme,
    })
    const desired = structuredClone(ingested.presentation)
    const target = desired.slides.flatMap(slide => flattenElementTree(slide.elements)).find(
      (element): element is Extract<PPTElement, { type: 'shape' }> => (
        element.type === 'shape'
        && element.source?.sourceLayer === 'slide'
        && element.source.sourcePart === element.source.slidePart
      ),
    )
    if (!target) throw new Error('Shape corpus has no source-local shape.')
    target.fill = '#123456'
    delete target.gradient
    delete target.pattern
    delete target.patternFit
    delete target.powerPointPattern
    target.outline = { color: '#abcdef', style: 'dashed', width: 4 }

    const result = await writeBackPowerPoint({
      baseline: ingested.presentation,
      bytes: archive,
      manifest: ingested.backing.manifest,
      presentation: desired,
    })
    const reimported = await ingestPowerPoint(result.bytes, {
      fileName: 'styled-shape.pptx',
      theme,
    })
    const roundTripped = elementBySource(reimported.presentation, target)
    expect(roundTripped?.type).toBe('shape')
    if (roundTripped?.type !== 'shape') return
    expect(roundTripped.fill.toLowerCase()).toBe('#123456')
    expect(roundTripped.outline?.color?.toLowerCase()).toBe('#abcdef')
    expect(roundTripped.outline?.style).toBe('dashed')
    expect(roundTripped.outline?.width).toBeCloseTo(4, 1)
  })

  it('round-trips native preset geometry adjustments without replacing the shape path', async () => {
    const bytes = await readFile(join(REPO_ROOT, 'tests/corpus/public/corpus-02-shapes-lines.pptx'))
    const archive = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer
    const ingested = await ingestPowerPoint(archive, {
      fileName: 'corpus-02-shapes-lines.pptx',
      theme,
    })
    const desired = structuredClone(ingested.presentation)
    const target = desired.slides.flatMap(slide => flattenElementTree(slide.elements)).find(
      (element): element is Extract<PPTElement, { type: 'shape' }> => (
        element.type === 'shape'
        && Boolean(element.powerPointGeometry)
        && element.powerPointGeometry?.preset !== 'custom'
        && element.source?.sourceLayer === 'slide'
      ),
    )
    if (!target?.powerPointGeometry) throw new Error('Shape corpus has no native preset geometry.')
    const adjustmentName = Object.keys(target.powerPointGeometry.adjustments)[0] ?? 'adj'
    target.powerPointGeometry.adjustments[adjustmentName] = 31_250

    const result = await writeBackPowerPoint({
      baseline: ingested.presentation,
      bytes: archive,
      manifest: ingested.backing.manifest,
      presentation: desired,
    })
    expect(result.plan.operations).toContainEqual(expect.objectContaining({
      kind: 'shape-geometry',
      objectId: target.source?.sourceObjectId,
    }))
    const reimported = await ingestPowerPoint(result.bytes, {
      fileName: 'shape-geometry-round-trip.pptx',
      theme,
    })
    const roundTripped = elementBySource(reimported.presentation, target)
    expect(roundTripped?.type).toBe('shape')
    if (roundTripped?.type !== 'shape') return
    expect(roundTripped.powerPointGeometry?.preset).toBe(target.powerPointGeometry.preset)
    expect(roundTripped.powerPointGeometry?.adjustments[adjustmentName]).toBe(31_250)
  })

  it('round-trips native picture crop, opacity, filters, outline, and shadow', async () => {
    const bytes = await readFile(join(REPO_ROOT, 'tests/corpus/public/corpus-03-media.pptx'))
    const archive = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer
    const ingested = await ingestPowerPoint(archive, {
      fileName: 'corpus-03-media.pptx',
      theme,
    })
    const desired = structuredClone(ingested.presentation)
    const target = desired.slides.flatMap(slide => flattenElementTree(slide.elements)).find(
      (element): element is Extract<PPTElement, { type: 'image' }> => (
        element.type === 'image'
        && Boolean(element.powerPointImage?.relationshipId)
        && element.source?.sourceLayer === 'slide'
      ),
    )
    if (!target) throw new Error('Media corpus has no native picture.')
    target.clip = { range: [[7, 11], [89, 83]], shape: 'ellipse' }
    target.opacity = 0.72
    target.filters = { brightness: '115%', contrast: '90%', saturate: '65%' }
    target.outline = { color: '#234567', style: 'dotted', width: 3 }
    target.shadow = { blur: 8, color: '#345678', h: -4, v: 6 }

    const result = await writeBackPowerPoint({
      baseline: ingested.presentation,
      bytes: archive,
      manifest: ingested.backing.manifest,
      presentation: desired,
    })
    expect(result.plan.operations).toContainEqual(expect.objectContaining({
      kind: 'image',
      objectId: target.source?.sourceObjectId,
    }))
    const reimported = await ingestPowerPoint(result.bytes, {
      fileName: 'picture-style-round-trip.pptx',
      theme,
    })
    const roundTripped = elementBySource(reimported.presentation, target)
    expect(roundTripped?.type).toBe('image')
    if (roundTripped?.type !== 'image') return
    expect(roundTripped.clip?.shape).toBe('ellipse')
    expect(roundTripped.clip?.range[0]).toEqual(expect.arrayContaining([
      expect.closeTo(7, 1),
      expect.closeTo(11, 1),
    ]))
    expect(roundTripped.clip?.range[1]).toEqual(expect.arrayContaining([
      expect.closeTo(89, 1),
      expect.closeTo(83, 1),
    ]))
    expect(roundTripped.opacity).toBeCloseTo(0.72, 2)
    expect(roundTripped.filters).toMatchObject({
      brightness: '114.99999999999999%',
      contrast: '90%',
      saturate: '65%',
    })
    expect(roundTripped.outline).toMatchObject({ color: '#234567', style: 'dotted' })
    expect(roundTripped.outline?.width).toBeCloseTo(3, 1)
    expect(roundTripped.shadow?.color.toLowerCase()).toBe('#345678')
    expect(roundTripped.shadow?.h).toBeCloseTo(-4, 1)
    expect(roundTripped.shadow?.v).toBeCloseTo(6, 1)
    expect(roundTripped.shadow?.blur).toBeCloseTo(8, 1)
  })

  it('round-trips native gradient and preset-pattern shape fills', async () => {
    const bytes = await readFile(join(REPO_ROOT, 'tests/corpus/public/corpus-02-shapes-lines.pptx'))
    const archive = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer
    const ingested = await ingestPowerPoint(archive, {
      fileName: 'corpus-02-shapes-lines.pptx',
      theme,
    })
    const desired = structuredClone(ingested.presentation)
    const target = desired.slides.flatMap(slide => flattenElementTree(slide.elements)).find(
      (element): element is Extract<PPTElement, { type: 'shape' }> => (
        element.type === 'shape'
        && element.source?.sourceLayer === 'slide'
      ),
    )
    if (!target) throw new Error('Shape corpus has no editable native shape.')
    target.fill = ''
    target.gradient = {
      colors: [
        { color: '#123456', pos: 0 },
        { color: '#abcdef', pos: 100 },
      ],
      rotate: 37,
      type: 'linear',
    }
    delete target.pattern
    delete target.patternFit
    delete target.powerPointPattern

    const gradientResult = await writeBackPowerPoint({
      baseline: ingested.presentation,
      bytes: archive,
      manifest: ingested.backing.manifest,
      presentation: desired,
    })
    const gradientImport = await ingestPowerPoint(gradientResult.bytes, {
      fileName: 'shape-gradient-round-trip.pptx',
      theme,
    })
    const gradientShape = elementBySource(gradientImport.presentation, target)
    expect(gradientShape?.type).toBe('shape')
    if (gradientShape?.type !== 'shape') return
    expect(gradientShape.gradient).toMatchObject({ rotate: 37, type: 'linear' })
    expect(gradientShape.gradient?.colors.map(stop => ({
      ...stop,
      color: stop.color.toLowerCase(),
    }))).toEqual([
      { color: '#123456', pos: 0 },
      { color: '#abcdef', pos: 100 },
    ])

    const patterned = structuredClone(gradientImport.presentation)
    const patternedShape = elementBySource(patterned, gradientShape)
    if (patternedShape?.type !== 'shape') throw new Error('Gradient shape could not be re-addressed.')
    delete patternedShape.gradient
    patternedShape.powerPointPattern = {
      backgroundColor: '#f0f1f2',
      foregroundColor: '#345678',
      patternType: 'diagCross',
    }
    const patternResult = await writeBackPowerPoint({
      baseline: gradientImport.presentation,
      bytes: gradientResult.bytes,
      manifest: gradientImport.backing.manifest,
      presentation: patterned,
    })
    const patternImport = await ingestPowerPoint(patternResult.bytes, {
      fileName: 'shape-pattern-round-trip.pptx',
      theme,
    })
    const patternShape = elementBySource(patternImport.presentation, patternedShape)
    expect(patternShape?.type).toBe('shape')
    if (patternShape?.type !== 'shape') return
    expect({
      ...patternShape.powerPointPattern,
      backgroundColor: patternShape.powerPointPattern?.backgroundColor.toLowerCase(),
      foregroundColor: patternShape.powerPointPattern?.foregroundColor.toLowerCase(),
    }).toEqual({
      backgroundColor: '#f0f1f2',
      foregroundColor: '#345678',
      patternType: 'diagCross',
    })
  })

  it('round-trips native straight-line geometry, width, dash, color, and arrowheads', async () => {
    const bytes = await readFile(join(REPO_ROOT, 'tests/corpus/public/corpus-02-shapes-lines.pptx'))
    const archive = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer
    const ingested = await ingestPowerPoint(archive, {
      fileName: 'corpus-02-shapes-lines.pptx',
      theme,
    })
    const desired = structuredClone(ingested.presentation)
    const target = editableLineElement(desired)
    const start = absoluteLinePoint(target, 'start')
    const previousEnd = absoluteLinePoint(target, 'end')
    const end: [number, number] = [previousEnd[0] + 37, previousEnd[1] + 23]
    target.left = Math.min(start[0], end[0])
    target.top = Math.min(start[1], end[1])
    target.start = [start[0] - target.left, start[1] - target.top]
    target.end = [end[0] - target.left, end[1] - target.top]
    target.width = 4
    target.color = '#123456'
    target.style = 'dashed'
    target.points = ['arrow', 'dot']

    const result = await writeBackPowerPoint({
      baseline: ingested.presentation,
      bytes: archive,
      manifest: ingested.backing.manifest,
      presentation: desired,
    })
    expect(result.plan.operations).toContainEqual(expect.objectContaining({
      kind: 'connector',
      objectId: target.source?.sourceObjectId,
    }))
    const reimported = await ingestPowerPoint(result.bytes, {
      fileName: 'line-round-trip.pptx',
      theme,
    })
    const roundTripped = elementBySource(reimported.presentation, target)
    expect(roundTripped?.type).toBe('line')
    if (roundTripped?.type !== 'line') return
    expect(absoluteLinePoint(roundTripped, 'start')).toEqual(expect.arrayContaining([
      expect.closeTo(start[0], 2),
      expect.closeTo(start[1], 2),
    ]))
    expect(absoluteLinePoint(roundTripped, 'end')).toEqual(expect.arrayContaining([
      expect.closeTo(end[0], 2),
      expect.closeTo(end[1], 2),
    ]))
    expect(roundTripped.width).toBeCloseTo(4, 1)
    expect(roundTripped.color.toLowerCase()).toBe('#123456')
    expect(roundTripped.style).toBe('dashed')
    expect(roundTripped.points).toEqual(['arrow', 'dot'])
  })

  it.each([
    {
      key: 'bent',
      setRoute: (line: Extract<PPTElement, { type: 'line' }>) => {
        line.broken = [line.start[0], line.end[1]]
      },
    },
    {
      key: 'double-bent',
      setRoute: (line: Extract<PPTElement, { type: 'line' }>) => {
        line.broken2 = [
          (line.start[0] + line.end[0]) * 0.38,
          (line.start[1] + line.end[1]) / 2,
        ]
        line.broken2Direction = 'horizontal'
      },
    },
    {
      key: 'quadratic',
      setRoute: (line: Extract<PPTElement, { type: 'line' }>) => {
        line.curve = [line.end[0] * 0.3, line.end[1] * 0.75]
      },
    },
    {
      key: 'cubic',
      setRoute: (line: Extract<PPTElement, { type: 'line' }>) => {
        line.cubic = [
          [line.end[0] * 0.25, line.end[1] * 0.8],
          [line.end[0] * 0.75, line.end[1] * 0.2],
        ]
      },
    },
  ])('round-trips an editable $key connector route as native custom geometry', async ({ key, setRoute }) => {
    const bytes = await readFile(join(REPO_ROOT, 'tests/corpus/public/corpus-02-shapes-lines.pptx'))
    const archive = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer
    const ingested = await ingestPowerPoint(archive, {
      fileName: 'corpus-02-shapes-lines.pptx',
      theme,
    })
    const desired = structuredClone(ingested.presentation)
    const target = editableLineElement(desired)
    setRoute(target)

    const result = await writeBackPowerPoint({
      baseline: ingested.presentation,
      bytes: archive,
      manifest: ingested.backing.manifest,
      presentation: desired,
    })
    const output = await JSZip.loadAsync(result.bytes)
    const slideXml = await output.file(target.source!.sourcePart!)!.async('text')
    expect(slideXml).toContain('<a:custGeom>')
    expect(slideXml).toContain('fill="none"')

    const reimported = await ingestPowerPoint(result.bytes, {
      fileName: `${key}-connector-round-trip.pptx`,
      theme,
    })
    const roundTripped = elementBySource(reimported.presentation, target)
    expect(roundTripped?.type).toBe('line')
    if (roundTripped?.type !== 'line') return
    if (target.broken) expect(roundTripped.broken).toBeDefined()
    if (target.broken2) {
      expect(roundTripped.broken2).toBeDefined()
      expect(roundTripped.broken2Direction).toBe(target.broken2Direction)
    }
    if (target.curve) expect(roundTripped.curve).toBeDefined()
    if (target.cubic) expect(roundTripped.cubic).toBeDefined()
  })

  if (PRIVATE_FIXTURES.includes('real-01-powerpoint-native-charts-stress.pptx')) {
    it('retains native connection-site relationships and refuses implicit endpoint detachment', async () => {
      const fileName = 'real-01-powerpoint-native-charts-stress.pptx'
      const bytes = await readFile(join(PRIVATE_FIXTURE_ROOT, fileName))
      const archive = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer
      const ingested = await ingestPowerPoint(archive, { fileName, theme })
      const desired = structuredClone(ingested.presentation)
      const target = desired.slides.flatMap(slide => flattenElementTree(slide.elements)).find(
        (element): element is Extract<PPTElement, { type: 'line' }> => (
          element.type === 'line'
          && Boolean(element.source?.connector?.start)
          && Boolean(element.source?.connector?.end)
          && element.source?.sourceLayer === 'slide'
        ),
      )
      if (!target) throw new Error('Private fixture has no connected native connector.')
      const originalRelationships = structuredClone(target.source!.connector)
      target.color = '#654321'
      const styled = await writeBackPowerPoint({
        baseline: ingested.presentation,
        bytes: archive,
        manifest: ingested.backing.manifest,
        presentation: desired,
      })
      const reimported = await ingestPowerPoint(styled.bytes, {
        fileName: 'connected-style-round-trip.pptx',
        theme,
      })
      const roundTripped = elementBySource(reimported.presentation, target)
      expect(roundTripped?.source?.connector).toMatchObject({
        end: {
          nativeShapeId: originalRelationships?.end?.nativeShapeId,
          siteIndex: originalRelationships?.end?.siteIndex,
        },
        start: {
          nativeShapeId: originalRelationships?.start?.nativeShapeId,
          siteIndex: originalRelationships?.start?.siteIndex,
        },
      })

      const moved = structuredClone(ingested.presentation)
      const movedTarget = elementBySource(moved, target)
      if (movedTarget?.type !== 'line') throw new Error('Connected line was not re-addressed.')
      movedTarget.start = [movedTarget.start[0] + 10, movedTarget.start[1]]
      const plan = analyzePowerPointWriteback(
        ingested.presentation,
        moved,
        ingested.backing.manifest.packageId,
      )
      expect(plan.unsupported).toContainEqual(expect.objectContaining({
        code: 'pptx.writeback.connector-start-relationship',
      }))

      movedTarget.connections = {
        ...(movedTarget.connections?.end
          ? { end: structuredClone(movedTarget.connections.end) }
          : {}),
      }
      const detached = await writeBackPowerPoint({
        baseline: ingested.presentation,
        bytes: archive,
        manifest: ingested.backing.manifest,
        presentation: moved,
      })
      const detachedImport = await ingestPowerPoint(detached.bytes, {
        fileName: 'connected-detach-round-trip.pptx',
        theme,
      })
      const detachedLine = elementBySource(detachedImport.presentation, target)
      expect(detachedLine?.source?.connector?.start).toBeUndefined()
      expect(detachedLine?.source?.connector?.end).toMatchObject({
        nativeShapeId: originalRelationships?.end?.nativeShapeId,
        siteIndex: originalRelationships?.end?.siteIndex,
      })
    })
  }

  it('round-trips table text, merged topology, dimensions, cell styling, and table flags', async () => {
    const bytes = await readFile(join(REPO_ROOT, 'tests/corpus/public/corpus-04-chart-table.pptx'))
    const sourceArchive = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer
    // The synthetic generator reused native id 2 for a chart and the table.
    // Give the table a legal unique id so this test exercises exact source
    // addressing instead of the importer's intentional ambiguity fallback.
    const fixtureZip = await JSZip.loadAsync(sourceArchive)
    const fixtureSlide = fixtureZip.file('ppt/slides/slide1.xml')!
    fixtureZip.file(
      'ppt/slides/slide1.xml',
      (await fixtureSlide.async('text')).replace(
        '<p:cNvPr id="2" name="Table 0"',
        '<p:cNvPr id="99" name="Table 0"',
      ),
    )
    const archive = await fixtureZip.generateAsync({ type: 'arraybuffer' })
    const ingested = await ingestPowerPoint(archive, {
      fileName: 'corpus-04-chart-table.pptx',
      theme,
    })
    const desired = structuredClone(ingested.presentation)
    const target = editableTableElement(desired)
    const cell = target.data[0]![0]!
    cell.text = '<p><span>Edited &amp; merged</span></p>'
    delete cell.structuredText
    cell.colspan = 2
    cell.rowspan = 2
    cell.margin = [9, 10, 11, 12]
    cell.style = {
      ...(cell.style ?? {}),
      backcolor: '#123456',
      bold: true,
      color: '#abcdef',
      fontname: 'Arial',
      fontsize: '20px',
      vAlign: 'bottom',
    }
    cell.borders = {
      ...(cell.borders ?? {}),
      diagonalDown: { color: '#654321', style: 'dashed', width: 3 },
      top: { color: '#102030', style: 'dotted', width: 2 },
    }
    target.colWidths = target.colWidths.map((width, index) => (
      index === 0 ? width * 0.8 : index === 1 ? width * 1.2 : width
    ))
    const totalWidth = target.colWidths.reduce((sum, width) => sum + width, 0)
    target.colWidths = target.colWidths.map(width => width / totalWidth)
    target.rowHeights = (target.rowHeights ?? target.data.map(() => target.cellMinHeight))
      .map((height, index) => index === 0 ? height + 8 : height)
    target.powerPointTable = {
      ...(target.powerPointTable ?? {
        bandColumn: false,
        bandRow: false,
        firstColumn: false,
        firstRow: false,
        lastColumn: false,
        lastRow: false,
        rightToLeft: false,
      }),
      bandRow: true,
      firstRow: true,
    }

    const result = await writeBackPowerPoint({
      baseline: ingested.presentation,
      bytes: archive,
      manifest: ingested.backing.manifest,
      presentation: desired,
    })
    expect(result.plan.operations).toContainEqual(expect.objectContaining({
      kind: 'table',
      objectId: target.source?.sourceObjectId,
    }))
    const reimported = await ingestPowerPoint(result.bytes, {
      fileName: 'table-round-trip.pptx',
      theme,
    })
    const roundTripped = elementBySource(reimported.presentation, target)
    expect(roundTripped?.type).toBe('table')
    if (roundTripped?.type !== 'table') return
    const roundTrippedCell = roundTripped.data[0]![0]!
    expect(roundTrippedCell.text).toContain('Edited & merged')
    expect(roundTrippedCell.colspan).toBe(2)
    expect(roundTrippedCell.rowspan).toBe(2)
    expect(roundTrippedCell.style?.backcolor?.toLowerCase()).toBe('#123456')
    expect(roundTrippedCell.style?.vAlign).toBe('bottom')
    expect(roundTrippedCell.margin).toEqual(expect.arrayContaining([
      expect.closeTo(9, 1),
      expect.closeTo(10, 1),
      expect.closeTo(11, 1),
      expect.closeTo(12, 1),
    ]))
    expect(roundTrippedCell.borders?.diagonalDown).toMatchObject({
      color: '#654321',
      style: 'dashed',
    })
    expect(roundTripped.powerPointTable).toMatchObject({ bandRow: true, firstRow: true })
    expect(roundTripped.rowHeights?.[0]).toBeCloseTo(target.rowHeights[0]!, 1)
    expect(roundTripped.colWidths[0]).toBeCloseTo(target.colWidths[0]!, 3)
  })

  it('inserts and removes native PowerPoint table rows and columns without regenerating the deck', async () => {
    const bytes = await readFile(join(REPO_ROOT, 'tests/corpus/public/corpus-04-chart-table.pptx'))
    const fixtureZip = await JSZip.loadAsync(bytes)
    const fixtureSlide = fixtureZip.file('ppt/slides/slide1.xml')!
    fixtureZip.file(
      'ppt/slides/slide1.xml',
      (await fixtureSlide.async('text')).replace(
        '<p:cNvPr id="2" name="Table 0"',
        '<p:cNvPr id="99" name="Table 0"',
      ),
    )
    const archive = await fixtureZip.generateAsync({ type: 'arraybuffer' })
    const ingested = await ingestPowerPoint(archive, {
      fileName: 'table-structure-source.pptx',
      theme,
    })
    const desired = structuredClone(ingested.presentation)
    const target = editableTableElement(desired)
    const initialRows = target.data.length
    const initialColumns = target.data[0]!.length
    const newCell = (id: string, text = '') => ({
      colspan: 1,
      id,
      rowspan: 1,
      style: { color: '#222222', fontname: 'Arial' },
      text,
    })
    for (let row = 0; row < target.data.length; row += 1) {
      target.data[row]!.push(newCell(`inserted-column-${row}`, row === 0 ? '<p>New column</p>' : ''))
    }
    target.data.push(Array.from(
      { length: initialColumns + 1 },
      (_value, column) => newCell(`inserted-row-${column}`, column === 0 ? '<p>New row</p>' : ''),
    ))
    const absoluteWidths = target.colWidths.map(width => width * target.width)
    absoluteWidths.push(100)
    target.width = absoluteWidths.reduce((sum, width) => sum + width, 0)
    target.colWidths = absoluteWidths.map(width => width / target.width)
    target.rowHeights = [
      ...(target.rowHeights ?? target.data.slice(0, -1).map(() => target.cellMinHeight)),
      42,
    ]

    const inserted = await writeBackPowerPoint({
      baseline: ingested.presentation,
      bytes: archive,
      manifest: ingested.backing.manifest,
      presentation: desired,
    })
    const insertedImport = await ingestPowerPoint(inserted.bytes, {
      fileName: 'table-structure-inserted.pptx',
      theme,
    })
    const insertedTable = elementBySource(insertedImport.presentation, target)
    expect(insertedTable?.type).toBe('table')
    if (insertedTable?.type !== 'table') return
    expect(insertedTable.data).toHaveLength(initialRows + 1)
    expect(insertedTable.data[0]).toHaveLength(initialColumns + 1)
    expect(insertedTable.data[0]!.at(-1)!.text).toContain('New column')
    expect(insertedTable.data.at(-1)![0]!.text).toContain('New row')

    const reduced = structuredClone(insertedImport.presentation)
    const reducedTable = elementBySource(reduced, insertedTable)
    if (reducedTable?.type !== 'table') throw new Error('Inserted table could not be re-addressed.')
    reducedTable.data.splice(1, 1)
    for (const row of reducedTable.data) row.splice(1, 1)
    const reducedWidths = reducedTable.colWidths.map(width => width * reducedTable.width)
    reducedWidths.splice(1, 1)
    reducedTable.width = reducedWidths.reduce((sum, width) => sum + width, 0)
    reducedTable.colWidths = reducedWidths.map(width => width / reducedTable.width)
    reducedTable.rowHeights?.splice(1, 1)

    const removed = await writeBackPowerPoint({
      baseline: insertedImport.presentation,
      bytes: inserted.bytes,
      manifest: insertedImport.backing.manifest,
      presentation: reduced,
    })
    const removedImport = await ingestPowerPoint(removed.bytes, {
      fileName: 'table-structure-removed.pptx',
      theme,
    })
    const removedTable = elementBySource(removedImport.presentation, reducedTable)
    expect(removedTable?.type).toBe('table')
    if (removedTable?.type !== 'table') return
    expect(removedTable.data).toHaveLength(initialRows)
    expect(removedTable.data[0]).toHaveLength(initialColumns)
  })

  it('updates native chart caches and the embedded workbook together', async () => {
    const bytes = await readFile(join(REPO_ROOT, 'tests/corpus/public/corpus-04-chart-table.pptx'))
    const archive = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer
    const ingested = await ingestPowerPoint(archive, {
      fileName: 'corpus-04-chart-table.pptx',
      theme,
    })
    const desired = structuredClone(ingested.presentation)
    const target = editableChartElement(desired)
    target.data.labels = ['North', 'South', 'East', 'West', 'Central']
    target.data.legends = ['Actual', 'Forecast']
    target.data.series = [
      [12, 18, 24, 31, 37],
      [14, 20, 27, 34, 41],
    ]
    target.themeColors = ['#123456', '#ABCDEF']
    target.options = {
      ...(target.options ?? {}),
      legendPosition: 'bottom',
      showCategoryName: true,
      showDataLabels: true,
      showLegend: true,
      showValue: true,
      title: 'Regional outlook',
    }

    const result = await writeBackPowerPoint({
      baseline: ingested.presentation,
      bytes: archive,
      manifest: ingested.backing.manifest,
      presentation: desired,
    })
    expect(result.plan.operations).toContainEqual(expect.objectContaining({
      chartPart: target.chartSource?.partPath,
      kind: 'chart',
      workbookPart: target.chartSource?.workbookPart,
    }))
    expect(result.plan.touchedParts).toEqual(expect.arrayContaining([
      target.chartSource!.partPath,
      target.chartSource!.workbookPart!,
    ]))
    await writeReferenceArtifact('chart-data-and-workbook.pptx', result.bytes)

    const reimported = await ingestPowerPoint(result.bytes, {
      fileName: 'chart-data-round-trip.pptx',
      theme,
    })
    const roundTripped = elementBySource(reimported.presentation, target)
    expect(roundTripped?.type).toBe('chart')
    if (roundTripped?.type !== 'chart') return
    expect(roundTripped.data).toEqual(target.data)
    expect(roundTripped.options?.title).toBe('Regional outlook')
    expect(roundTripped.options?.showLegend).toBe(true)
    expect(roundTripped.options?.legendPosition).toBe('bottom')
    expect(roundTripped.options?.showCategoryName).toBe(true)
    expect(roundTripped.options?.showValue).toBe(true)

    const packageZip = await JSZip.loadAsync(result.bytes)
    const chartXml = await packageZip.file(target.chartSource!.partPath)!.async('text')
    expect(chartXml).toContain('val="123456"')
    expect(chartXml).toContain('val="ABCDEF"')
    const embedded = await packageZip.file(target.chartSource!.workbookPart!)!.async('arraybuffer')
    const workbookZip = await JSZip.loadAsync(embedded)
    const sheetXml = await workbookZip.file('xl/worksheets/sheet1.xml')!.async('text')
    expect(sheetXml).toContain('Central')
    expect(sheetXml).toContain('Forecast')
    expect(sheetXml).toContain('41')
  })

  it('round-trips native chart family metadata without flattening the graphic frame', async () => {
    const bytes = await readFile(join(REPO_ROOT, 'tests/corpus/public/corpus-04-chart-table.pptx'))
    const sourceArchive = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer
    const fixtureZip = await JSZip.loadAsync(sourceArchive)
    const fixtureSlide = fixtureZip.file('ppt/slides/slide1.xml')!
    fixtureZip.file(
      'ppt/slides/slide1.xml',
      (await fixtureSlide.async('text')).replace(
        '<p:cNvPr id="2" name="Table 0"',
        '<p:cNvPr id="99" name="Table 0"',
      ),
    )
    const archive = await fixtureZip.generateAsync({ type: 'arraybuffer' })
    const ingested = await ingestPowerPoint(archive, {
      fileName: 'corpus-04-chart-table.pptx',
      theme,
    })
    const desired = structuredClone(ingested.presentation)
    const target = editableChartElement(desired, 'bar')
    target.chartType = target.chartType === 'bar' ? 'column' : 'bar'
    target.options = {
      ...(target.options ?? {}),
      maximumValue: 500,
      minimumValue: -10,
      showMajorGridlines: false,
      stack: true,
    }

    const result = await writeBackPowerPoint({
      baseline: ingested.presentation,
      bytes: archive,
      manifest: ingested.backing.manifest,
      presentation: desired,
    })
    const reimported = await ingestPowerPoint(result.bytes, {
      fileName: 'chart-options-round-trip.pptx',
      theme,
    })
    const roundTripped = elementBySource(reimported.presentation, target)
    expect(roundTripped?.type).toBe('chart')
    if (roundTripped?.type !== 'chart') return
    expect(roundTripped.chartType).toBe(target.chartType)
    expect(roundTripped.options?.maximumValue).toBe(500)
    expect(roundTripped.options?.minimumValue).toBe(-10)
    expect(roundTripped.options?.showMajorGridlines).toBe(false)
    expect(roundTripped.options?.stack).toBe(true)

    const zip = await JSZip.loadAsync(result.bytes)
    const chartXml = await zip.file(target.chartSource!.partPath)!.async('text')
    expect(chartXml).toContain('<c:barChart>')
    expect(chartXml).not.toContain('<p:pic')
  })

  it('allocates a native relationship for a new external run hyperlink', async () => {
    const fixture = await source()
    const desired = structuredClone(fixture.ingested.presentation)
    const target = editableTextElement(desired)
    const text = target.type === 'text' ? target : target.text!
    text.content = '<p><a href="https://example.com/new"><span>New link</span></a></p>'
    delete text.structuredText

    const result = await writeBackPowerPoint({
      baseline: fixture.ingested.presentation,
      bytes: fixture.bytes,
      manifest: fixture.ingested.backing.manifest,
      presentation: desired,
    })
    expect(result.plan.touchedParts).toContain(`${target.source!.sourcePart!.replace(/\/([^/]+)$/, '/_rels/$1.rels')}`)
    const reimported = await ingestPowerPoint(result.bytes, { fileName: 'new-link.pptx', theme })
    const roundTripped = elementBySource(reimported.presentation, target)
    const body = roundTripped?.type === 'text'
      ? roundTripped.structuredText
      : roundTripped?.type === 'shape'
        ? roundTripped.text?.structuredText
        : undefined
    expect(body?.paragraphs.flatMap(paragraph => paragraph.runs).some(
      run => run.hyperlink === 'https://example.com/new',
    )).toBe(true)
  })

  it('preserves an existing hyperlink relationship while editing its source run text', async () => {
    const fixture = await source()
    const desired = structuredClone(fixture.ingested.presentation)
    const target = desired.slides.flatMap(slide => flattenElementTree(slide.elements)).find(
      (element): element is Extract<PPTElement, { type: 'shape' | 'text' }> => {
        if (element.type !== 'text' && element.type !== 'shape') return false
        const body = element.type === 'text' ? element.structuredText : element.text?.structuredText
        return Boolean(
          element.source?.sourceLayer === 'slide'
          && element.source.sourcePart === element.source.slidePart
          && body?.paragraphs.some(paragraph => paragraph.runs.some(run => run.hyperlink)),
        )
      },
    )
    if (!target) throw new Error('Text corpus has no source-local hyperlink run.')
    const text = target.type === 'text' ? target : target.text!
    const linkedRun = text.structuredText!.paragraphs
      .flatMap(paragraph => paragraph.runs)
      .find(run => run.hyperlink)!
    const paragraph = text.structuredText!.paragraphs.find(candidate => (
      candidate.runs.some(run => run.sourceId === linkedRun.sourceId)
    ))!
    text.content = `<p data-ppt-paragraph-id="${paragraph.sourceId}" data-ppt-level="${paragraph.level}"><a href="${linkedRun.hyperlink}"><span data-ppt-run-id="${linkedRun.sourceId}">Edited linked text</span></a></p>`
    delete text.structuredText

    const result = await writeBackPowerPoint({
      baseline: fixture.ingested.presentation,
      bytes: fixture.bytes,
      manifest: fixture.ingested.backing.manifest,
      presentation: desired,
    })
    const reimported = await ingestPowerPoint(result.bytes, {
      fileName: 'linked-text.pptx',
      theme,
    })
    const roundTripped = elementBySource(reimported.presentation, target)
    const body = roundTripped?.type === 'text'
      ? roundTripped.structuredText
      : roundTripped?.type === 'shape'
        ? roundTripped.text?.structuredText
        : undefined
    const roundTrippedRun = body?.paragraphs
      .flatMap(paragraph => paragraph.runs)
      .find(run => run.text === 'Edited linked text')
    expect(roundTrippedRun?.hyperlink).toBe(linkedRun.hyperlink)
  })

  it('still refuses unrelated object properties instead of flattening them', async () => {
    const fixture = await source()
    const desired = structuredClone(fixture.ingested.presentation)
    const target = patchableElement(desired)
    target.name = `${target.name ?? ''} changed`

    const plan = analyzePowerPointWriteback(
      fixture.ingested.presentation,
      desired,
      fixture.ingested.backing.manifest.packageId,
    )
    expect(plan.mode).toBe('unsupported')
    expect(plan.unsupported).toContainEqual(expect.objectContaining({
      code: 'pptx.writeback.element-content',
    }))
    await expect(writeBackPowerPoint({
      baseline: fixture.ingested.presentation,
      bytes: fixture.bytes,
      manifest: fixture.ingested.backing.manifest,
      presentation: desired,
    })).rejects.toBeInstanceOf(PowerPointWritebackError)
  })

  it('clones a duplicate native object into the slide without aliasing its source identity', async () => {
    const fixture = await source()
    const desired = structuredClone(fixture.ingested.presentation)
    const target = patchableElement(desired)
    const targetSlide = desired.slides.find(slide => (
      flattenElementTree(slide.elements).some(element => element.id === target.id)
    ))
    if (!targetSlide?.source?.slidePart) throw new Error('Native source slide could not be resolved.')
    const duplicate = structuredClone(target)
    duplicate.id = 'native-copy'
    duplicate.left += 24
    duplicate.top += 12
    retainElementTreeCopyOrigins([duplicate], 'copy', {
      packageId: fixture.ingested.backing.manifest.packageId,
      slidePart: targetSlide.source.slidePart,
    })
    targetSlide.elements.push(duplicate)

    const plan = analyzePowerPointWriteback(
      fixture.ingested.presentation,
      desired,
      fixture.ingested.backing.manifest.packageId,
    )

    expect(plan.mode).toBe('patch')
    expect(plan.unsupported).toEqual([])
    expect(plan.operations).toContainEqual(expect.objectContaining({
      kind: 'insert-object',
      elementId: duplicate.id,
      sourceObjectId: duplicate.source?.copyOnWrite?.sourceObjectId,
    }))
    const result = await writeBackPowerPoint({
      baseline: fixture.ingested.presentation,
      bytes: fixture.bytes,
      manifest: fixture.ingested.backing.manifest,
      presentation: desired,
    })
    const reimported = await ingestPowerPoint(result.bytes, {
      fileName: 'native-copy.pptx',
      theme,
    })
    const slide = reimported.presentation.slides.find(candidate => (
      candidate.source?.slidePart === targetSlide.source?.slidePart
    ))
    const matchingType = slide?.elements.filter(element => element.type === target.type) ?? []
    expect(matchingType.length).toBeGreaterThanOrEqual(2)
    expect(matchingType.some(element => (
      Math.abs(element.left - duplicate.left) < 0.1
      && Math.abs(element.top - duplicate.top) < 0.1
    ))).toBe(true)
  })

  it('writes independent text and geometry changes into a copied native text object', async () => {
    const fixture = await source()
    const desired = structuredClone(fixture.ingested.presentation)
    const target = editableTextElement(desired)
    const targetSlide = desired.slides.find(slide => (
      flattenElementTree(slide.elements).some(element => element.id === target.id)
    ))
    if (!targetSlide?.source?.slidePart) throw new Error('Native source slide could not be resolved.')
    const duplicate = structuredClone(target)
    duplicate.id = 'native-text-copy'
    duplicate.left += 36
    if (duplicate.type === 'text') duplicate.content = '<p>Independent native copy</p>'
    else if (duplicate.text) duplicate.text.content = '<p>Independent native copy</p>'
    retainElementTreeCopyOrigins([duplicate], 'copy', {
      packageId: fixture.ingested.backing.manifest.packageId,
      slidePart: targetSlide.source.slidePart,
    })
    targetSlide.elements.push(duplicate)

    const result = await writeBackPowerPoint({
      baseline: fixture.ingested.presentation,
      bytes: fixture.bytes,
      manifest: fixture.ingested.backing.manifest,
      presentation: desired,
    })
    const reimported = await ingestPowerPoint(result.bytes, {
      fileName: 'native-text-copy.pptx',
      theme,
    })
    const contents = reimported.presentation.slides
      .flatMap(slide => flattenElementTree(slide.elements))
      .flatMap(element => (
        element.type === 'text'
          ? [element.content]
          : element.type === 'shape' && element.text
            ? [element.text.content]
            : []
      ))
    expect(contents.some(content => content.includes('Independent native copy'))).toBe(true)
    const original = elementBySource(reimported.presentation, target)
    const originalContent = original?.type === 'text'
      ? original.content
      : original?.type === 'shape'
        ? original.text?.content
        : undefined
    expect(originalContent).not.toContain('Independent native copy')
  })

  it('registers an independently editable native slide clone in presentation order', async () => {
    const fixture = await source()
    const desired = structuredClone(fixture.ingested.presentation)
    const sourceSlide = desired.slides[0]!
    if (!sourceSlide.source) throw new Error('Fixture has no native slide source.')
    const duplicate = structuredClone(sourceSlide)
    duplicate.id = 'native-slide-copy'
    duplicate.source = {
      ...sourceSlide.source,
      copyOnWrite: {
        packageId: sourceSlide.source.packageId,
        sourceSlidePart: sourceSlide.source.slidePart,
      },
    }
    retainElementTreeCopyOrigins(duplicate.elements, 'copy', {
      packageId: sourceSlide.source.packageId,
      slidePart: sourceSlide.source.slidePart,
    })
    const copiedText = duplicate.elements.flatMap(element => flattenElementTree([element])).find(
      (element): element is Extract<PPTElement, { type: 'shape' | 'text' }> => (
        element.type === 'text' || (element.type === 'shape' && Boolean(element.text))
      ),
    )
    if (!copiedText) throw new Error('Fixture has no native text object to edit on the copied slide.')
    if (copiedText.type === 'text') copiedText.content = '<p>Copied slide is independent</p>'
    else copiedText.text!.content = '<p>Copied slide is independent</p>'
    copiedText.left += 31
    desired.slides.splice(1, 0, duplicate)

    const result = await writeBackPowerPoint({
      baseline: fixture.ingested.presentation,
      bytes: fixture.bytes,
      manifest: fixture.ingested.backing.manifest,
      presentation: desired,
    })
    expect(result.plan.operations).toContainEqual(expect.objectContaining({
      index: 1,
      kind: 'insert-slide',
      slideId: duplicate.id,
      sourcePart: sourceSlide.source.slidePart,
    }))
    const reimported = await ingestPowerPoint(result.bytes, {
      fileName: 'native-slide-copy.pptx',
      theme,
    })
    expect(reimported.presentation.slides).toHaveLength(
      fixture.ingested.presentation.slides.length + 1,
    )
    const roundTrippedCopy = reimported.presentation.slides[1]!
    expect(roundTrippedCopy.source?.slidePart).not.toBe(sourceSlide.source.slidePart)
    const copyContents = flattenElementTree(roundTrippedCopy.elements).flatMap(element => (
      element.type === 'text'
        ? [element.content]
        : element.type === 'shape' && element.text
          ? [element.text.content]
          : []
    ))
    expect(copyContents.some(content => content.includes('Copied slide is independent'))).toBe(true)
    const sourceContents = flattenElementTree(reimported.presentation.slides[0]!.elements).flatMap(element => (
      element.type === 'text'
        ? [element.content]
        : element.type === 'shape' && element.text
          ? [element.text.content]
          : []
    ))
    expect(sourceContents.some(content => content.includes('Copied slide is independent'))).toBe(false)
    const sourceDependency = reimported.backing.manifest.slides.find(slide => (
      slide.slidePart === reimported.presentation.slides[0]!.source?.slidePart
    ))
    const copiedDependency = reimported.backing.manifest.slides.find(slide => (
      slide.slidePart === roundTrippedCopy.source?.slidePart
    ))
    expect(copiedDependency?.notesPart).toBeTruthy()
    expect(copiedDependency?.notesPart).not.toBe(sourceDependency?.notesPart)
  })

  it('clones chart parts and embedded workbooks for copied native slides', async () => {
    const bytes = await readFile(join(REPO_ROOT, 'tests/corpus/public/corpus-04-chart-table.pptx'))
    const archive = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    const ingested = await ingestPowerPoint(archive, { fileName: 'chart-copy.pptx', theme })
    const desired = structuredClone(ingested.presentation)
    const sourceSlide = desired.slides[0]!
    if (!sourceSlide.source) throw new Error('Chart fixture has no native slide source.')
    const duplicate = structuredClone(sourceSlide)
    duplicate.id = 'native-chart-slide-copy'
    duplicate.source = {
      ...sourceSlide.source,
      copyOnWrite: {
        packageId: sourceSlide.source.packageId,
        sourceSlidePart: sourceSlide.source.slidePart,
      },
    }
    retainElementTreeCopyOrigins(duplicate.elements, 'copy', {
      packageId: sourceSlide.source.packageId,
      slidePart: sourceSlide.source.slidePart,
    })
    desired.slides.push(duplicate)

    const plan = analyzePowerPointWriteback(
      ingested.presentation,
      desired,
      ingested.backing.manifest.packageId,
    )
    expect(plan.unsupported).toEqual([])
    const result = await writeBackPowerPoint({
      baseline: ingested.presentation,
      bytes: archive,
      manifest: ingested.backing.manifest,
      presentation: desired,
    })
    const reimported = await ingestPowerPoint(result.bytes, {
      fileName: 'chart-slide-copy-roundtrip.pptx',
      theme,
    })
    const originalCharts = flattenElementTree(reimported.presentation.slides[0]!.elements).filter(
      (element): element is Extract<PPTElement, { type: 'chart' }> => element.type === 'chart',
    )
    const copiedCharts = flattenElementTree(reimported.presentation.slides.at(-1)!.elements).filter(
      (element): element is Extract<PPTElement, { type: 'chart' }> => element.type === 'chart',
    )
    expect(copiedCharts).toHaveLength(originalCharts.length)
    expect(new Set(copiedCharts.map(chart => chart.chartSource?.partPath))).not.toEqual(
      new Set(originalCharts.map(chart => chart.chartSource?.partPath)),
    )
    expect(new Set(copiedCharts.map(chart => chart.chartSource?.workbookPart))).not.toEqual(
      new Set(originalCharts.map(chart => chart.chartSource?.workbookPart)),
    )
  })

  it('clones a chart object with an independent chart part and embedded workbook', async () => {
    const bytes = await readFile(join(REPO_ROOT, 'tests/corpus/public/corpus-04-chart-table.pptx'))
    const archive = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    const ingested = await ingestPowerPoint(archive, { fileName: 'chart-object-copy.pptx', theme })
    const desired = structuredClone(ingested.presentation)
    const sourceChart = editableChartElement(desired)
    const slide = desired.slides.find(candidate => flattenElementTree(candidate.elements).some(
      element => element.id === sourceChart.id,
    ))!
    const copy = structuredClone(sourceChart)
    copy.id = 'native-chart-object-copy'
    copy.left += 48
    retainElementTreeCopyOrigins([copy], 'copy', {
      packageId: ingested.backing.manifest.packageId,
      slidePart: slide.source!.slidePart,
    })
    slide.elements.push(copy)

    const result = await writeBackPowerPoint({
      baseline: ingested.presentation,
      bytes: archive,
      manifest: ingested.backing.manifest,
      presentation: desired,
    })
    const reimported = await ingestPowerPoint(result.bytes, {
      fileName: 'chart-object-copy-roundtrip.pptx',
      theme,
    })
    const charts = flattenElementTree(reimported.presentation.slides[0]!.elements).filter(
      (element): element is Extract<PPTElement, { type: 'chart' }> => element.type === 'chart',
    )
    const original = charts.find(chart => chart.source?.sourceObjectId === sourceChart.source?.sourceObjectId)
    const inserted = charts.find(chart => Math.abs(chart.left - copy.left) < 0.1)
    expect(inserted).toBeTruthy()
    expect(inserted?.chartSource?.partPath).not.toBe(original?.chartSource?.partPath)
    expect(inserted?.chartSource?.workbookPart).not.toBe(original?.chartSource?.workbookPart)
  })

  it('clones native image relationships and allocates independent drawing identities', async () => {
    const bytes = await readFile(join(REPO_ROOT, 'tests/corpus/public/corpus-03-media.pptx'))
    const archive = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    const ingested = await ingestPowerPoint(archive, { fileName: 'image-object-copy.pptx', theme })
    const desired = structuredClone(ingested.presentation)
    const slide = desired.slides[0]!
    const sourceImage = flattenElementTree(slide.elements).find(
      (element): element is Extract<PPTElement, { type: 'image' }> => (
        element.type === 'image' && Boolean(element.source?.sourceObjectId)
      ),
    )
    if (!sourceImage || !slide.source) throw new Error('Media fixture has no native image.')
    const copy = structuredClone(sourceImage)
    copy.id = 'native-image-object-copy'
    copy.left += 42
    retainElementTreeCopyOrigins([copy], 'copy', {
      packageId: slide.source.packageId,
      slidePart: slide.source.slidePart,
    })
    slide.elements.push(copy)

    const result = await writeBackPowerPoint({
      baseline: ingested.presentation,
      bytes: archive,
      manifest: ingested.backing.manifest,
      presentation: desired,
    })
    const reimported = await ingestPowerPoint(result.bytes, {
      fileName: 'image-object-copy-roundtrip.pptx',
      theme,
    })
    const images = flattenElementTree(reimported.presentation.slides[0]!.elements).filter(
      (element): element is Extract<PPTElement, { type: 'image' }> => element.type === 'image',
    )
    expect(images).toHaveLength(
      flattenElementTree(ingested.presentation.slides[0]!.elements).filter(element => element.type === 'image').length + 1,
    )
    expect(images.some(image => Math.abs(image.left - copy.left) < 0.1)).toBe(true)
    expect(new Set(images.map(image => image.source?.sourceObjectId)).size).toBe(images.length)
  })

  it('clones a native group as one hierarchy with unique child drawing identities', async () => {
    const bytes = await readFile(join(REPO_ROOT, 'tests/corpus/public/corpus-05-groups.pptx'))
    const archive = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    const ingested = await ingestPowerPoint(archive, { fileName: 'group-object-copy.pptx', theme })
    const desired = structuredClone(ingested.presentation)
    const slide = desired.slides[0]!
    const sourceGroup = slide.elements.find(
      (element): element is Extract<PPTElement, { type: 'group' }> => (
        element.type === 'group' && Boolean(element.source?.sourceObjectId)
      ),
    )
    if (!sourceGroup || !slide.source) throw new Error('Group fixture has no native group.')
    const copy = structuredClone(sourceGroup)
    copy.id = 'native-group-copy'
    copy.left += 35
    retainElementTreeCopyOrigins([copy], 'copy', {
      packageId: slide.source.packageId,
      slidePart: slide.source.slidePart,
    })
    slide.elements.push(copy)

    const result = await writeBackPowerPoint({
      baseline: ingested.presentation,
      bytes: archive,
      manifest: ingested.backing.manifest,
      presentation: desired,
    })
    const reimported = await ingestPowerPoint(result.bytes, {
      fileName: 'group-object-copy-roundtrip.pptx',
      theme,
    })
    const groups = reimported.presentation.slides[0]!.elements.filter(
      (element): element is Extract<PPTElement, { type: 'group' }> => element.type === 'group',
    )
    expect(groups).toHaveLength(
      ingested.presentation.slides[0]!.elements.filter(element => element.type === 'group').length + 1,
    )
    expect(groups.some(group => Math.abs(group.left - copy.left) < 0.1)).toBe(true)
    const objectIds = reimported.backing.manifest.objects
      .filter(object => object.partPath === reimported.presentation.slides[0]!.source?.slidePart)
      .map(object => object.stableId)
    expect(new Set(objectIds).size).toBe(objectIds.length)
  })

  it('retains an unaddressable child when malformed OOXML repeats a drawing id inside a copied group', async () => {
    const bytes = await readFile(join(REPO_ROOT, 'tests/corpus/public/corpus-05-groups.pptx'))
    const zip = await JSZip.loadAsync(bytes)
    const slidePath = 'ppt/slides/slide1.xml'
    const xml = await zip.file(slidePath)!.async('text')
    zip.file(slidePath, xml.replace('<p:cNvPr id="5" name="Oval 4"', '<p:cNvPr id="4" name="Oval 4"'))
    const archive = await zip.generateAsync({ type: 'arraybuffer' })
    const ingested = await ingestPowerPoint(archive, { fileName: 'duplicate-drawing-id.pptx', theme })
    const desired = structuredClone(ingested.presentation)
    const slide = desired.slides[0]!
    const sourceGroup = slide.elements.find(
      (element): element is Extract<PPTElement, { type: 'group' }> => (
        element.type === 'group'
        && Boolean(element.source?.sourceObjectId)
        && flattenElementTree(element.elements).some(child => !child.source?.sourceObjectId)
      ),
    )
    if (!sourceGroup || !slide.source) throw new Error('Malformed fixture did not retain the group around its repeated native id.')
    const copy = structuredClone(sourceGroup)
    copy.id = 'duplicate-native-id-group-copy'
    copy.left += 14
    retainElementTreeCopyOrigins([copy], 'copy', {
      packageId: slide.source.packageId,
      slidePart: slide.source.slidePart,
    })
    slide.elements.push(copy)

    const result = await writeBackPowerPoint({
      baseline: ingested.presentation,
      bytes: archive,
      manifest: ingested.backing.manifest,
      presentation: desired,
    })
    const reimported = await ingestPowerPoint(result.bytes, {
      fileName: 'duplicate-drawing-id-group-copy-roundtrip.pptx',
      theme,
    })
    const groups = reimported.presentation.slides[0]!.elements.filter(
      (element): element is Extract<PPTElement, { type: 'group' }> => element.type === 'group',
    )
    expect(groups).toHaveLength(
      ingested.presentation.slides[0]!.elements.filter(element => element.type === 'group').length + 1,
    )
    expect(groups.some(group => (
      Math.abs(group.left - copy.left) < 0.1
      && group.elements.length === sourceGroup.elements.length
    ))).toBe(true)
  })

  it.skipIf(!PRIVATE_FIXTURES.length)('serializes a slide-local inherited hide through a private layout/master pair', async () => {
    const fileName = PRIVATE_FIXTURES.find(name => name.includes('corporate')) ?? PRIVATE_FIXTURES[0]!
    const bytes = await readFile(join(PRIVATE_FIXTURE_ROOT, fileName))
    const archive = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    const ingested = await ingestPowerPoint(archive, { fileName, theme })
    const desired = structuredClone(ingested.presentation)
    const sourcePackages = desired.sourcePackages ?? []
    const candidate = desired.slides.flatMap(slide => (
      resolveSlideRenderState(slide, sourcePackages).nodes
        .filter(node => node.layer !== 'slide' && Boolean(node.element.source?.sourceObjectId))
        .map(node => ({ element: node.element, slide }))
    ))[0]
    if (!candidate?.slide.source || !candidate.element.source?.sourceObjectId) {
      throw new Error('Private fixture has no addressable inherited object.')
    }
    candidate.slide.source.hiddenInheritedObjectIds = [candidate.element.source.sourceObjectId]

    const plan = analyzePowerPointWriteback(
      ingested.presentation,
      desired,
      ingested.backing.manifest.packageId,
    )

    expect(plan.mode).toBe('patch')
    expect(plan.unsupported).toEqual([])
    expect(plan.operations).toContainEqual(expect.objectContaining({
      kind: 'inherited-visibility',
      slideId: candidate.slide.id,
    }))
    const result = await writeBackPowerPoint({
      baseline: ingested.presentation,
      bytes: archive,
      manifest: ingested.backing.manifest,
      presentation: desired,
    })
    const reimported = await ingestPowerPoint(result.bytes, {
      fileName: `private-${fileName}`,
      theme,
    })
    const roundTrippedSlide = reimported.presentation.slides[desired.slides.indexOf(candidate.slide)]!
    const inheritedCount = resolveSlideRenderState(
      roundTrippedSlide,
      reimported.presentation.sourcePackages ?? [],
    ).nodes.filter(node => node.layer !== 'slide').length
    const originalCount = resolveSlideRenderState(
      ingested.presentation.slides[desired.slides.indexOf(candidate.slide)]!,
      ingested.presentation.sourcePackages ?? [],
    ).nodes.filter(node => node.layer !== 'slide').length
    expect(inheritedCount).toBe(originalCount - 1)
  })

  it.skipIf(!PRIVATE_FIXTURES.length)('serializes an inherited object override as one local clone over a private hierarchy', async () => {
    const fileName = PRIVATE_FIXTURES.find(name => name.includes('corporate')) ?? PRIVATE_FIXTURES[0]!
    const bytes = await readFile(join(PRIVATE_FIXTURE_ROOT, fileName))
    const archive = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    const ingested = await ingestPowerPoint(archive, { fileName, theme })
    const desired = structuredClone(ingested.presentation)
    const sourcePackages = desired.sourcePackages ?? []
    const candidate = desired.slides.flatMap(slide => (
      resolveSlideRenderState(slide, sourcePackages).nodes
        .filter(node => node.layer !== 'slide' && Boolean(node.element.source?.sourceObjectId))
        .map(node => ({ element: node.element, slide }))
    ))[0]
    if (!candidate?.slide.source || !candidate.element.source?.sourceObjectId) {
      throw new Error('Private fixture has no addressable inherited object.')
    }
    const override = structuredClone(candidate.element)
    override.id = 'private-inherited-override'
    override.left += 18
    retainElementTreeCopyOrigins([override], 'override', {
      packageId: candidate.slide.source.packageId,
      slidePart: candidate.slide.source.slidePart,
    })
    candidate.slide.elements.push(override)

    const result = await writeBackPowerPoint({
      baseline: ingested.presentation,
      bytes: archive,
      manifest: ingested.backing.manifest,
      presentation: desired,
    })
    expect(result.plan.mode).toBe('patch')
    expect(result.plan.operations).toContainEqual(expect.objectContaining({
      kind: 'insert-object',
      mode: 'override',
      sourceObjectId: candidate.element.source.sourceObjectId,
    }))
    const reimported = await ingestPowerPoint(result.bytes, {
      fileName: `override-${fileName}`,
      theme,
    })
    const slideIndex = desired.slides.indexOf(candidate.slide)
    const roundTrippedSlide = reimported.presentation.slides[slideIndex]!
    const localAtOverride = roundTrippedSlide.elements.some(element => (
      Math.abs(element.left - override.left) < 0.1
      && Math.abs(element.top - override.top) < 0.1
      && element.type === override.type
    ))
    expect(localAtOverride).toBe(true)
    const originalInheritedCount = resolveSlideRenderState(
      ingested.presentation.slides[slideIndex]!,
      ingested.presentation.sourcePackages ?? [],
    ).nodes.filter(node => node.layer !== 'slide').length
    const roundTrippedInheritedCount = resolveSlideRenderState(
      roundTrippedSlide,
      reimported.presentation.sourcePackages ?? [],
    ).nodes.filter(node => node.layer !== 'slide').length
    expect(roundTrippedInheritedCount).toBe(originalInheritedCount - 1)
  })

  it.skipIf(!PRIVATE_FIXTURES.length)('serializes an inherited override on a newly copied native slide', async () => {
    const fileName = PRIVATE_FIXTURES.find(name => name.includes('corporate')) ?? PRIVATE_FIXTURES[0]!
    const bytes = await readFile(join(PRIVATE_FIXTURE_ROOT, fileName))
    const archive = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    const ingested = await ingestPowerPoint(archive, { fileName, theme })
    const desired = structuredClone(ingested.presentation)
    const sourcePackages = desired.sourcePackages ?? []
    const candidate = desired.slides.flatMap(slide => (
      resolveSlideRenderState(slide, sourcePackages).nodes
        .filter(node => node.layer !== 'slide' && Boolean(node.element.source?.sourceObjectId))
        .map(node => ({ element: node.element, slide }))
    ))[0]
    if (!candidate?.slide.source || !candidate.element.source?.sourceObjectId) {
      throw new Error('Private fixture has no addressable inherited object.')
    }
    const duplicate = structuredClone(candidate.slide)
    duplicate.id = 'copied-slide-inherited-override'
    duplicate.source = {
      ...candidate.slide.source,
      copyOnWrite: {
        packageId: candidate.slide.source.packageId,
        sourceSlidePart: candidate.slide.source.slidePart,
      },
    }
    retainElementTreeCopyOrigins(duplicate.elements, 'copy', {
      packageId: candidate.slide.source.packageId,
      slidePart: candidate.slide.source.slidePart,
    })
    const override = structuredClone(candidate.element)
    override.id = 'copied-slide-layout-override'
    override.left += 23
    retainElementTreeCopyOrigins([override], 'override', {
      packageId: candidate.slide.source.packageId,
      slidePart: candidate.slide.source.slidePart,
    })
    duplicate.elements.push(override)
    desired.slides.push(duplicate)

    const result = await writeBackPowerPoint({
      baseline: ingested.presentation,
      bytes: archive,
      manifest: ingested.backing.manifest,
      presentation: desired,
    })
    const reimported = await ingestPowerPoint(result.bytes, {
      fileName: `copied-override-${fileName}`,
      theme,
    })
    const roundTrippedSlide = reimported.presentation.slides.at(-1)!
    expect(roundTrippedSlide.source?.slidePart).not.toBe(candidate.slide.source.slidePart)
    expect(roundTrippedSlide.elements.some(element => (
      Math.abs(element.left - override.left) < 0.1
      && Math.abs(element.top - override.top) < 0.1
      && element.type === override.type
    ))).toBe(true)
    const originalInheritedCount = resolveSlideRenderState(
      candidate.slide,
      ingested.presentation.sourcePackages ?? [],
    ).nodes.filter(node => node.layer !== 'slide').length
    const copiedInheritedCount = resolveSlideRenderState(
      roundTrippedSlide,
      reimported.presentation.sourcePackages ?? [],
    ).nodes.filter(node => node.layer !== 'slide').length
    expect(copiedInheritedCount).toBe(originalInheritedCount - 1)
  })
})
