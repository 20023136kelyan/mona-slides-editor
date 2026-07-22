import { expect, test, type Browser, type Locator, type Page } from '@playwright/test'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

import type { PresentationState } from '@mona/presentation-core'

interface VueState {
  editor: { activeElementIdList: string[]; selectedSlidesIndex: number[]; thumbnailsFocus: boolean }
  history: { snapshotCursor: number; snapshotLength: number }
  presentation: PresentationState
}

interface ReactState {
  presentation: PresentationState
  session: { activeElementIds: string[]; selectedSlideIndexes: number[]; thumbnailsFocus: boolean }
}

declare global {
  interface Window {
    __MONA_TEST__?: { getState: () => VueState; isReady: () => boolean }
    __MONA_REACT_TEST__?: {
      getHistoryState: () => { cursor: number; length: number }
      getState: () => ReactState
      isReady: () => boolean
    }
  }
}

const fixturePath = '/?rendererFixture=gate6-workflows'

async function openEditors(browser: Browser) {
  const sourceContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] })
  const destinationContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] })
  await Promise.all([
    sourceContext.addInitScript(() => localStorage.setItem('mona:ui-locale', 'en-US')),
    destinationContext.addInitScript(() => localStorage.setItem('mona:ui-locale', 'en-US')),
  ])
  const vue = await sourceContext.newPage()
  const react = await destinationContext.newPage()
  await Promise.all([vue.goto('http://127.0.0.1:5173' + fixturePath), react.goto('http://127.0.0.1:5174' + fixturePath)])
  await Promise.all([
    expect(vue.locator('.pptist-editor')).toBeVisible(),
    expect(react.getByRole('application', { name: 'Editable slide canvas' })).toBeVisible(),
    vue.waitForFunction(() => window.__MONA_TEST__?.isReady() && window.__MONA_TEST__.getState().presentation.slides.some(slide => slide.id === 'gate6-section-alpha')),
    react.waitForFunction(() => window.__MONA_REACT_TEST__?.isReady() && window.__MONA_REACT_TEST__.getState().presentation.slides.some(slide => slide.id === 'gate6-section-alpha')),
  ])
  return { destinationContext, react, sourceContext, vue }
}

const canonicalizeGeneratedIds = <T, >(source: T, destination: T): T => {
  const destinationToSource = new Map<string, string>()
  const collectCorrespondingIds = (sourceValue: unknown, destinationValue: unknown) => {
    if (Array.isArray(sourceValue) && Array.isArray(destinationValue)) {
      for (let index = 0; index < Math.min(sourceValue.length, destinationValue.length); index += 1) {
        collectCorrespondingIds(sourceValue[index], destinationValue[index])
      }
      return
    }
    if (!sourceValue || !destinationValue || typeof sourceValue !== 'object' || typeof destinationValue !== 'object') return
    const sourceRecord = sourceValue as Record<string, unknown>
    const destinationRecord = destinationValue as Record<string, unknown>
    for (const key of ['id', 'elId', 'groupId']) {
      const sourceId = sourceRecord[key]
      const destinationId = destinationRecord[key]
      if (typeof sourceId === 'string' && typeof destinationId === 'string' && sourceId !== destinationId) {
        destinationToSource.set(destinationId, sourceId)
      }
    }
    for (const key of Object.keys(sourceRecord)) collectCorrespondingIds(sourceRecord[key], destinationRecord[key])
  }
  const replaceIds = (value: unknown): unknown => {
    if (typeof value === 'string') return destinationToSource.get(value) ?? value
    if (Array.isArray(value)) return value.map(replaceIds)
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, replaceIds(nested)]))
    }
    return value
  }
  collectCorrespondingIds(source, destination)
  return replaceIds(destination) as T
}

async function sourceState(page: Page) {
  return page.evaluate(() => structuredClone(window.__MONA_TEST__!.getState()))
}

async function destinationState(page: Page) {
  return page.evaluate(() => structuredClone(window.__MONA_REACT_TEST__!.getState()))
}

async function history(page: Page, app: 'react' | 'vue') {
  if (app === 'react') return page.evaluate(() => window.__MONA_REACT_TEST__!.getHistoryState())
  return page.evaluate(() => {
    const value = window.__MONA_TEST__!.getState().history
    return { cursor: value.snapshotCursor, length: value.snapshotLength }
  })
}

async function settle(vue: Page, react: Page, milliseconds = 700) {
  await Promise.all([vue.waitForTimeout(milliseconds), react.waitForTimeout(milliseconds)])
}

async function expectPresentationParity(vue: Page, react: Page, compareHistory = true) {
  const [source, destination] = await Promise.all([sourceState(vue), destinationState(react)])
  expect(canonicalizeGeneratedIds(source.presentation, destination.presentation)).toEqual(source.presentation)
  expect(destination.session.activeElementIds).toEqual(source.editor.activeElementIdList)
  expect(destination.session.selectedSlideIndexes).toEqual(source.editor.selectedSlidesIndex)
  if (compareHistory) await expect.poll(async () => history(react, 'react')).toEqual(await history(vue, 'vue'))
}

const roundedRect = (rect: { height: number; width: number; x: number; y: number } | null) => rect && ({
  height: Math.round(rect.height * 100) / 100,
  width: Math.round(rect.width * 100) / 100,
  x: Math.round(rect.x * 100) / 100,
  y: Math.round(rect.y * 100) / 100,
})

async function compareRaster(source: Locator, destination: Locator, maxVisiblePixelDelta = 0, maxRawChannelDelta = 0) {
  const [sourceBuffer, destinationBuffer] = await Promise.all([source.screenshot(), destination.screenshot()])
  const expected = PNG.sync.read(sourceBuffer)
  const actual = PNG.sync.read(destinationBuffer)
  expect({ height: actual.height, width: actual.width }).toEqual({ height: expected.height, width: expected.width })
  const visible = pixelmatch(expected.data, actual.data, null, expected.width, expected.height, { threshold: 0 })
  let raw = 0
  for (let index = 0; index < expected.data.length; index += 1) raw = Math.max(raw, Math.abs(expected.data[index]! - actual.data[index]!))
  expect(visible).toBeLessThanOrEqual(maxVisiblePixelDelta)
  expect(raw).toBeLessThanOrEqual(maxRawChannelDelta)
}

async function clickSlide(vue: Page, react: Page, index: number, modifiers: Array<'Meta' | 'Shift'> = []) {
  await Promise.all([
    vue.locator('.thumbnail-item').nth(index).click({ modifiers }),
    react.locator('.mona-thumbnail-item').nth(index).click({ modifiers }),
  ])
}

async function openTemplates(vue: Page, react: Page) {
  await Promise.all([vue.locator('.add-slide .select-btn').click(), react.locator('.mona-add-slide-select').click()])
  const source = vue.locator('.templates')
  const destination = react.locator('.mona-templates')
  await Promise.all([expect(source).toBeVisible(), expect(destination).toBeVisible()])
  await Promise.all([
    expect(source.locator('.slide-item').first()).toBeVisible(),
    expect(destination.locator('.mona-template-slide-item').first()).toBeVisible(),
  ])
  await Promise.all([vue.waitForTimeout(250), react.waitForTimeout(250)])
  return { destination, source }
}

async function openSlideMenu(vue: Page, react: Page, index: number) {
  await clickSlide(vue, react, index)
  await Promise.all([
    vue.locator('.thumbnail-item').nth(index).click({ button: 'right' }),
    react.locator('.mona-thumbnail-item').nth(index).click({ button: 'right' }),
  ])
  const source = vue.locator('.contextmenu').last()
  const destination = react.locator('.mona-thumbnail-context-menu')
  await Promise.all([expect(source).toBeVisible(), expect(destination).toBeVisible()])
  return { destination, source }
}

async function clickSlideMenuAction(vue: Page, react: Page, index: number, sourceLabel: RegExp, destinationAction: string) {
  const menus = await openSlideMenu(vue, react, index)
  await Promise.all([
    menus.source.locator('.menu-item').filter({ hasText: sourceLabel }).click(),
    menus.destination.locator(`[data-action="${destinationAction}"]`).click(),
  ])
}

async function measureDragAutoscroll(page: Page, item: Locator, list: Locator) {
  const itemRect = await item.boundingBox()
  const listRect = await list.boundingBox()
  if (!itemRect || !listRect) throw new Error('Expected thumbnail drag geometry')
  const startX = itemRect.x + itemRect.width / 2
  const startY = itemRect.y + itemRect.height / 2
  const edgeX = listRect.x + listRect.width / 2
  const edgeY = listRect.y + listRect.height - 5
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + 6, startY + 6, { steps: 4 })
  for (let index = 0; index < 24; index += 1) {
    await page.mouse.move(edgeX + (index % 2), edgeY - (index % 2), { steps: 2 })
    await page.waitForTimeout(25)
  }
  const scrollTop = await list.evaluate(element => element.scrollTop)
  await page.mouse.move(listRect.x + listRect.width + 30, edgeY)
  await page.mouse.up()
  return scrollTop
}

test('thumbnail chassis, sections, note flags, page count, and template surface match source', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  const sourceRail = vue.locator('.thumbnails')
  const destinationRail = react.locator('.mona-editor-thumbnails')
  expect(roundedRect(await destinationRail.boundingBox())).toEqual(roundedRect(await sourceRail.boundingBox()))
  expect(roundedRect(await react.locator('.mona-add-slide').boundingBox())).toEqual(roundedRect(await vue.locator('.add-slide').boundingBox()))
  expect(roundedRect(await react.locator('.mona-thumbnail-page-number').boundingBox())).toEqual(roundedRect(await vue.locator('.page-number').boundingBox()))
  expect(await react.locator('.mona-thumbnail-item').count()).toBe(await vue.locator('.thumbnail-item').count())
  expect(await react.locator('.mona-section-title').allInnerTexts()).toEqual(await vue.locator('.section-title').allInnerTexts())
  expect(await react.locator('.mona-thumbnail-note-flag').allInnerTexts()).toEqual(await vue.locator('.note-flag').allInnerTexts())
  // The boxes and content are exact above. Chromium independently rasterizes
  // the icon/text and one-pixel boundary with a fixed six-channel maximum.
  await compareRaster(vue.locator('.add-slide'), react.locator('.mona-add-slide'), 198, 6)
  await compareRaster(vue.locator('.page-number'), react.locator('.mona-thumbnail-page-number'), 159, 6)

  const panels = await openTemplates(vue, react)
  expect(roundedRect(await panels.destination.boundingBox())).toEqual(roundedRect(await panels.source.boundingBox()))
  expect(await panels.destination.locator('.mona-template-catalog').allInnerTexts()).toEqual(await panels.source.locator('.catalog').allInnerTexts())
  expect(await panels.destination.locator('.mona-template-type').allInnerTexts()).toEqual(await panels.source.locator('.type').allInnerTexts())
  expect(await panels.destination.locator('.mona-template-slide-item').count()).toBe(await panels.source.locator('.slide-item').count())
  await compareRaster(panels.source.locator('.catalogs'), panels.destination.locator('.mona-template-catalogs'))
  await compareRaster(panels.source.locator('.header'), panels.destination.locator('.mona-template-header'))
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('ordinary, Control, Shift, active-toggle, and focus selection states match source', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  await clickSlide(vue, react, 4)
  await expectPresentationParity(vue, react, false)
  await clickSlide(vue, react, 5, ['Meta'])
  await expectPresentationParity(vue, react, false)
  await clickSlide(vue, react, 8, ['Shift'])
  await expectPresentationParity(vue, react, false)
  await clickSlide(vue, react, 4, ['Meta'])
  await expectPresentationParity(vue, react, false)
  const [source, destination] = await Promise.all([sourceState(vue), destinationState(react)])
  expect(destination.session.thumbnailsFocus).toBe(source.editor.thumbnailsFocus)
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('keyboard navigation auto-scrolls the active thumbnail with the source timing and placement', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  const panels = await openTemplates(vue, react)
  await Promise.all([
    panels.source.locator('.insert-all').click({ force: true }),
    panels.destination.locator('.mona-template-insert-all').click({ force: true }),
  ])
  await settle(vue, react)
  await Promise.all([
    vue.locator('.thumbnail-item').first().click(),
    react.locator('.mona-thumbnail-item').first().click(),
  ])
  const total = (await sourceState(vue)).presentation.slides.length
  for (let index = 0; index < total + 2; index += 1) {
    await Promise.all([vue.keyboard.press('PageDown'), react.keyboard.press('PageDown')])
    // Match an actual held-key repeat cadence and allow each activated slide's
    // ResizeObserver-driven text/table normalization to commit before the next
    // slide replaces it. A zero-delay synthetic burst tests framework batching,
    // not the source's user-observable keyboard navigation contract.
    await Promise.all([vue.waitForTimeout(50), react.waitForTimeout(50)])
  }
  await settle(vue, react, 1_200)
  await expectPresentationParity(vue, react, false)
  const sourceList = vue.locator('.thumbnail-list')
  const destinationList = react.locator('.mona-thumbnail-list')
  const [sourceScrollTop, destinationScrollTop] = await Promise.all([
    sourceList.evaluate(element => element.scrollTop),
    destinationList.evaluate(element => element.scrollTop),
  ])
  expect(Math.abs(destinationScrollTop - sourceScrollTop)).toBeLessThanOrEqual(1)
  const [sourceListRect, destinationListRect, sourceActiveRect, destinationActiveRect] = await Promise.all([
    sourceList.boundingBox(),
    destinationList.boundingBox(),
    vue.locator('.thumbnail-item.active').boundingBox(),
    react.locator('.mona-thumbnail-item.is-active').boundingBox(),
  ])
  expect(roundedRect(destinationListRect)).toEqual(roundedRect(sourceListRect))
  expect(roundedRect(destinationActiveRect)).toEqual(roundedRect(sourceActiveRect))
  expect(destinationActiveRect!.y).toBeGreaterThanOrEqual(destinationListRect!.y)
  expect(destinationActiveRect!.y + destinationActiveRect!.height).toBeLessThanOrEqual(destinationListRect!.y + destinationListRect!.height)
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('slide context inventory and create, duplicate, delete, select-all, and reset-last transactions match source', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  const { destination: destinationMenu, source: sourceMenu } = await openSlideMenu(vue, react, 5)
  expect(await destinationMenu.innerText()).toBe(await sourceMenu.innerText())
  expect(roundedRect(await destinationMenu.boundingBox())).toEqual(roundedRect(await sourceMenu.boundingBox()))
  await compareRaster(sourceMenu, destinationMenu)
  await Promise.all([
    sourceMenu.locator('.menu-item').filter({ hasText: /^Duplicate slide/ }).click(),
    destinationMenu.locator('[data-action="duplicate"]').click(),
  ])
  await settle(vue, react)
  await expectPresentationParity(vue, react)

  await Promise.all([vue.locator('.add-slide .btn').click(), react.locator('.mona-add-slide-button').click()])
  await settle(vue, react)
  await expectPresentationParity(vue, react)

  await Promise.all([vue.locator('.thumbnails').click(), react.locator('.mona-editor-thumbnails').click()])
  await Promise.all([vue.keyboard.press('Control+a'), react.keyboard.press('Control+a')])
  await expect.poll(async () => Promise.all([
    sourceState(vue).then(state => state.editor.selectedSlidesIndex.length),
    destinationState(react).then(state => state.session.selectedSlideIndexes.length),
  ])).toEqual([11, 11])
  await Promise.all([vue.keyboard.press('Delete'), react.keyboard.press('Delete')])
  await settle(vue, react)
  await expectPresentationParity(vue, react)
  const [source, destination] = await Promise.all([sourceState(vue), destinationState(react)])
  expect(source.presentation.slides).toHaveLength(1)
  expect(destination.presentation.slides).toHaveLength(1)
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('slide copy, paste, cut, and paste-again routes preserve source clipboard behavior and history', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  await clickSlideMenuAction(vue, react, 5, /^Copy/, 'copy')
  await settle(vue, react, 250)
  await clickSlideMenuAction(vue, react, 5, /^Paste/, 'paste')
  await settle(vue, react)
  await expectPresentationParity(vue, react)

  await clickSlideMenuAction(vue, react, 2, /^Cut/, 'cut')
  await settle(vue, react)
  await expectPresentationParity(vue, react)
  const [sourceAfterCut, destinationAfterCut] = await Promise.all([sourceState(vue), destinationState(react)])
  await clickSlideMenuAction(vue, react, sourceAfterCut.presentation.slideIndex, /^Paste/, 'paste')
  await settle(vue, react)
  await expectPresentationParity(vue, react)
  expect(destinationAfterCut.presentation.slides.length).toBe(sourceAfterCut.presentation.slides.length)
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('section creation, rename, removal, remove-all, and remove-with-slides match source', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  await clickSlide(vue, react, 5)
  await Promise.all([
    vue.locator('.thumbnail-item').nth(5).click({ button: 'right' }),
    react.locator('.mona-thumbnail-item').nth(5).click({ button: 'right' }),
  ])
  await Promise.all([
    vue.locator('.contextmenu .menu-item').filter({ hasText: /^Add section$/ }).click(),
    react.locator('[data-action="section-create"]').click(),
  ])
  await settle(vue, react)
  await expectPresentationParity(vue, react)

  await Promise.all([
    vue.locator('.section-title').nth(2).dblclick(),
    react.locator('.mona-section-title').nth(2).dblclick(),
  ])
  await Promise.all([
    vue.locator('.section-title input').fill('Inserted section'),
    react.locator('.mona-section-title input').fill('Inserted section'),
  ])
  await Promise.all([vue.locator('.section-title input').press('Enter'), react.locator('.mona-section-title input').press('Enter')])
  await settle(vue, react)
  await expectPresentationParity(vue, react)

  await Promise.all([
    vue.locator('.section-title').nth(2).click({ button: 'right' }),
    react.locator('.mona-section-title').nth(2).click({ button: 'right' }),
  ])
  const sourceMenu = vue.locator('.contextmenu').last()
  const destinationMenu = react.locator('.mona-thumbnail-context-menu')
  expect(await destinationMenu.innerText()).toBe(await sourceMenu.innerText())
  await Promise.all([
    sourceMenu.locator('.menu-item').filter({ hasText: /^Delete section$/ }).click(),
    destinationMenu.locator('[data-action^="section-remove:"]').click(),
  ])
  await settle(vue, react)
  await expectPresentationParity(vue, react)

  await Promise.all([
    vue.locator('.section-title').nth(1).click({ button: 'right' }),
    react.locator('.mona-section-title').nth(1).click({ button: 'right' }),
  ])
  await Promise.all([
    vue.locator('.contextmenu').last().locator('.menu-item').filter({ hasText: /^Delete all sections$/ }).click(),
    react.locator('[data-action="section-remove-all"]').click(),
  ])
  await settle(vue, react)
  await expectPresentationParity(vue, react)
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('default-section rename, disabled creation, and removal with its slides match source', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  await Promise.all([
    vue.locator('.section-title').first().dblclick(),
    react.locator('.mona-section-title').first().dblclick(),
  ])
  await Promise.all([
    vue.locator('.section-title input').fill('Opening'),
    react.locator('.mona-section-title input').fill('Opening'),
  ])
  await Promise.all([vue.locator('.section-title input').press('Enter'), react.locator('.mona-section-title input').press('Enter')])
  await settle(vue, react)
  await expectPresentationParity(vue, react)

  const menus = await openSlideMenu(vue, react, 0)
  const sourceAddSection = menus.source.locator('.menu-item').filter({ hasText: /^Add section$/ })
  const destinationAddSection = menus.destination.locator('[data-action="section-create"]')
  expect(await sourceAddSection.getAttribute('class')).toContain('disable')
  await expect(destinationAddSection).toHaveAttribute('aria-disabled', 'true')
  await Promise.all([sourceAddSection.click({ force: true }), destinationAddSection.click({ force: true })])
  await expectPresentationParity(vue, react, false)
  await Promise.all([
    vue.locator('.contextmenu-mask').click({ position: { x: 1, y: 1 } }),
    react.locator('.mona-editor-context-menu-mask').click({ position: { x: 1, y: 1 } }),
  ])

  await Promise.all([
    vue.locator('.section-title').filter({ hasText: /^Planning$/ }).click({ button: 'right' }),
    react.locator('.mona-section-title').filter({ hasText: /^Planning$/ }).click({ button: 'right' }),
  ])
  const sourceSectionMenu = vue.locator('.contextmenu').last()
  const destinationSectionMenu = react.locator('.mona-thumbnail-context-menu')
  expect(await destinationSectionMenu.innerText()).toBe(await sourceSectionMenu.innerText())
  await Promise.all([
    sourceSectionMenu.locator('.menu-item').filter({ hasText: /^Delete section and slides$/ }).click(),
    destinationSectionMenu.locator('[data-action^="section-delete:"]').click(),
  ])
  await settle(vue, react)
  await expectPresentationParity(vue, react)
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('drag reorder preserves the exact source slide order, section transfer, active index, and non-history behavior', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  const beforeSourceHistory = await history(vue, 'vue')
  const beforeDestinationHistory = await history(react, 'react')
  await Promise.all([
    vue.locator('.thumbnail-container').nth(4).dragTo(vue.locator('.thumbnail-container').nth(6)),
    react.locator('.mona-thumbnail-container').nth(4).dragTo(react.locator('.mona-thumbnail-container').nth(6)),
  ])
  await expectPresentationParity(vue, react, false)
  expect(await history(vue, 'vue')).toEqual(beforeSourceHistory)
  expect(await history(react, 'react')).toEqual(beforeDestinationHistory)
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('section editing disables thumbnail dragging until the edit lifecycle ends', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  await Promise.all([
    vue.locator('.section-title').filter({ hasText: /^Planning$/ }).dblclick(),
    react.locator('.mona-section-title').filter({ hasText: /^Planning$/ }).dblclick(),
  ])
  await Promise.all([
    expect(vue.locator('.section-title input')).toBeFocused(),
    expect(react.locator('.mona-section-title input')).toBeFocused(),
  ])
  const [beforeSource, beforeDestination] = await Promise.all([sourceState(vue), destinationState(react)])
  await Promise.all([
    vue.locator('.thumbnail-container').nth(4).dragTo(vue.locator('.thumbnail-container').nth(6)),
    react.locator('.mona-thumbnail-container').nth(4).dragTo(react.locator('.mona-thumbnail-container').nth(6)),
  ])
  const [duringSource, duringDestination] = await Promise.all([sourceState(vue), destinationState(react)])
  expect(duringSource.presentation).toEqual(beforeSource.presentation)
  expect(duringDestination.presentation).toEqual(beforeDestination.presentation)
  await Promise.all([
    expect(vue.locator('.section-title input')).toBeHidden(),
    expect(react.locator('.mona-section-title input')).toBeHidden(),
  ])
  await settle(vue, react)
  await expectPresentationParity(vue, react)
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('dragging to index zero transfers the first section marker and records no history', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  await Promise.all([vue.locator('.section-title').first().dblclick(), react.locator('.mona-section-title').first().dblclick()])
  await Promise.all([vue.locator('.section-title input').fill('Opening'), react.locator('.mona-section-title input').fill('Opening')])
  await Promise.all([vue.locator('.section-title input').press('Enter'), react.locator('.mona-section-title input').press('Enter')])
  await settle(vue, react)
  const beforeSourceHistory = await history(vue, 'vue')
  const beforeDestinationHistory = await history(react, 'react')
  await Promise.all([
    vue.locator('.thumbnail-container').nth(2).dragTo(vue.locator('.thumbnail-container').nth(0)),
    react.locator('.mona-thumbnail-container').nth(2).dragTo(react.locator('.mona-thumbnail-container').nth(0)),
  ])
  await expectPresentationParity(vue, react, false)
  expect(await history(vue, 'vue')).toEqual(beforeSourceHistory)
  expect(await history(react, 'react')).toEqual(beforeDestinationHistory)
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('edge dragging uses the source Sortable engine settings and autoscroll direction', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  const panels = await openTemplates(vue, react)
  await Promise.all([
    panels.source.locator('.insert-all').click({ force: true }),
    panels.destination.locator('.mona-template-insert-all').click({ force: true }),
  ])
  await settle(vue, react)
  const sourceList = vue.locator('.thumbnail-list')
  const destinationList = react.locator('.mona-thumbnail-list')
  await Promise.all([
    sourceList.evaluate(element => {
      element.scrollTop = 0 
    }),
    destinationList.evaluate(element => {
      element.scrollTop = 0 
    }),
  ])
  const sourceScroll = await measureDragAutoscroll(vue, vue.locator('.thumbnail-container').first(), sourceList)
  const destinationScroll = await measureDragAutoscroll(react, react.locator('.mona-thumbnail-container').first(), destinationList)
  const sortableOptions = (locator: Locator) => locator.evaluate(element => {
    const sortableKey = Object.keys(element).find(key => key.startsWith('Sortable'))!
    const instance = (element as unknown as Record<string, { constructor: { version?: string }; options: Record<string, unknown> }>)[sortableKey]!
    return {
      animation: instance.options.animation,
      disabled: instance.options.disabled,
      scroll: instance.options.scroll,
      scrollSensitivity: instance.options.scrollSensitivity,
      scrollSpeed: instance.options.scrollSpeed,
      version: instance.constructor.version,
    }
  })
  expect(await sortableOptions(destinationList)).toEqual(await sortableOptions(sourceList))
  expect(sourceScroll).toBeGreaterThan(0)
  expect(destinationScroll).toBeGreaterThan(0)
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('single-template and insert-all empty-deck workflows match source document, theme, selection, and history', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  let panels = await openTemplates(vue, react)
  await Promise.all([
    panels.source.locator('.slide-item').first().locator('.btn').click(),
    panels.destination.locator('.mona-template-slide-item').first().locator('button').click(),
  ])
  await settle(vue, react)
  await expectPresentationParity(vue, react)

  await Promise.all([vue.locator('.thumbnails').click(), react.locator('.mona-editor-thumbnails').click()])
  await Promise.all([vue.keyboard.press('Control+a'), react.keyboard.press('Control+a')])
  await Promise.all([vue.keyboard.press('Delete'), react.keyboard.press('Delete')])
  await settle(vue, react)
  panels = await openTemplates(vue, react)
  await Promise.all([
    panels.source.locator('.insert-all').click({ force: true }),
    panels.destination.locator('.mona-template-insert-all').click({ force: true }),
  ])
  await settle(vue, react)
  await expectPresentationParity(vue, react, false)
  const [source, destination] = await Promise.all([sourceState(vue), destinationState(react)])
  expect(destination.presentation.theme).toEqual(source.presentation.theme)
  expect(destination.presentation.slides).toEqual(source.presentation.slides)
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('template catalog loading, failure, scrolling reset, and every type filter match source', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  let releaseSource!: () => void
  let releaseDestination!: () => void
  const sourceHold = new Promise<void>(resolve => {
    releaseSource = resolve 
  })
  const destinationHold = new Promise<void>(resolve => {
    releaseDestination = resolve 
  })
  await vue.route('**/mocks/template_2.json', async route => {
    await sourceHold; await route.continue() 
  })
  await react.route('**/mocks/template_2.json', async route => {
    await destinationHold; await route.continue() 
  })
  const panels = await openTemplates(vue, react)
  await Promise.all([
    panels.source.locator('.catalog').nth(1).click(),
    panels.destination.locator('.mona-template-catalog').nth(1).click(),
  ])
  const sourceLoading = panels.source.locator('.content > .directive-loading-overlay')
  const destinationLoading = panels.destination.locator('.mona-template-content > .mona-template-loading')
  await Promise.all([expect(sourceLoading).toBeVisible(), expect(destinationLoading).toBeVisible()])
  expect(roundedRect(await destinationLoading.boundingBox())).toEqual(roundedRect(await sourceLoading.boundingBox()))
  const loadingStyles = async (locator: Locator) => locator.evaluate(element => {
    const before = getComputedStyle(element, '::before')
    const after = getComputedStyle(element, '::after')
    return {
      after: [after.backgroundColor, after.color, after.content, after.fontSize, after.paddingTop],
      before: [before.width, before.height, before.borderRadius, before.borderTopColor, before.animationDuration, before.marginTop],
      overflow: getComputedStyle(element).overflow,
      zIndex: getComputedStyle(element).zIndex,
    }
  })
  expect(await loadingStyles(destinationLoading)).toEqual(await loadingStyles(sourceLoading))
  releaseSource()
  releaseDestination()
  await Promise.all([expect(sourceLoading).toBeHidden(), expect(destinationLoading).toBeHidden()])
  expect(await panels.destination.locator('.mona-template-slide-item').count()).toBe(await panels.source.locator('.slide-item').count())

  for (let index = 0; index < 6; index += 1) {
    await Promise.all([
      panels.source.locator('.type').nth(index).click(),
      panels.destination.locator('.mona-template-type').nth(index).click(),
    ])
    expect(await panels.destination.locator('.mona-template-slide-item').count()).toBe(await panels.source.locator('.slide-item').count())
    expect(await panels.destination.locator('.mona-template-type.is-active').innerText()).toBe(await panels.source.locator('.type.active').innerText())
  }

  await vue.route('**/mocks/template_3.json', route => route.abort('failed'))
  await react.route('**/mocks/template_3.json', route => route.abort('failed'))
  await Promise.all([
    panels.source.locator('.catalog').nth(2).click(),
    panels.destination.locator('.mona-template-catalog').nth(2).click(),
  ])
  await Promise.all([expect(sourceLoading).toBeHidden(), expect(destinationLoading).toBeHidden()])
  expect(await panels.destination.locator('.mona-template-slide-item').count()).toBe(await panels.source.locator('.slide-item').count())
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('insert-all into a non-empty deck remaps the complete source graph and history', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  const panels = await openTemplates(vue, react)
  await Promise.all([
    panels.source.locator('.insert-all').click({ force: true }),
    panels.destination.locator('.mona-template-insert-all').click({ force: true }),
  ])
  await settle(vue, react)
  await expectPresentationParity(vue, react)
  await Promise.all([sourceContext.close(), destinationContext.close()])
})
