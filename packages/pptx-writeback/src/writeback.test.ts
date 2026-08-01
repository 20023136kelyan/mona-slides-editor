import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import { flattenElementTree, type PPTElement, type SlideTheme } from '@mona/presentation-core'
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
})
