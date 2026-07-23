/* eslint-env node */
/* eslint-disable no-console */

import { chromium } from '@playwright/test'

const referenceURL = process.env.MONA_REFERENCE_URL || 'http://127.0.0.1:6173/'
const cycles = Number(process.env.MONA_MEMORY_CYCLES || 16)
const maxHeapGrowthBytes = Number(process.env.MONA_MAX_HEAP_GROWTH_BYTES || 8 * 1024 * 1024)
const maxNodeGrowth = Number(process.env.MONA_MAX_DOM_NODE_GROWTH || 250)

if (!Number.isInteger(cycles) || cycles < 2) throw new Error('MONA_MEMORY_CYCLES must be an integer of at least 2')

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  locale: 'en-US',
  reducedMotion: 'reduce',
  timezoneId: 'UTC',
  viewport: { width: 1440, height: 900 },
})
const page = await context.newPage()
const cdp = await context.newCDPSession(page)

const collect = async () => {
  await cdp.send('HeapProfiler.collectGarbage')
  await page.waitForTimeout(50)
  const [heap, dom] = await Promise.all([
    cdp.send('Runtime.getHeapUsage'),
    cdp.send('Memory.getDOMCounters'),
  ])
  return {
    documents: dom.documents,
    jsHeapBytes: heap.usedSize,
    nodes: dom.nodes,
  }
}

try {
  await page.addInitScript(() => localStorage.setItem('mona:ui-locale', 'en-US'))
  await page.goto(referenceURL, { waitUntil: 'load' })
  await page.getByRole('application', { name: 'Editable slide canvas' }).waitFor()
  const ai = page.getByRole('button', { name: 'Generate presentation with AI' })

  // Warm the lazy dock once so retained module code is not counted as a leak.
  await ai.click()
  await page.getByRole('textbox', { name: 'Message Mona AI' }).waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('complementary', { name: 'Mona AI' }).waitFor({ state: 'detached' })
  const before = await collect()

  for (let cycle = 0; cycle < cycles; cycle += 1) {
    await ai.click()
    await page.getByRole('textbox', { name: 'Message Mona AI' }).waitFor()
    await page.keyboard.press('Escape')
    await page.getByRole('complementary', { name: 'Mona AI' }).waitFor({ state: 'detached' })
  }
  const after = await collect()
  const report = {
    after,
    before,
    cycles,
    growth: {
      documents: after.documents - before.documents,
      jsHeapBytes: after.jsHeapBytes - before.jsHeapBytes,
      nodes: after.nodes - before.nodes,
    },
    limits: {
      jsHeapBytes: maxHeapGrowthBytes,
      nodes: maxNodeGrowth,
    },
    url: referenceURL,
  }
  console.log(JSON.stringify(report, null, 2))
  if (report.growth.jsHeapBytes > maxHeapGrowthBytes) {
    throw new Error(`Retained JS heap grew by ${report.growth.jsHeapBytes} bytes`)
  }
  if (report.growth.nodes > maxNodeGrowth) {
    throw new Error(`Retained DOM nodes grew by ${report.growth.nodes}`)
  }
}
finally {
  await context.close()
  await browser.close()
}
