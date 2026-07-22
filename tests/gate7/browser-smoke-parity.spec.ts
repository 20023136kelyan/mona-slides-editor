import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

import type { PresentationState } from '@mona/presentation-core'

interface VueBridgeState {
  editor: { activeElementIdList: string[]; handleElementId: string }
  history: { snapshotCursor: number; snapshotLength: number }
  presentation: PresentationState
}

interface ReactBridgeState {
  presentation: PresentationState
  session: { activeElementIds: string[]; handleElementId: string | null }
}

declare global {
  interface Window {
    __MONA_TEST__?: { getState: () => VueBridgeState; isReady: () => boolean }
    __MONA_REACT_TEST__?: {
      getHistoryState: () => { cursor: number; length: number }
      getState: () => ReactBridgeState
      isReady: () => boolean
    }
  }
}

const fixture = '/?rendererFixture=gate6-workflows'

async function openEditors(browser: Browser) {
  const sourceContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  const destinationContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  await Promise.all([sourceContext, destinationContext].map(context => context.addInitScript(() => localStorage.setItem('mona:ui-locale', 'en-US'))))
  const vue = await sourceContext.newPage()
  const react = await destinationContext.newPage()
  const errors: string[] = []
  vue.on('pageerror', error => errors.push(`vue: ${error.message}`))
  react.on('pageerror', error => errors.push(`react: ${error.message}`))
  await Promise.all([vue.goto(`http://127.0.0.1:5173${fixture}`), react.goto(`http://127.0.0.1:5174${fixture}`)])
  await Promise.all([
    vue.waitForFunction(() => window.__MONA_TEST__?.isReady() && window.__MONA_TEST__.getState().presentation.slides.some(slide => slide.id === 'gate6-beta-content')),
    react.waitForFunction(() => window.__MONA_REACT_TEST__?.isReady() && window.__MONA_REACT_TEST__.getState().presentation.slides.some(slide => slide.id === 'gate6-beta-content')),
  ])
  return { destinationContext, errors, react, sourceContext, vue }
}

async function compareRaster(source: Locator, destination: Locator) {
  const [sourceBuffer, destinationBuffer] = await Promise.all([
    source.screenshot({ animations: 'disabled' }),
    destination.screenshot({ animations: 'disabled' }),
  ])
  const expected = PNG.sync.read(sourceBuffer)
  const actual = PNG.sync.read(destinationBuffer)
  expect({ height: actual.height, width: actual.width }).toEqual({ height: expected.height, width: expected.width })
  const different = pixelmatch(expected.data, actual.data, null, expected.width, expected.height, { includeAA: false, threshold: 0.1 })
  expect(different / (expected.width * expected.height)).toBeLessThanOrEqual(0.035)
}

async function sourceState(page: Page) {
  return page.evaluate(() => window.__MONA_TEST__!.getState())
}

async function destinationState(page: Page) {
  return page.evaluate(() => window.__MONA_REACT_TEST__!.getState())
}

test('shared workflow deck renders and edits equivalently in this browser engine', async ({ browser }) => {
  const { destinationContext, errors, react, sourceContext, vue } = await openEditors(browser)
  try {
    const [sourceInitial, destinationInitial] = await Promise.all([sourceState(vue), destinationState(react)])
    expect(destinationInitial.presentation).toEqual(sourceInitial.presentation)
    expect(await react.evaluate(() => window.__MONA_REACT_TEST__!.getHistoryState())).toEqual({ cursor: sourceInitial.history.snapshotCursor, length: sourceInitial.history.snapshotLength })
    expect(errors, 'initial mount errors').toEqual([])

    await Promise.all([
      vue.locator('.thumbnail-item').nth(7).click({ position: { x: 5, y: 5 } }),
      react.locator('.mona-thumbnail-item').nth(7).click({ position: { x: 5, y: 5 } }),
    ])
    await Promise.all([
      vue.waitForFunction(() => window.__MONA_TEST__!.getState().presentation.slideIndex === 7),
      react.waitForFunction(() => window.__MONA_REACT_TEST__!.getState().presentation.slideIndex === 7),
    ])
    expect(errors, 'slide navigation errors').toEqual([])
    await Promise.all([
      vue.locator('#editable-element-gate6-beta-content-title .element-content').click(),
      react.locator('.mona-editor-slide-canvas [data-element-id="gate6-beta-content-title"] .mona-text-content').click(),
    ])
    expect(errors, 'element selection errors').toEqual([])
    const [sourceSelected, destinationSelected] = await Promise.all([sourceState(vue), destinationState(react)])
    expect(destinationSelected.presentation).toEqual(sourceSelected.presentation)
    expect(destinationSelected.session.activeElementIds).toEqual(sourceSelected.editor.activeElementIdList)
    expect(destinationSelected.session.handleElementId).toBe(sourceSelected.editor.handleElementId || null)
    await compareRaster(vue.locator('.canvas .viewport-wrapper'), react.locator('.mona-editor-viewport-frame'))
    expect(errors, 'raster capture errors').toEqual([])
  }
  finally {
    await Promise.all([sourceContext.close(), destinationContext.close()])
  }
})
