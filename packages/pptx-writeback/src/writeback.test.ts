import { readFile, readdir } from 'node:fs/promises'
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
    })
  }

  it('rejects new hyperlink targets until relationship allocation is available', async () => {
    const fixture = await source()
    const desired = structuredClone(fixture.ingested.presentation)
    const target = editableTextElement(desired)
    const text = target.type === 'text' ? target : target.text!
    text.content = '<p><a href="https://example.com/new"><span>New link</span></a></p>'
    delete text.structuredText

    await expect(writeBackPowerPoint({
      baseline: fixture.ingested.presentation,
      bytes: fixture.bytes,
      manifest: fixture.ingested.backing.manifest,
      presentation: desired,
    })).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'pptx.writeback.hyperlink-relationship' }),
      ]),
    })
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
