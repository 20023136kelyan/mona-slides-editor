/* eslint-env node */
/* eslint-disable no-console */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { chromium } from '@playwright/test'

const projectRoot = resolve(import.meta.dirname, '..')
const referenceURL = process.env.MONA_REFERENCE_URL || 'http://127.0.0.1:5173/'
const sampleCount = Number(process.env.MONA_PERFORMANCE_SAMPLES || 5)
const serverMode = process.env.MONA_SERVER_MODE || 'development'
const runtimeLabel = process.env.MONA_RUNTIME_LABEL || 'vue-reference'
const readySelector = process.env.MONA_READY_SELECTOR

const median = values => {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

const browser = await chromium.launch({ headless: true })
const samples = []

try {
  for (let index = 0; index < sampleCount; index++) {
    const context = await browser.newContext({
      locale: 'en-US',
      timezoneId: 'UTC',
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      reducedMotion: 'reduce',
    })
    const page = await context.newPage()
    await page.addInitScript(() => localStorage.setItem('mona:ui-locale', 'en-US'))
    await page.goto(referenceURL, { waitUntil: 'load' })
    if (readySelector) {
      await page.locator(readySelector).waitFor({ state: 'visible' })
    }
    else {
      await page.locator('.pptist-editor').waitFor({ state: 'visible' })
      await page.locator('.thumbnail-item').nth(2).waitFor({ state: 'visible' })
      await page.locator('.page-number', { hasText: 'Slide 1 of 3' }).waitFor({ state: 'visible' })
    }
    await page.evaluate(() => document.fonts.ready)

    const metrics = await page.evaluate(() => {
      const navigation = performance.getEntriesByType('navigation')[0]
      const fcp = performance.getEntriesByName('first-contentful-paint')[0]
      const resources = performance.getEntriesByType('resource')
      const memory = performance.memory

      return {
        editorReadyMs: performance.now(),
        domContentLoadedMs: navigation?.domContentLoadedEventEnd || 0,
        loadMs: navigation?.loadEventEnd || 0,
        firstContentfulPaintMs: fcp?.startTime || 0,
        resourceCount: resources.length,
        transferBytes: resources.reduce((total, entry) => total + (entry.transferSize || 0), 0),
        decodedBodyBytes: resources.reduce((total, entry) => total + (entry.decodedBodySize || 0), 0),
        usedJSHeapBytes: memory?.usedJSHeapSize || null,
      }
    })

    samples.push(metrics)
    await context.close()
  }
}
finally {
  await browser.close()
}

const numericKeys = Object.keys(samples[0]).filter(key => samples.every(sample => typeof sample[key] === 'number'))
const medians = Object.fromEntries(numericKeys.map(key => [key, median(samples.map(sample => sample[key]))]))

const report = {
  schemaVersion: 1,
  runtime: runtimeLabel,
  serverMode,
  url: referenceURL,
  viewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
  sampleCount,
  medians,
  samples,
}

const outputIndex = process.argv.indexOf('--write')
if (outputIndex >= 0) {
  const outputArgument = process.argv[outputIndex + 1]
  if (!outputArgument) throw new Error('--write requires an output path')
  const outputPath = resolve(projectRoot, outputArgument)
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`Runtime baseline written to ${relative(projectRoot, outputPath)}`)
}
else {
  console.log(JSON.stringify(report, null, 2))
}
