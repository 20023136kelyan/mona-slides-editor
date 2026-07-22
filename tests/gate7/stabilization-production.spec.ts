import { expect, test, type BrowserContext, type Page } from '@playwright/test'

declare global {
  interface Window {
    __MONA_GATE7_DIAGNOSTICS__?: {
      clearLongTasks: () => void
      listenerSnapshot: () => Record<string, number>
      longTasks: () => Array<{ duration: number; startTime: number }>
    }
  }
}

async function installDiagnostics(context: BrowserContext) {
  await context.addInitScript(() => {
    const listenerIds = new WeakMap<object, number>()
    const active = new Set<string>()
    let nextListenerId = 0
    const originalAdd = EventTarget.prototype.addEventListener
    const originalRemove = EventTarget.prototype.removeEventListener
    const capture = (options?: boolean | AddEventListenerOptions) => typeof options === 'boolean' ? options : !!options?.capture
    const targetName = (target: EventTarget) => target === window ? 'window' : target === document ? 'document' : target === document.body ? 'body' : ''
    const listenerId = (listener: EventListenerOrEventListenerObject) => {
      const existing = listenerIds.get(listener)
      if (existing !== undefined) return existing
      const id = ++nextListenerId
      listenerIds.set(listener, id)
      return id
    }
    EventTarget.prototype.addEventListener = function(type, listener, options) {
      const target = targetName(this)
      if (target && listener) active.add(`${target}|${type}|${capture(options)}|${listenerId(listener)}`)
      return originalAdd.call(this, type, listener, options)
    }
    EventTarget.prototype.removeEventListener = function(type, listener, options) {
      const target = targetName(this)
      if (target && listener) active.delete(`${target}|${type}|${capture(options)}|${listenerId(listener)}`)
      return originalRemove.call(this, type, listener, options)
    }

    const longTasks: Array<{ duration: number; startTime: number }> = []
    try {
      new PerformanceObserver(entries => {
        for (const entry of entries.getEntries()) longTasks.push({ duration: entry.duration, startTime: entry.startTime })
      }).observe({ type: 'longtask', buffered: true })
    }
    catch { /* Firefox/WebKit do not expose long-task entries; this suite runs in Chromium. */ }

    Object.defineProperty(window, '__MONA_GATE7_DIAGNOSTICS__', {
      configurable: false,
      value: {
        clearLongTasks: () => { longTasks.length = 0 },
        listenerSnapshot: () => {
          const counts: Record<string, number> = {}
          for (const key of active) {
            const group = key.split('|').slice(0, 3).join('|')
            counts[group] = (counts[group] || 0) + 1
          }
          return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)))
        },
        longTasks: () => [...longTasks],
      },
    })
  })
}

async function openReact(page: Page) {
  await page.addInitScript(() => localStorage.setItem('mona:ui-locale', 'en-US'))
  await page.goto('http://127.0.0.1:4174/?rendererFixture=gate6-workflows')
  await expect(page.locator('.mona-editor-stage')).toBeVisible()
  await expect(page.locator('.mona-thumbnail-item')).toHaveCount(9)
  await page.evaluate(() => document.fonts.ready)
}

async function cycleTransientSurfaces(page: Page) {
  await page.getByRole('button', { name: 'Export' }).click()
  await expect(page.locator('.mona-export-dialog')).toBeVisible()
  await page.locator('.mona-export-close').click()
  await expect(page.locator('.mona-export-dialog')).toHaveCount(0)

  await page.getByRole('button', { name: 'Comments', exact: true }).click()
  await expect(page.locator('.mona-notes-panel')).toBeVisible()
  await page.locator('.mona-notes-panel .mona-moveable-panel-close').click()
  await expect(page.locator('.mona-notes-panel')).toHaveCount(0)

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.locator('.mona-header-settings-menu')).toBeVisible()
  await page.mouse.click(700, 500)
  await expect(page.locator('.mona-header-settings-menu')).toHaveCount(0)
}

const heapUsage = async (page: Page) => {
  await page.requestGC()
  await page.waitForTimeout(50)
  return page.evaluate(() => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0)
}

test('production listeners and retained heap stabilize across repeated mount cycles', async ({ browser }) => {
  test.setTimeout(120_000)
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  await installDiagnostics(context)
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await openReact(page)

  for (let index = 0; index < 3; index += 1) await cycleTransientSurfaces(page)
  const listenersBefore = await page.evaluate(() => window.__MONA_GATE7_DIAGNOSTICS__!.listenerSnapshot())
  const heapBefore = await heapUsage(page)

  for (let index = 0; index < 20; index += 1) await cycleTransientSurfaces(page)
  const listenersAfter = await page.evaluate(() => window.__MONA_GATE7_DIAGNOSTICS__!.listenerSnapshot())
  const heapAfter = await heapUsage(page)

  for (const [key, count] of Object.entries(listenersAfter)) expect(count, `listener group ${key}`).toBeLessThanOrEqual(listenersBefore[key] ?? 0)
  expect(heapAfter - heapBefore).toBeLessThanOrEqual(Math.max(1_500_000, heapBefore * 0.1))
  expect(errors).toEqual([])
  console.log(`[gate7:stability] listeners ${Object.values(listenersBefore).reduce((sum, count) => sum + count, 0)} -> ${Object.values(listenersAfter).reduce((sum, count) => sum + count, 0)}; heap ${heapBefore} -> ${heapAfter} bytes`)
  await context.close()
})

test('production navigation stays within a frame budget without long tasks or DOM replacement', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  await installDiagnostics(context)
  const page = await context.newPage()
  await openReact(page)
  const firstThumbnail = page.locator('.mona-thumbnail-item').first()
  await firstThumbnail.evaluate(element => element.setAttribute('data-gate7-stable-node', 'true'))
  await page.evaluate(() => window.__MONA_GATE7_DIAGNOSTICS__!.clearLongTasks())

  const frameTimes: number[] = []
  for (let index = 0; index < 45; index += 1) {
    await page.locator('.mona-thumbnail-item').nth(index % 3).click({ position: { x: 5, y: 5 } })
    frameTimes.push(await page.evaluate(() => new Promise<number>(resolve => {
      const started = performance.now()
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - started)))
    })))
  }
  frameTimes.sort((left, right) => left - right)
  const p95 = frameTimes[Math.floor((frameTimes.length - 1) * 0.95)]!
  const longTasks = await page.evaluate(() => window.__MONA_GATE7_DIAGNOSTICS__!.longTasks())
  expect(p95).toBeLessThanOrEqual(40)
  expect(longTasks).toEqual([])
  expect(await firstThumbnail.getAttribute('data-gate7-stable-node')).toBe('true')
  console.log(`[gate7:stability] navigation p95 ${p95.toFixed(2)}ms; long tasks ${longTasks.length}; thumbnail DOM identity preserved`)
  await context.close()
})
