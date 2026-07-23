import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createLargeTestPresentation } from '@mona/test-fixtures'
import { runEditorStateBenchmark } from '@mona/editor-state/benchmark'

describe('editor state and interaction performance', () => {
  it('keeps semantic document updates and pointer-frequency state within budget', () => {
    const result = runEditorStateBenchmark(createLargeTestPresentation())

    expect(result.deck).toEqual({ slides: 120, elements: 4_800 })
    expect(result.semanticTransactions.unrelatedSlideReferenceStable).toBe(true)
    expect(result.semanticTransactions.p95Ms).toBeLessThan(8)
    expect(result.pointerUpdates.p95Ms).toBeLessThan(0.5)
    expect(result.pointerUpdates.reduxDispatchesDuringGesture).toBe(0)

    if (process.env.MONA_WRITE_PERFORMANCE_BASELINE === '1') {
      const outputPath = fileURLToPath(new URL(
        'baselines/editor-state-performance.json',
        import.meta.url,
      ))
      mkdirSync(fileURLToPath(new URL('baselines/', import.meta.url)), { recursive: true })
      writeFileSync(outputPath, `${JSON.stringify({
        measuredAt: new Date().toISOString(),
        runtime: process.version,
        budgets: {
          semanticTransactionP95Ms: 8,
          pointerUpdateP95Ms: 0.5,
          reduxDispatchesDuringGesture: 0,
        },
        result,
      }, null, 2)}\n`)
    }
  })
})
