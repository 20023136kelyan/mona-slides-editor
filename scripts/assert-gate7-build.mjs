/* eslint-env node */
/* eslint-disable no-console */

import { readdir, readFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

const projectRoot = resolve(import.meta.dirname, '..')
const builds = [resolve(projectRoot, 'apps/web/dist')]
const baseline = async name => JSON.parse(await readFile(resolve(projectRoot, `tests/parity/baselines/${name}-gate7-build.json`), 'utf8'))

const collectFiles = async directory => {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = resolve(directory, entry.name)
    if (entry.isDirectory()) files.push(...await collectFiles(target))
    else files.push(target)
  }
  return files
}

for (const directory of builds) {
  for (const file of await collectFiles(directory)) {
    const path = relative(directory, file)
    if (/\.pptx$/i.test(path) || /(^|\/)(?:corpus|private)(?:\/|$)/i.test(path)) {
      throw new Error(`Test/private fixture escaped into production build: ${relative(projectRoot, file)}`)
    }
  }
}

const [vue, react] = await Promise.all([baseline('vue'), baseline('react')])
const sourceJavaScript = vue.byGroup.js
const destinationJavaScript = react.byGroup.js
const sourceCss = vue.byGroup.css
const destinationCss = react.byGroup.css

const assertBudget = (label, actual, reference, ratio) => {
  const limit = Math.ceil(reference * ratio)
  if (actual > limit) throw new Error(`${label} exceeds budget: ${actual} > ${limit} (${Math.round(ratio * 100)}% of Vue reference)`)
}

// A small allowance covers framework/runtime differences while forbidding the
// migration from hiding broad duplication in lazy chunks. The critical-path
// network and runtime budgets are independently measured in Playwright.
assertBudget('Total JavaScript bytes', destinationJavaScript.bytes, sourceJavaScript.bytes, 1.05)
assertBudget('Total gzipped JavaScript bytes', destinationJavaScript.gzipBytes, sourceJavaScript.gzipBytes, 1.05)
assertBudget('Total CSS bytes', destinationCss.bytes, sourceCss.bytes, 1.05)
assertBudget('Total gzipped CSS bytes', destinationCss.gzipBytes, sourceCss.gzipBytes, 1.10)

const largestJavaScript = report => Math.max(...report.largestFiles.filter(file => file.group === 'js').map(file => file.bytes))
if (largestJavaScript(react) >= largestJavaScript(vue)) {
  throw new Error('React does not improve the Vue largest-JavaScript-chunk budget')
}

console.log('Gate 7 production build safety and bundle budgets passed')
