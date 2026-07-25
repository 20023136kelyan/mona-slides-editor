import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

import { openEmbeddedWorkbook, parse, parseRangeFormula } from '@mona/pptx-parser'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import { createPowerPointPackageBacking } from '@/features/editor/editor-pptx-package'

const corpusFile = (name: string) => new URL(
  `../../../../../tests/corpus/public/${name}`,
  import.meta.url,
)

const privateStressFixture = new URL(
  '../../../../../tests/corpus/private/real-01-powerpoint-native-charts-stress.pptx',
  import.meta.url,
)

const readSource = async (location: URL) => {
  const file = await readFile(location)
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer
}

describe('PowerPoint chart retention', () => {
  it('addresses every chart part and its embedded workbook', async () => {
    const source = await readSource(corpusFile('corpus-04-chart-table.pptx'))
    const [parsed, backing] = await Promise.all([
      parse(source, { audioMode: 'none', imageMode: 'none', videoMode: 'none' }),
      createPowerPointPackageBacking(source, 'corpus-04-chart-table.pptx'),
    ])

    const charts = parsed.slides.flatMap(slide => slide.elements.filter(element => element.type === 'chart'))
    expect(charts.length).toBeGreaterThan(0)

    const parts = new Set(backing.manifest.parts.map(part => part.path))
    for (const chart of charts) {
      const resources = chart.resources
      expect(resources, 'a chart must know which part it came from').toBeDefined()
      // The chart part and every part it references have to exist in the
      // retained package, or a later export has nothing to copy.
      expect(parts.has(resources!.partPath)).toBe(true)
      expect(resources!.workbookPart, 'this deck ships a workbook per chart').toBeDefined()
      expect(parts.has(resources!.workbookPart!)).toBe(true)
    }
  })

  it('keeps an unedited workbook byte-identical inside the retained package', async () => {
    const source = await readSource(corpusFile('corpus-04-chart-table.pptx'))
    const [parsed, backing] = await Promise.all([
      parse(source, { audioMode: 'none', imageMode: 'none', videoMode: 'none' }),
      createPowerPointPackageBacking(source, 'corpus-04-chart-table.pptx'),
    ])

    const workbookPart = parsed.slides
      .flatMap(slide => slide.elements.filter(element => element.type === 'chart'))
      .map(chart => chart.resources?.workbookPart)
      .find((path): path is string => Boolean(path))!

    // Read the same part out of the original file and out of the bytes Mona
    // retained, and require them to match exactly. This is the gate the later
    // export slice depends on: an untouched workbook must survive import
    // without being reinterpreted.
    const original = await JSZip.loadAsync(source)
    const retained = await JSZip.loadAsync(backing.bytes)
    const originalBytes = await original.file(workbookPart)!.async('uint8array')
    const retainedBytes = await retained.file(workbookPart)!.async('uint8array')

    expect(retainedBytes.byteLength).toBe(originalBytes.byteLength)
    expect(retainedBytes).toEqual(originalBytes)
  })

  it.skipIf(!existsSync(privateStressFixture))(
    'records a linked-but-not-embedded workbook instead of dropping it',
    async () => {
      const file = await readFile(privateStressFixture)
      const source = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer
      const parsed = await parse(source, { audioMode: 'none', imageMode: 'none', videoMode: 'none' })
      const charts = parsed.slides.flatMap(slide => slide.elements.filter(element => element.type === 'chart'))

      // Every chart knows its own part, whatever its data source turns out to be.
      expect(charts.length).toBe(8)
      for (const chart of charts) expect(chart.resources?.partPath).toBeDefined()

      // Six of this deck's charts link a workbook on the author's own machine.
      // It cannot be opened, so it is recorded as an external reference rather
      // than left looking like a chart with no source at all.
      const external = charts.filter(chart => chart.resources?.externalWorkbook)
      expect(external.length).toBe(6)
      expect(external[0]!.resources!.externalWorkbook).toContain('.xls')
      expect(external[0]!.resources!.workbookPart).toBeUndefined()

      // The two embedded workbooks still resolve to real parts.
      expect(charts.filter(chart => chart.resources?.workbookPart).length).toBe(2)
      // And the overlay and theme override a chart may own are addressed too.
      expect(charts.filter(chart => chart.resources?.userShapesPart).length).toBe(1)
      expect(charts.filter(chart => chart.resources?.themeOverridePart).length).toBe(1)
    },
  )
})

describe('PowerPoint chart space', () => {
  it('retains each chart part\'s families, series, and axes', async () => {
    const source = await readSource(corpusFile('corpus-04-chart-table.pptx'))
    const parsed = await parse(source, { audioMode: 'none', imageMode: 'none', videoMode: 'none' })
    const charts = parsed.slides.flatMap(slide => slide.elements.filter(element => element.type === 'chart'))

    expect(charts.length).toBe(3)
    expect(charts.every(chart => chart.chartSpace)).toBe(true)
    // This deck draws its bar, line, and pie in three separate parts.
    const kinds = charts.flatMap(chart => chart.chartSpace!.plotArea.families.map(family => family.kind)).sort()
    expect(kinds).toEqual(['barChart', 'lineChart', 'pieChart'])

    for (const chart of charts) {
      for (const family of chart.chartSpace!.plotArea.families) {
        expect(family.series.length).toBeGreaterThan(0)
        // Series carry their own cached values and stay in plot order.
        expect(family.series[0]!.values?.length).toBeGreaterThan(0)
      }
    }
    // Every axis is addressable by id, which is what a secondary axis needs to
    // be expressible at all.
    for (const chart of charts) {
      for (const axis of chart.chartSpace!.plotArea.axes) expect(axis.id).not.toBe('')
    }
  })

  it('keeps a pie chart, which has no axes, as a family of its own', async () => {
    const source = await readSource(corpusFile('corpus-04-chart-table.pptx'))
    const parsed = await parse(source, { audioMode: 'none', imageMode: 'none', videoMode: 'none' })
    const charts = parsed.slides.flatMap(slide => slide.elements.filter(element => element.type === 'chart'))

    const pie = charts.find(chart => chart.chartSpace?.plotArea.families.some(family => family.kind === 'pieChart'))
    expect(pie).toBeDefined()
    expect(pie!.chartSpace!.plotArea.axes).toEqual([])
    expect(pie!.chartSpace!.plotArea.families[0]!.series[0]!.values?.length).toBeGreaterThan(0)
  })

  it.skipIf(!existsSync(privateStressFixture))(
    'retains chart titles, legend placement, and axis titles',
    async () => {
      const file = await readFile(privateStressFixture)
      const source = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer
      const parsed = await parse(source, { audioMode: 'none', imageMode: 'none', videoMode: 'none' })
      const charts = parsed.slides.flatMap(slide => slide.elements.filter(element => element.type === 'chart'))

      expect(charts.every(chart => chart.chartSpace)).toBe(true)
      const titled = charts.find(chart => chart.chartSpace?.title?.text)
      expect(titled, 'this deck titles at least one chart').toBeDefined()
      const withLegend = charts.find(chart => chart.chartSpace?.legend?.position)
      expect(withLegend?.chartSpace?.legend?.position).toBeTruthy()
      // A multi-series family keeps each series separately rather than merging
      // them into one flat list.
      const multi = charts.find(chart => (chart.chartSpace?.plotArea.families[0]?.series.length ?? 0) > 1)
      expect(multi).toBeDefined()

      // One part in this deck plots two families against the same axis pair.
      // The flat chartType union reports a single type for it, so the second
      // family is exactly what the typed space exists to keep.
      const combo = charts.find(chart => (chart.chartSpace?.plotArea.families.length ?? 0) > 1)
      expect(combo, 'this deck contains a combo chart').toBeDefined()
      expect(new Set(combo!.chartSpace!.plotArea.families.map(family => family.kind)).size).toBeGreaterThan(1)
      for (const family of combo!.chartSpace!.plotArea.families) {
        expect(family.axisIds.length).toBeGreaterThan(0)
        expect(family.series.length).toBeGreaterThan(0)
      }
    },
  )
})

describe('PowerPoint chart data sources', () => {
  it('records the workbook range behind every cached series', async () => {
    const source = await readSource(corpusFile('corpus-04-chart-table.pptx'))
    const parsed = await parse(source, { audioMode: 'none', imageMode: 'none', videoMode: 'none' })
    const charts = parsed.slides.flatMap(slide => slide.elements.filter(element => element.type === 'chart'))

    for (const chart of charts) {
      for (const family of chart.chartSpace!.plotArea.families) {
        for (const series of family.series) {
          const references = series.references
          expect(references, 'a series must say where its numbers came from').toBeDefined()
          // The cache is a copy of a range. Without the range an edit has
          // nowhere to write back and a stale cache is indistinguishable from
          // a fresh one.
          expect(references!.values?.formula).toMatch(/!\$?[A-Z]/)
          expect(references!.values?.kind).toBe('number')
          // The declared point count has to agree with the cache that follows it.
          expect(references!.values?.pointCount).toBe(series.values?.length)
          expect(references!.categories?.formula).toBeTruthy()
          expect(references!.categories?.pointCount).toBe(series.categories?.length)
        }
      }
    }
  })

  it('ties a chart formula to the workbook part that answers it', async () => {
    const source = await readSource(corpusFile('corpus-04-chart-table.pptx'))
    const [parsed, backing] = await Promise.all([
      parse(source, { audioMode: 'none', imageMode: 'none', videoMode: 'none' }),
      createPowerPointPackageBacking(source, 'corpus-04-chart-table.pptx'),
    ])
    const parts = new Set(backing.manifest.parts.map(part => part.path))
    const charts = parsed.slides.flatMap(slide => slide.elements.filter(element => element.type === 'chart'))

    for (const chart of charts) {
      // formula -> externalData relationship -> chart relationship -> part.
      // The whole chain has to hold for an edit to reach the workbook, and for
      // an export to know which part it must rewrite.
      const relationshipId = chart.chartSpace!.externalData?.relationshipId
      expect(relationshipId, 'the chart links its data to a relationship').toBeTruthy()
      expect(chart.resources!.relationshipIds.workbookPart).toBe(relationshipId)
      expect(parts.has(chart.resources!.workbookPart!)).toBe(true)
    }
  })

  it.skipIf(!existsSync(privateStressFixture))(
    'keeps the number format a cache declares',
    async () => {
      const file = await readFile(privateStressFixture)
      const source = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer
      const parsed = await parse(source, { audioMode: 'none', imageMode: 'none', videoMode: 'none' })
      const series = parsed.slides
        .flatMap(slide => slide.elements.filter(element => element.type === 'chart'))
        .flatMap(chart => chart.chartSpace!.plotArea.families)
        .flatMap(family => family.series)

      // A format code decides how a value reads — thousands separators here.
      // Dropping it turns a formatted figure into a bare number.
      const formatted = series.find(item => item.references?.values?.formatCode === '#,##0')
      expect(formatted, 'this deck formats a series with thousands separators').toBeDefined()
      expect(formatted!.references!.values!.formula).toContain('!')
    },
  )
})

describe('embedded workbook reading', () => {
  it('resolves a chart formula to the cells the workbook actually holds', async () => {
    const source = await readSource(corpusFile('corpus-04-chart-table.pptx'))
    const parsed = await parse(source, { audioMode: 'none', imageMode: 'none', videoMode: 'none' })
    const archive = await JSZip.loadAsync(source)
    const charts = parsed.slides.flatMap(slide => slide.elements.filter(element => element.type === 'chart'))

    let checked = 0
    for (const chart of charts) {
      const workbookPart = chart.resources?.workbookPart
      if (!workbookPart) continue
      const workbook = await openEmbeddedWorkbook(await archive.file(workbookPart)!.async('arraybuffer'))
      expect(workbook.sheetNames.length).toBeGreaterThan(0)

      for (const family of chart.chartSpace!.plotArea.families) {
        for (const series of family.series) {
          const formula = series.references?.values?.formula
          if (!formula) continue
          // The cache is meant to be a copy of this range. Reading the range
          // back proves the whole chain resolves and that the cached numbers
          // are the workbook's numbers, not a stale copy.
          const values = await workbook.readRange(formula)
          expect(values).toEqual(series.values)
          checked += 1
        }
      }
    }
    expect(checked, 'at least one series was verified against its workbook').toBeGreaterThan(0)
  })

  it('reads categories through the shared string table', async () => {
    const source = await readSource(corpusFile('corpus-04-chart-table.pptx'))
    const parsed = await parse(source, { audioMode: 'none', imageMode: 'none', videoMode: 'none' })
    const archive = await JSZip.loadAsync(source)
    const chart = parsed.slides
      .flatMap(slide => slide.elements.filter(element => element.type === 'chart'))
      .find(candidate => candidate.resources?.workbookPart)!
    const workbook = await openEmbeddedWorkbook(await archive.file(chart.resources!.workbookPart!)!.async('arraybuffer'))

    const series = chart.chartSpace!.plotArea.families[0]!.series[0]!
    const values = await workbook.readRange(series.references!.categories!.formula!)
    // Category labels live in the workbook's shared string table rather than
    // in the cell, so this fails loudly if the table is not followed.
    expect(values).toEqual(series.categories)
    expect(values!.every(value => typeof value === 'string')).toBe(true)
  })

  it('parses the range forms a chart formula can take', () => {
    expect(parseRangeFormula('Sheet1!$B$2:$B$5')).toEqual({
      end: { column: 1, row: 4 },
      sheet: 'Sheet1',
      start: { column: 1, row: 1 },
    })
    // A quoted sheet name carries spaces, and an embedded quote is doubled.
    expect(parseRangeFormula("'My Data'!$A$1")).toEqual({
      end: { column: 0, row: 0 },
      sheet: 'My Data',
      start: { column: 0, row: 0 },
    })
    expect(parseRangeFormula("'It''s Data'!A1:B2")?.sheet).toBe("It's Data")
    // Columns past Z carry into a second letter.
    expect(parseRangeFormula('Sheet1!$AH$2')?.start.column).toBe(33)
    expect(parseRangeFormula('not a range')).toBeUndefined()
  })

  it.skipIf(!existsSync(privateStressFixture))(
    'reads a real workbook faithfully, so a stale cache becomes detectable',
    async () => {
      const file = await readFile(privateStressFixture)
      const source = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer
      const parsed = await parse(source, { audioMode: 'none', imageMode: 'none', videoMode: 'none' })
      const archive = await JSZip.loadAsync(source)
      const charts = parsed.slides
        .flatMap(slide => slide.elements.filter(element => element.type === 'chart'))
        .filter(chart => chart.resources?.workbookPart)

      expect(charts.length).toBe(2)
      const outcomes: boolean[] = []
      for (const chart of charts) {
        const workbook = await openEmbeddedWorkbook(
          await archive.file(chart.resources!.workbookPart!)!.async('arraybuffer'),
        )
        const series = chart.chartSpace!.plotArea.families[0]!.series[0]!
        const formula = series.references!.values!.formula!
        const values = await workbook.readRange(formula)

        // The reader returns the range the formula names, cell for cell —
        // a column range, a row range, or a block of both.
        const range = parseRangeFormula(formula)!
        const rows = Math.abs(range.end.row - range.start.row) + 1
        const columns = Math.abs(range.end.column - range.start.column) + 1
        expect(values!.length).toBe(rows * columns)
        outcomes.push(JSON.stringify(values) === JSON.stringify(series.values))
      }

      // One of this deck's workbooks still agrees with its chart. The other
      // was edited after the chart cached it, so the two now differ — which is
      // precisely what retaining the formula makes visible. Reading the cache
      // alone can never tell the two apart.
      expect(outcomes).toContain(true)
      expect(outcomes).toContain(false)
    },
  )
})
