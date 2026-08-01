import { readFile } from 'node:fs/promises'

import {
  flattenElementTree,
  validatePresentationState,
  type SlideTheme,
} from '@mona/presentation-core'
import { describe, expect, it } from 'vitest'

import { ingestPowerPoint } from './index'
import { promotePowerPointListTextStyle } from './html-fragment'

const theme: SlideTheme = {
  backgroundColor: '#ffffff',
  fontColor: '#333333',
  fontName: 'Arial',
  outline: { color: '#525252', style: 'solid', width: 2 },
  shadow: { blur: 2, color: '#808080', h: 3, v: 3 },
  themeColors: ['#5b9bd5', '#ed7d31', '#a5a5a5'],
}

const corpus = (name: string): URL => new URL(
  `../../../tests/corpus/public/${name}`,
  import.meta.url,
)

const arrayBuffer = async (name: string): Promise<ArrayBuffer> => {
  const bytes = await readFile(corpus(name))
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer
}

const collectStrings = (value: unknown, found: string[] = []): string[] => {
  if (typeof value === 'string') found.push(value)
  else if (Array.isArray(value)) {
    for (const entry of value) collectStrings(entry, found)
  }
  else if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) collectStrings(entry, found)
  }
  return found
}

describe('desktop-safe PowerPoint ingestion', () => {
  for (const fileName of [
    'corpus-01-text.pptx',
    'corpus-02-shapes-lines.pptx',
    'corpus-03-media.pptx',
    'corpus-04-chart-table.pptx',
    'corpus-05-groups.pptx',
  ]) {
    it(`ingests ${fileName} without a renderer DOM`, async () => {
      const source = await arrayBuffer(fileName)
      const result = await ingestPowerPoint(source, { fileName, theme })
      const validation = validatePresentationState(result.presentation)

      expect(validation.issues.filter(issue => issue.severity === 'error')).toEqual([])
      expect(result.backing.bytes.byteLength).toBe(source.byteLength)
      expect(result.backing.reference.packageId).toMatch(/^pptx:[a-f0-9]{64}$/)
      expect(result.backing.reference.coordinateScale).toBeCloseTo(96 / 72, 8)
      expect(result.backing.manifest.coordinateScale).toBeCloseTo(96 / 72, 8)
      expect(result.backing.manifest.parts.length).toBeGreaterThan(0)
      expect(result.presentation.slides.length).toBeGreaterThan(0)
      expect(result.report.slides).toHaveLength(result.presentation.slides.length)
      expect(result.presentation.sourcePackages?.[0]?.importReport).toEqual(result.report)
      expect(
        result.presentation.slides.flatMap(slide => flattenElementTree(slide.elements)).length,
      ).toBeGreaterThan(0)
      expect(
        collectStrings(result.presentation).filter(value => value.startsWith('data:')),
      ).toEqual([])
      expect(new Set(result.assets.map(asset => asset.name)).size).toBe(result.assets.length)
    })
  }

  it('keeps package and media identities deterministic across runs', async () => {
    const source = await arrayBuffer('corpus-03-media.pptx')
    const first = await ingestPowerPoint(source, {
      assetUrl: ({ name }) => `asset://${name}`,
      fileName: 'corpus-03-media.pptx',
      theme,
    })
    const second = await ingestPowerPoint(source, {
      assetUrl: ({ name }) => `asset://${name}`,
      fileName: 'corpus-03-media.pptx',
      theme,
    })

    expect(second.backing.reference.packageId).toBe(first.backing.reference.packageId)
    expect(second.assets.map(asset => asset.name)).toEqual(first.assets.map(asset => asset.name))
    expect(second.assets.map(asset => asset.url)).toEqual(first.assets.map(asset => asset.url))
  })

  it('records the exact coordinate scale used by fixed-viewport imports', async () => {
    const source = await arrayBuffer('corpus-02-shapes-lines.pptx')
    const result = await ingestPowerPoint(source, {
      fileName: 'corpus-02-shapes-lines.pptx',
      fixedViewport: true,
      theme,
    })

    expect(result.presentation.viewportSize).toBe(1000)
    expect(result.backing.reference.coordinateScale).toBeCloseTo(
      1000 / result.parsed.size.width,
      8,
    )
  })

  it('honors cancellation before reading the package', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(ingestPowerPoint(new ArrayBuffer(0), {
      fileName: 'cancelled.pptx',
      signal: controller.signal,
      theme,
    })).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('rejects incomplete OOXML rather than returning a partial presentation', async () => {
    await expect(ingestPowerPoint(new ArrayBuffer(12), {
      fileName: 'broken.pptx',
      theme,
    })).rejects.toThrow()
  })
})

describe('DOM-free rich-text compatibility', () => {
  it('promotes a shared direct-list run style without touching nested list text', () => {
    const html = [
      '<ul>',
      '<li><span style="font-size: 20px; color: #123456">One</span></li>',
      '<li><span style="font-size: 20px; color: #123456">Two</span>',
      '<ul><li><span style="font-size: 12px">Nested</span></li></ul></li>',
      '</ul>',
    ].join('')
    const promoted = promotePowerPointListTextStyle(html)

    expect(promoted).toContain('<ul style="font-size: 20px; color: #123456">')
    expect(promoted).toContain('<ul style="font-size: 12px"><li><span style="font-size: 12px">Nested</span>')
  })

  it('does not promote when direct items disagree', () => {
    const html = '<ul><li><span style="color: red">One</span></li><li><span style="color: blue">Two</span></li></ul>'
    expect(promotePowerPointListTextStyle(html)).toBe(html)
  })
})
