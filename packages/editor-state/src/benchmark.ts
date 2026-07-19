import { createPresentationTransaction, type PresentationState } from '@mona/presentation-core'
import { createInteractionController } from '@mona/editor-interactions'
import { createEditorStore, editorActions } from './index'

export interface Gate2BenchmarkResult {
  deck: {
    slides: number
    elements: number
  }
  semanticTransactions: {
    samples: number
    medianMs: number
    p95Ms: number
    maxMs: number
    unrelatedSlideReferenceStable: boolean
  }
  pointerUpdates: {
    samples: number
    medianMs: number
    p95Ms: number
    maxMs: number
    reduxDispatchesDuringGesture: number
  }
}

const rounded = (value: number) => Math.round(value * 1000) / 1000

const percentile = (samples: number[], fraction: number) => {
  const sorted = samples.toSorted((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))
  return sorted[index] ?? 0
}

export const runGate2Benchmark = (
  presentation: PresentationState,
  options: { transactionSamples?: number; pointerSamples?: number } = {},
): Gate2BenchmarkResult => {
  const transactionSamples = options.transactionSamples ?? 300
  const pointerSamples = options.pointerSamples ?? 20_000
  const store = createEditorStore({ presentation, devChecks: false })
  const targetSlideIndex = presentation.slideIndex
  const targetSlide = presentation.slides[targetSlideIndex]
  const targetElement = targetSlide?.elements[0]
  const unrelatedSlideIndex = targetSlideIndex === 0 ? 1 : 0
  const unrelatedSlide = presentation.slides[unrelatedSlideIndex]
  if (!targetSlide || !targetElement || !unrelatedSlide) {
    throw new Error('Benchmark deck must contain at least two slides and one target element')
  }

  const dispatchSample = (sample: number) => {
    const transaction = createPresentationTransaction({
      id: `benchmark-${sample}`,
      label: 'Benchmark element move',
      origin: 'test',
      commands: [{
        type: 'element.update',
        payload: {
          id: targetElement.id,
          slideId: targetSlide.id,
          props: { left: targetElement.left + sample },
        },
      }],
    })
    const started = performance.now()
    store.dispatch(editorActions.transactionCommitted(transaction))
    return performance.now() - started
  }

  for (let sample = -20; sample < 0; sample += 1) dispatchSample(sample)
  const transactionDurations: number[] = []
  for (let sample = 0; sample < transactionSamples; sample += 1) {
    transactionDurations.push(dispatchSample(sample))
  }

  let reduxDispatches = 0
  const unsubscribe = store.subscribe(() => { reduxDispatches += 1 })
  const controller = createInteractionController()
  controller.begin({ gestureId: 'benchmark-drag', kind: 'drag', pointer: { x: 0, y: 0 } })
  const pointerDurations: number[] = []
  for (let sample = 0; sample < pointerSamples; sample += 1) {
    const started = performance.now()
    controller.updatePointer({ x: sample, y: sample / 2 })
    pointerDurations.push(performance.now() - started)
  }
  controller.complete()
  unsubscribe()

  const countElements = presentation.slides.reduce((sum, slide) => sum + slide.elements.length, 0)
  return {
    deck: { slides: presentation.slides.length, elements: countElements },
    semanticTransactions: {
      samples: transactionDurations.length,
      medianMs: rounded(percentile(transactionDurations, 0.5)),
      p95Ms: rounded(percentile(transactionDurations, 0.95)),
      maxMs: rounded(Math.max(...transactionDurations)),
      unrelatedSlideReferenceStable: store.getState().presentation.slides[unrelatedSlideIndex] === unrelatedSlide,
    },
    pointerUpdates: {
      samples: pointerDurations.length,
      medianMs: rounded(percentile(pointerDurations, 0.5)),
      p95Ms: rounded(percentile(pointerDurations, 0.95)),
      maxMs: rounded(Math.max(...pointerDurations)),
      reduxDispatchesDuringGesture: reduxDispatches,
    },
  }
}
