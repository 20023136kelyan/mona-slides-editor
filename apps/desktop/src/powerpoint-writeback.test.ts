import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ingestPowerPoint } from '@mona/pptx-ingestion'
import {
  flattenElementTree,
  type PresentationState,
} from '@mona/presentation-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let userDataRoot = ''

vi.mock('electron', () => ({
  app: {
    getPath: () => userDataRoot,
  },
}))

const {
  createDocument,
  readDocument,
  writeDocument,
} = await import('./document-library.js')
const {
  DEFAULT_POWERPOINT_THEME,
  ingestPowerPointForDocument,
} = await import('./powerpoint-ingestion.js')
const { exportPowerPointForDocument } = await import('./powerpoint-writeback.js')

describe('desktop PowerPoint writeback', () => {
  beforeEach(async () => {
    userDataRoot = await mkdtemp(join(tmpdir(), 'mona-pptx-writeback-test-'))
  })

  afterEach(async () => {
    await rm(userDataRoot, { force: true, recursive: true })
  })

  const setup = async () => {
    const bytes = await readFile(new URL(
      '../../../tests/corpus/public/corpus-01-text.pptx',
      import.meta.url,
    ))
    const document = await createDocument({
      slideIndex: 0,
      slides: [{ elements: [], id: 'recovery-slide' }],
      templates: [],
      theme: DEFAULT_POWERPOINT_THEME,
      title: 'Recovery',
      viewportRatio: 0.5625,
      viewportSize: 1000,
    })
    const ingested = await ingestPowerPointForDocument({
      bytes,
      documentId: document.id,
      fileName: 'corpus-01-text.pptx',
      theme: DEFAULT_POWERPOINT_THEME,
      writeAsset: async (_documentId, name) => name,
    })
    await writeDocument(document.id, ingested.presentation)
    return {
      bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      documentId: document.id,
      presentation: ingested.presentation,
    }
  }

  it('returns exact source bytes for a no-op document export', async () => {
    const fixture = await setup()
    const result = await exportPowerPointForDocument({
      documentId: fixture.documentId,
      presentation: fixture.presentation,
    })

    expect(result.plan.mode).toBe('noop')
    expect(Buffer.from(result.bytes).equals(Buffer.from(fixture.bytes))).toBe(true)
  })

  it('exports a geometry edit from the document-owned retained package', async () => {
    const fixture = await setup()
    const presentation = structuredClone(fixture.presentation) as PresentationState
    const target = presentation.slides.flatMap(slide => slide.elements).find(element => (
      element.type !== 'line'
      && element.source?.sourceLayer === 'slide'
      && element.source.sourcePart === element.source.slidePart
      && element.width > 0
      && element.height > 0
    ))
    if (!target || target.type === 'line') throw new Error('Fixture has no patchable element.')
    target.left += 31
    await writeDocument(fixture.documentId, presentation)

    const stored = await readDocument(fixture.documentId)
    const result = await exportPowerPointForDocument({
      documentId: fixture.documentId,
      presentation: stored?.presentation,
    })
    expect(result.plan.mode).toBe('patch')
    const reimported = await ingestPowerPoint(result.bytes, {
      fileName: 'round-trip.pptx',
      theme: presentation.theme,
    })
    const roundTripped = reimported.presentation.slides
      .flatMap(slide => flattenElementTree(slide.elements))
      .find(element => (
        element.source?.nativeShapeId === target.source?.nativeShapeId
        && element.source?.sourcePart === target.source?.sourcePart
      ))
    expect(roundTripped?.left).toBeCloseTo(target.left, 2)
  })

  it('exports an editable text rewrite from the document-owned retained package', async () => {
    const fixture = await setup()
    const presentation = structuredClone(fixture.presentation) as PresentationState
    const target = presentation.slides.flatMap(slide => flattenElementTree(slide.elements)).find(
      element => (
        (element.type === 'text' || (element.type === 'shape' && Boolean(element.text)))
        && element.source?.sourceLayer === 'slide'
        && element.source.sourcePart === element.source.slidePart
      ),
    )
    if (!target || (target.type !== 'text' && target.type !== 'shape')) {
      throw new Error('Fixture has no editable text body.')
    }
    if (target.type === 'text') {
      target.content = '<p>Desktop source-preserving text.</p>'
      delete target.structuredText
    }
    else {
      target.text!.content = '<p>Desktop source-preserving text.</p>'
      delete target.text!.structuredText
    }
    await writeDocument(fixture.documentId, presentation)

    const stored = await readDocument(fixture.documentId)
    const result = await exportPowerPointForDocument({
      documentId: fixture.documentId,
      presentation: stored?.presentation,
    })
    expect(result.plan.operations).toContainEqual(expect.objectContaining({ kind: 'text' }))
    const reimported = await ingestPowerPoint(result.bytes, {
      fileName: 'text-round-trip.pptx',
      theme: presentation.theme,
    })
    const roundTripped = reimported.presentation.slides
      .flatMap(slide => flattenElementTree(slide.elements))
      .find(element => (
        element.source?.nativeShapeId === target.source?.nativeShapeId
        && element.source?.sourcePart === target.source?.sourcePart
      ))
    const content = roundTripped?.type === 'text'
      ? roundTripped.content
      : roundTripped?.type === 'shape'
        ? roundTripped.text?.content
        : undefined
    expect(content).toContain('Desktop source-preserving text.')
  })

  it('exports a straight-line geometry and style edit from the retained package', async () => {
    const bytes = await readFile(new URL(
      '../../../tests/corpus/public/corpus-02-shapes-lines.pptx',
      import.meta.url,
    ))
    const document = await createDocument({
      slideIndex: 0,
      slides: [{ elements: [], id: 'recovery-slide' }],
      templates: [],
      theme: DEFAULT_POWERPOINT_THEME,
      title: 'Recovery',
      viewportRatio: 0.5625,
      viewportSize: 1000,
    })
    const ingested = await ingestPowerPointForDocument({
      bytes,
      documentId: document.id,
      fileName: 'corpus-02-shapes-lines.pptx',
      theme: DEFAULT_POWERPOINT_THEME,
      writeAsset: async (_documentId, name) => name,
    })
    const presentation = structuredClone(ingested.presentation) as PresentationState
    const target = presentation.slides.flatMap(slide => flattenElementTree(slide.elements)).find(
      element => (
        element.type === 'line'
        && !element.broken
        && !element.broken2
        && !element.curve
        && !element.cubic
        && element.source?.sourceLayer === 'slide'
      ),
    )
    if (!target || target.type !== 'line') throw new Error('Fixture has no straight line.')
    const nativeShapeId = target.source?.nativeShapeId
    const sourcePart = target.source?.sourcePart
    const start: [number, number] = [
      target.left + target.start[0],
      target.top + target.start[1],
    ]
    const oldEnd: [number, number] = [
      target.left + target.end[0],
      target.top + target.end[1],
    ]
    const end: [number, number] = [oldEnd[0] + 20, oldEnd[1] + 15]
    target.left = Math.min(start[0], end[0])
    target.top = Math.min(start[1], end[1])
    target.start = [start[0] - target.left, start[1] - target.top]
    target.end = [end[0] - target.left, end[1] - target.top]
    target.color = '#2468ac'
    target.style = 'dotted'
    target.width = 3
    target.points = ['dot', 'arrow']
    await writeDocument(document.id, presentation)

    const stored = await readDocument(document.id)
    const result = await exportPowerPointForDocument({
      documentId: document.id,
      presentation: stored?.presentation,
    })
    expect(result.plan.operations).toContainEqual(expect.objectContaining({ kind: 'connector' }))
    const reimported = await ingestPowerPoint(result.bytes, {
      fileName: 'desktop-line-round-trip.pptx',
      theme: presentation.theme,
    })
    const roundTripped = reimported.presentation.slides
      .flatMap(slide => flattenElementTree(slide.elements))
      .find(element => (
        element.source?.nativeShapeId === nativeShapeId
        && element.source?.sourcePart === sourcePart
      ))
    expect(roundTripped?.type).toBe('line')
    if (roundTripped?.type !== 'line') return
    expect(roundTripped.left + roundTripped.start[0]).toBeCloseTo(start[0], 2)
    expect(roundTripped.top + roundTripped.start[1]).toBeCloseTo(start[1], 2)
    expect(roundTripped.left + roundTripped.end[0]).toBeCloseTo(end[0], 2)
    expect(roundTripped.top + roundTripped.end[1]).toBeCloseTo(end[1], 2)
    expect(roundTripped.color.toLowerCase()).toBe('#2468ac')
    expect(roundTripped.style).toBe('dotted')
    expect(roundTripped.width).toBeCloseTo(3, 1)
    expect(roundTripped.points).toEqual(['dot', 'arrow'])
  })
})
