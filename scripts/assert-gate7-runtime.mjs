/* eslint-env node */
/* eslint-disable no-console */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const projectRoot = resolve(import.meta.dirname, '..')
const readBaseline = async name => JSON.parse(await readFile(resolve(projectRoot, `tests/parity/baselines/${name}-gate7-runtime.json`), 'utf8'))
const [source, destination] = await Promise.all([readBaseline('vue'), readBaseline('react')])

for (const report of [source, destination]) {
  if (report.serverMode !== 'production-preview') throw new Error(`${report.runtime} was not measured from a production preview`)
  if (report.sampleCount < 5) throw new Error(`${report.runtime} needs at least five runtime samples`)
}

const assertAtMost = (label, actual, limit) => {
  if (actual > limit) throw new Error(`${label} exceeds budget: ${actual} > ${limit}`)
}

assertAtMost('React editor-ready time', destination.medians.editorReadyMs, source.medians.editorReadyMs)
assertAtMost('React DOMContentLoaded time', destination.medians.domContentLoadedMs, source.medians.domContentLoadedMs)
assertAtMost('React load time', destination.medians.loadMs, source.medians.loadMs)
// Paint timestamps below one frame are especially sensitive to the browser's
// 60 Hz sampling boundary. React must stay within one frame of the Vue oracle.
assertAtMost('React first-contentful paint', destination.medians.firstContentfulPaintMs, source.medians.firstContentfulPaintMs + (1000 / 60))
assertAtMost('React critical-path transfer', destination.medians.transferBytes, source.medians.transferBytes)
assertAtMost('React critical-path decoded bytes', destination.medians.decodedBodyBytes, source.medians.decodedBodyBytes)
assertAtMost('React used JavaScript heap', destination.medians.usedJSHeapBytes, source.medians.usedJSHeapBytes)

console.log('Gate 7 production runtime budgets passed')
