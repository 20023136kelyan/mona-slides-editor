import { readFile } from 'node:fs/promises'

import { parse, type ChartItem } from '@mona/pptx-parser'
import { describe, expect, it } from 'vitest'

const corpusFile = (name: string) => new URL(
  `../../../../../tests/corpus/public/${name}`,
  import.meta.url,
)

describe('PowerPoint chart categories', () => {
  it('reads grouped category axes instead of falling back to point indices', async () => {
    const file = await readFile(corpusFile('corpus-04-chart-table.pptx'))
    const source = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
    const parsed = await parse(source, { audioMode: 'none', imageMode: 'none', videoMode: 'none' })

    const charts = parsed.slides.flatMap(slide => slide.elements.filter(element => element.type === 'chart'))
    expect(charts.length).toBeGreaterThan(0)

    // Two of this deck's charts store their categories as <c:multiLvlStrRef>
    // rather than <c:strRef>. Without that branch every label collapses to its
    // numeric index and the axis reads 0, 1, 2.
    const labelled = charts.filter(chart => {
      const series = chart.data as ChartItem[]
      return Array.isArray(series) && series.some(item => Object.keys(item.xlabels ?? {}).length > 0)
    })
    expect(labelled.length).toBeGreaterThan(0)

    for (const chart of labelled) {
      for (const item of chart.data as ChartItem[]) {
        for (const label of Object.values(item.xlabels ?? {})) {
          expect(typeof label).toBe('string')
          expect(String(label).trim()).not.toBe('')
          // A bare index means the category reference was not understood.
          expect(String(label)).not.toMatch(/^\d+$/)
        }
      }
    }
  })
})
