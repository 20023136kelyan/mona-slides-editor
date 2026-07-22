import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

const fixturePath = '/?rendererFixture=gate6-slideshow'

test.describe.configure({ timeout: 90_000 })

async function installDeterministicBrowser(context: BrowserContext) {
  await context.addInitScript(() => {
    localStorage.setItem('mona:ui-locale', 'en-US')
    Math.random = () => 0.45

    const state = { element: null as Element | null }
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => state.element,
    })
    HTMLElement.prototype.requestFullscreen = function requestFullscreen() {
      state.element = this
      document.dispatchEvent(new Event('fullscreenchange'))
      return Promise.resolve()
    }
    document.exitFullscreen = () => {
      state.element = null
      document.dispatchEvent(new Event('fullscreenchange'))
      return Promise.resolve()
    }
  })
}

async function openEditors(browser: Browser) {
  const sourceContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const destinationContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await Promise.all([installDeterministicBrowser(sourceContext), installDeterministicBrowser(destinationContext)])
  const vue = await sourceContext.newPage()
  const react = await destinationContext.newPage()
  await Promise.all([
    vue.goto(`http://127.0.0.1:5173${fixturePath}`),
    react.goto(`http://127.0.0.1:5174${fixturePath}`),
  ])
  await Promise.all([
    expect(vue.locator('.pptist-editor')).toBeVisible(),
    expect(react.getByRole('application', { name: 'Editable slide canvas' })).toBeVisible(),
    vue.waitForFunction(() => window.__MONA_TEST__?.isReady()),
    react.waitForFunction(() => window.__MONA_REACT_TEST__?.isReady()),
  ])
  return { destinationContext, react, sourceContext, vue }
}

async function closeEditors(sourceContext: BrowserContext, destinationContext: BrowserContext) {
  await Promise.all([sourceContext.close(), destinationContext.close()])
}

async function selectEditorSlide(vue: Page, react: Page, index: number) {
  await Promise.all([
    vue.locator('.thumbnail-item').nth(index).click(),
    react.locator('.mona-thumbnail-item').nth(index).click(),
  ])
  await Promise.all([
    vue.waitForFunction(expected => window.__MONA_TEST__?.getState().presentation.slideIndex === expected, index),
    react.waitForFunction(expected => window.__MONA_REACT_TEST__?.getState().presentation.slideIndex === expected, index),
  ])
}

async function startSlideshow(vue: Page, react: Page) {
  await Promise.all([
    vue.locator('.editor-header .group-menu-item > .menu-item').click(),
    react.locator('.mona-header-screen-main').click(),
  ])
  await Promise.all([
    expect(vue.locator('.pptist-screen')).toBeVisible(),
    expect(react.locator('.mona-pptist-screen')).toBeVisible(),
  ])
  await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
}

const roundedRect = (rect: { height: number; width: number; x: number; y: number } | null) => rect && ({
  height: Math.round(rect.height * 100) / 100,
  width: Math.round(rect.width * 100) / 100,
  x: Math.round(rect.x * 100) / 100,
  y: Math.round(rect.y * 100) / 100,
})

async function compareRaster(source: Locator, destination: Locator, maxVisiblePixelDelta = 0, maxRawChannelDelta = 0, style?: string) {
  await Promise.all([
    source.page().evaluate(() => document.fonts.ready),
    destination.page().evaluate(() => document.fonts.ready),
  ])
  let best = { raw: Number.POSITIVE_INFINITY, visible: Number.POSITIVE_INFINITY }
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const [sourceBuffer, destinationBuffer] = await Promise.all([source.screenshot({ style }), destination.screenshot({ style })])
    const expected = PNG.sync.read(sourceBuffer)
    const actual = PNG.sync.read(destinationBuffer)
    expect({ height: actual.height, width: actual.width }).toEqual({ height: expected.height, width: expected.width })
    const visible = pixelmatch(expected.data, actual.data, null, expected.width, expected.height, { threshold: 0 })
    let raw = 0
    for (let index = 0; index < expected.data.length; index += 1) raw = Math.max(raw, Math.abs(expected.data[index]! - actual.data[index]!))
    if (visible <= maxVisiblePixelDelta && raw <= maxRawChannelDelta) return
    if (visible < best.visible || (visible === best.visible && raw < best.raw)) best = { raw, visible }
    await Promise.all([source.page().waitForTimeout(100), destination.page().waitForTimeout(100)])
  }
  expect.soft(best.visible, 'visible raster pixels').toBeLessThanOrEqual(maxVisiblePixelDelta)
  expect(best.raw, 'maximum raw channel delta').toBeLessThanOrEqual(maxRawChannelDelta)
}

async function compareRasterAllowingVerticalGlyphSnap(source: Locator, destination: Locator) {
  const [sourceBuffer, destinationBuffer] = await Promise.all([source.screenshot(), destination.screenshot()])
  const expected = PNG.sync.read(sourceBuffer)
  const actual = PNG.sync.read(destinationBuffer)
  expect({ height: actual.height, width: actual.width }).toEqual({ height: expected.height, width: expected.width })

  const candidateDeltas = [-1, 0, 1].map(shift => {
    let raw = 0
    for (let y = 0; y < expected.height; y += 1) {
      const actualY = y + shift
      for (let x = 0; x < expected.width; x += 1) {
        for (let channel = 0; channel < 4; channel += 1) {
          const expectedValue = expected.data[(y * expected.width + x) * 4 + channel]!
          const actualValue = actualY >= 0 && actualY < actual.height
            ? actual.data[(actualY * actual.width + x) * 4 + channel]!
            : actual.data[channel]!
          raw = Math.max(raw, Math.abs(expectedValue - actualValue))
        }
      }
    }
    return raw
  })

  // Chromium independently snaps this 15px centered line box to either adjacent
  // device row. Both apps produce both variants; no non-translation delta is allowed.
  expect(Math.min(...candidateDeltas), 'page-number glyph raster modulo Chromium vertical snapping').toBe(0)
}

async function waitForCompletedCompositing(locator: Locator) {
  await locator.evaluate(async element => {
    await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => undefined)))
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  })
}

async function currentScreenIndex(page: Page, app: 'react' | 'vue') {
  return page.locator(app === 'vue' ? '.slide-item' : '.mona-screen-slide-item').evaluateAll((items, currentClass) => (
    items.findIndex(item => item.classList.contains(currentClass))
  ), app === 'vue' ? 'current' : 'is-current')
}

async function exitSlideshow(vue: Page, react: Page) {
  await Promise.all([vue.keyboard.press('Escape'), react.keyboard.press('Escape')])
  await Promise.all([
    expect(vue.locator('.pptist-editor')).toBeVisible(),
    expect(react.getByRole('application', { name: 'Editable slide canvas' })).toBeVisible(),
  ])
}

async function openScreenMenus(vue: Page, react: Page) {
  await Promise.all([vue.mouse.click(700, 420, { button: 'right' }), react.mouse.click(700, 420, { button: 'right' })])
  await Promise.all([
    expect(vue.locator('.contextmenu')).toBeVisible(),
    expect(react.locator('.mona-screen-context-menu')).toBeVisible(),
  ])
}

test('base slideshow, toolbar, tooltips, and complete context menu match the source', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  await startSlideshow(vue, react)

  const sourceScreen = vue.locator('.pptist-screen')
  const destinationScreen = react.locator('.mona-pptist-screen')
  expect(roundedRect(await destinationScreen.boundingBox())).toEqual(roundedRect(await sourceScreen.boundingBox()))
  await compareRaster(sourceScreen, destinationScreen)

  await Promise.all([vue.mouse.move(1420, 880), react.mouse.move(1420, 880)])
  await Promise.all([
    waitForCompletedCompositing(vue.locator('.tools-right')),
    waitForCompletedCompositing(react.locator('.mona-screen-tools-right')),
  ])
  const sourceToolbar = vue.locator('.tools-right .content')
  const destinationToolbar = react.locator('.mona-screen-tools-right-content')
  const sourcePageNumber = sourceToolbar.locator('.page-number')
  const destinationPageNumber = destinationToolbar.locator('.mona-screen-page-number')
  expect(roundedRect(await destinationToolbar.boundingBox())).toEqual(roundedRect(await sourceToolbar.boundingBox()))
  expect((await destinationToolbar.textContent())?.replace(/\s/g, '')).toBe((await sourceToolbar.textContent())?.replace(/\s/g, ''))
  expect(roundedRect(await destinationPageNumber.boundingBox())).toEqual(roundedRect(await sourcePageNumber.boundingBox()))
  const textStyleProperties = [
    'color', 'font-family', 'font-feature-settings', 'font-kerning', 'font-size', 'font-stretch',
    'font-style', 'font-variant', 'font-variation-settings', 'font-weight', 'letter-spacing',
    'line-height', 'padding', 'text-align', 'text-rendering', 'word-spacing',
  ]
  const [sourceTextStyle, destinationTextStyle] = await Promise.all([
    sourcePageNumber.evaluate((element, properties) => Object.fromEntries(properties.map(property => [property, getComputedStyle(element).getPropertyValue(property)])), textStyleProperties),
    destinationPageNumber.evaluate((element, properties) => Object.fromEntries(properties.map(property => [property, getComputedStyle(element).getPropertyValue(property)])), textStyleProperties),
  ])
  expect(destinationTextStyle).toEqual(sourceTextStyle)
  await compareRaster(
    sourceToolbar,
    destinationToolbar,
    0,
    0,
    '.page-number, .mona-screen-page-number { color: transparent !important; }',
  )
  await compareRasterAllowingVerticalGlyphSnap(sourcePageNumber, destinationPageNumber)

  await Promise.all([
    vue.locator('.tools-right .tool-btn').nth(1).hover(),
    react.locator('.mona-screen-tools-right-content .mona-screen-tool-button').nth(1).hover(),
  ])
  await Promise.all([vue.waitForTimeout(650), react.waitForTimeout(650)])
  const sourceTooltip = vue.locator('.tippy-box:visible')
  const destinationTooltip = react.locator('.tippy-box:visible')
  expect(roundedRect(await destinationTooltip.boundingBox())).toEqual(roundedRect(await sourceTooltip.boundingBox()))
  await compareRaster(sourceTooltip, destinationTooltip)

  await Promise.all([vue.mouse.click(700, 420, { button: 'right' }), react.mouse.click(700, 420, { button: 'right' })])
  const sourceMenu = vue.locator('.contextmenu')
  const destinationMenu = react.locator('.mona-screen-context-menu')
  await Promise.all([expect(sourceMenu).toBeVisible(), expect(destinationMenu).toBeVisible()])
  expect(roundedRect(await destinationMenu.boundingBox())).toEqual(roundedRect(await sourceMenu.boundingBox()))
  expect((await destinationMenu.textContent())?.replace(/\s/g, '')).toBe((await sourceMenu.textContent())?.replace(/\s/g, ''))
  await compareRaster(sourceMenu, destinationMenu)

  await Promise.all([
    sourceMenu.locator('.menu-item-content > .text').filter({ hasText: /Auto.?play/i }).hover(),
    destinationMenu.locator('[data-action="autoplay"]').hover(),
  ])
  const sourceSubmenu = sourceMenu.locator('.sub-menu')
  const destinationSubmenu = destinationMenu.locator('.mona-screen-context-submenu')
  await Promise.all([expect(sourceSubmenu).toBeVisible(), expect(destinationSubmenu).toBeVisible()])
  expect(roundedRect(await destinationSubmenu.boundingBox())).toEqual(roundedRect(await sourceSubmenu.boundingBox()))
  expect((await destinationSubmenu.textContent())?.replace(/\s/g, '')).toBe((await sourceSubmenu.textContent())?.replace(/\s/g, ''))
  await compareRaster(sourceSubmenu, destinationSubmenu)

  await closeEditors(sourceContext, destinationContext)
})

test('all-slides and bottom-thumbnail surfaces preserve layout and staged loading', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  await startSlideshow(vue, react)

  await Promise.all([vue.mouse.click(700, 420, { button: 'right' }), react.mouse.click(700, 420, { button: 'right' })])
  await Promise.all([
    vue.locator('.contextmenu .menu-item').filter({ hasText: /all slides/i }).click(),
    react.locator('.mona-screen-context-menu [data-action="all-slides"]').click(),
  ])
  const sourceAll = vue.locator('.slide-thumbnails')
  const destinationAll = react.locator('.mona-screen-all-slides')
  await Promise.all([expect(sourceAll).toBeVisible(), expect(destinationAll).toBeVisible()])
  expect(roundedRect(await destinationAll.boundingBox())).toEqual(roundedRect(await sourceAll.boundingBox()))
  expect(await sourceAll.locator('.placeholder').count()).toBe(13)
  expect(await destinationAll.locator('.mona-scaled-slide-placeholder').count()).toBe(13)
  await Promise.all([vue.waitForTimeout(700), react.waitForTimeout(700)])
  expect(await sourceAll.locator('.placeholder').count()).toBe(0)
  expect(await destinationAll.locator('.mona-scaled-slide-placeholder').count()).toBe(0)
  await compareRaster(sourceAll, destinationAll)

  await Promise.all([
    sourceAll.locator('.return-button .icon').click(),
    destinationAll.locator('.mona-screen-all-slides-return svg').click(),
  ])
  await Promise.all([vue.mouse.click(700, 420, { button: 'right' }), react.mouse.click(700, 420, { button: 'right' })])
  await Promise.all([
    vue.locator('.contextmenu .menu-item').filter({ hasText: /thumbnails.*bottom/i }).click(),
    react.locator('.mona-screen-context-menu [data-action="bottom-thumbnails"]').click(),
  ])
  await Promise.all([vue.mouse.move(720, 899), react.mouse.move(720, 899), vue.waitForTimeout(250), react.waitForTimeout(250)])
  const sourceBottom = vue.locator('.bottom-thumbnails .thumbnails')
  const destinationBottom = react.locator('.mona-screen-bottom-thumbnail-list')
  expect(roundedRect(await destinationBottom.boundingBox())).toEqual(roundedRect(await sourceBottom.boundingBox()))
  expect(await sourceBottom.locator('.placeholder').count()).toBe(13)
  expect(await destinationBottom.locator('.mona-scaled-slide-placeholder').count()).toBe(13)
  await Promise.all([vue.waitForTimeout(700), react.waitForTimeout(700)])
  await compareRaster(sourceBottom, destinationBottom)

  await closeEditors(sourceContext, destinationContext)
})

test('all editor launch routes preserve their exact from-current or from-start semantics', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  const animationSlide = 16
  await selectEditorSlide(vue, react, animationSlide)

  await startSlideshow(vue, react)
  expect(await currentScreenIndex(vue, 'vue')).toBe(animationSlide)
  expect(await currentScreenIndex(react, 'react')).toBe(animationSlide)
  await exitSlideshow(vue, react)

  await Promise.all([vue.keyboard.press('F5'), react.keyboard.press('F5')])
  await Promise.all([expect(vue.locator('.pptist-screen')).toBeVisible(), expect(react.locator('.mona-pptist-screen')).toBeVisible()])
  expect(await currentScreenIndex(vue, 'vue')).toBe(0)
  expect(await currentScreenIndex(react, 'react')).toBe(0)
  await exitSlideshow(vue, react)

  await selectEditorSlide(vue, react, animationSlide)
  await Promise.all([vue.keyboard.press('Shift+F5'), react.keyboard.press('Shift+F5')])
  await Promise.all([expect(vue.locator('.pptist-screen')).toBeVisible(), expect(react.locator('.mona-pptist-screen')).toBeVisible()])
  expect(await currentScreenIndex(vue, 'vue')).toBe(animationSlide)
  expect(await currentScreenIndex(react, 'react')).toBe(animationSlide)
  await exitSlideshow(vue, react)

  await Promise.all([
    vue.locator('.thumbnail-item').nth(animationSlide).dblclick(),
    react.locator('.mona-thumbnail-item').nth(animationSlide).dblclick(),
  ])
  await Promise.all([expect(vue.locator('.pptist-screen')).toBeVisible(), expect(react.locator('.mona-pptist-screen')).toBeVisible()])
  expect(await currentScreenIndex(vue, 'vue')).toBe(animationSlide)
  expect(await currentScreenIndex(react, 'react')).toBe(animationSlide)
  await exitSlideshow(vue, react)

  await Promise.all([
    vue.locator('.canvas').click({ button: 'right', position: { x: 500, y: 280 } }),
    react.locator('.mona-editor-slide-canvas').click({ button: 'right', position: { x: 500, y: 280 } }),
  ])
  await Promise.all([
    vue.locator('.contextmenu .menu-item-content > .text').filter({ hasText: /Start slideshow/i }).click(),
    react.locator('.mona-editor-context-menu [data-action="slideshow"]').click(),
  ])
  await Promise.all([expect(vue.locator('.pptist-screen')).toBeVisible(), expect(react.locator('.mona-pptist-screen')).toBeVisible()])
  expect(await currentScreenIndex(vue, 'vue')).toBe(0)
  expect(await currentScreenIndex(react, 'react')).toBe(0)

  await closeEditors(sourceContext, destinationContext)
})

test('turning modes, keyboard, wheel, touch, autoplay, looping, and boundary notices match', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  await selectEditorSlide(vue, react, 4)
  await startSlideshow(vue, react)

  const sourceModes = await vue.locator('.slide-item').evaluateAll(items => items.map(item => [...item.classList].find(name => name.startsWith('turning-mode-'))))
  const destinationModes = await react.locator('.mona-screen-slide-item').evaluateAll(items => items.map(item => [...item.classList].find(name => name.startsWith('turning-mode-'))))
  expect(destinationModes).toEqual(sourceModes)
  expect(sourceModes.slice(4, 16)).toEqual([
    'turning-mode-no',
    'turning-mode-fade',
    'turning-mode-slideX',
    'turning-mode-slideY',
    'turning-mode-slideX3D',
    'turning-mode-slideY3D',
    'turning-mode-rotate',
    'turning-mode-scaleY',
    'turning-mode-scaleX',
    'turning-mode-scale',
    'turning-mode-scaleReverse',
    'turning-mode-fade',
  ])

  await Promise.all([vue.keyboard.press('ArrowRight'), react.keyboard.press('ArrowRight')])
  expect(await currentScreenIndex(vue, 'vue')).toBe(5)
  expect(await currentScreenIndex(react, 'react')).toBe(5)
  await Promise.all([vue.waitForTimeout(520), react.waitForTimeout(520)])
  await Promise.all([
    vue.locator('.screen-slide-list').dispatchEvent('wheel', { deltaY: 120 }),
    react.locator('.mona-screen-main-surface').dispatchEvent('wheel', { deltaY: 120 }),
  ])
  expect(await currentScreenIndex(vue, 'vue')).toBe(6)
  expect(await currentScreenIndex(react, 'react')).toBe(6)
  await Promise.all([
    vue.locator('.screen-slide-list').dispatchEvent('touchstart', { changedTouches: [{ identifier: 0, pageX: 500, pageY: 500 }] }),
    react.locator('.mona-screen-main-surface').dispatchEvent('touchstart', { changedTouches: [{ identifier: 0, pageX: 500, pageY: 500 }] }),
  ])
  await Promise.all([
    vue.locator('.screen-slide-list').dispatchEvent('touchend', { changedTouches: [{ identifier: 0, pageX: 495, pageY: 390 }] }),
    react.locator('.mona-screen-main-surface').dispatchEvent('touchend', { changedTouches: [{ identifier: 0, pageX: 495, pageY: 390 }] }),
  ])
  expect(await currentScreenIndex(vue, 'vue')).toBe(7)
  expect(await currentScreenIndex(react, 'react')).toBe(7)

  await openScreenMenus(vue, react)
  await Promise.all([
    vue.locator('.contextmenu .menu-item-content > .text').filter({ hasText: /Auto.?play/i }).hover(),
    react.locator('.mona-screen-context-menu [data-action="autoplay"]').hover(),
  ])
  await Promise.all([
    vue.locator('.contextmenu .sub-menu .menu-item').first().click(),
    react.locator('.mona-screen-context-menu [data-action="autoplay-2500"]').click(),
  ])
  await expect.poll(async () => currentScreenIndex(vue, 'vue'), { timeout: 3200 }).toBe(8)
  await expect.poll(async () => currentScreenIndex(react, 'react'), { timeout: 3200 }).toBe(8)
  await openScreenMenus(vue, react)
  await Promise.all([
    vue.locator('.contextmenu .menu-item-content > .text').filter({ hasText: /Stop auto.?play/i }).click(),
    react.locator('.mona-screen-context-menu [data-action="autoplay"]').click(),
  ])
  await Promise.all([vue.waitForTimeout(2700), react.waitForTimeout(2700)])
  expect(await currentScreenIndex(vue, 'vue')).toBe(8)
  expect(await currentScreenIndex(react, 'react')).toBe(8)

  await openScreenMenus(vue, react)
  await Promise.all([
    vue.locator('.contextmenu .menu-item-content > .text').filter({ hasText: /Last slide/i }).click(),
    react.locator('.mona-screen-context-menu [data-action="last"]').click(),
  ])
  await openScreenMenus(vue, react)
  await Promise.all([
    vue.locator('.contextmenu .menu-item-content > .text').filter({ hasText: /Loop slideshow/i }).click(),
    react.locator('.mona-screen-context-menu [data-action="loop"]').click(),
  ])
  await Promise.all([vue.keyboard.press('ArrowRight'), react.keyboard.press('ArrowRight')])
  expect(await currentScreenIndex(vue, 'vue')).toBe(0)
  expect(await currentScreenIndex(react, 'react')).toBe(0)

  await openScreenMenus(vue, react)
  await Promise.all([
    vue.locator('.contextmenu .menu-item-content > .text').filter({ hasText: /Loop slideshow/i }).click(),
    react.locator('.mona-screen-context-menu [data-action="loop"]').click(),
  ])
  await Promise.all([vue.waitForTimeout(520), react.waitForTimeout(520)])
  await Promise.all([vue.keyboard.press('ArrowLeft'), react.keyboard.press('ArrowLeft')])
  await Promise.all([expect(vue.locator('.message')).toHaveCount(1), expect(react.locator('.mona-message')).toHaveCount(1)])
  await Promise.all([vue.keyboard.press('ArrowLeft'), react.keyboard.press('ArrowLeft')])
  await Promise.all([expect(vue.locator('.message')).toHaveCount(1), expect(react.locator('.mona-message')).toHaveCount(1)])
  await Promise.all([vue.waitForTimeout(3350), react.waitForTimeout(3350)])
  await Promise.all([expect(vue.locator('.message')).toHaveCount(0), expect(react.locator('.mona-message')).toHaveCount(0)])

  await closeEditors(sourceContext, destinationContext)
})

test('element animation grouping, auto chaining, persistence, and backward revocation match', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  await selectEditorSlide(vue, react, 16)
  await startSlideshow(vue, react)
  await Promise.all([vue, react].map(page => page.addStyleTag({ content: '.animate__animated { animation-play-state: paused !important; }' })))

  const sourceRoot = (id: string) => vue.locator(`#screen-element-${id}`)
  const destinationRoot = (id: string) => react.locator(`#screen-element-${id}`)
  const sourceAnimated = (id: string) => sourceRoot(id).locator('[class^="base-element-"]')
  const destinationAnimated = (id: string) => destinationRoot(id).locator('[data-element-id]')

  await Promise.all([
    expect(sourceRoot('gate6-screen-animation-in-a')).toHaveCSS('visibility', 'hidden'),
    expect(destinationRoot('gate6-screen-animation-in-a')).toHaveCSS('visibility', 'hidden'),
    expect(sourceRoot('gate6-screen-animation-in-b')).toHaveCSS('visibility', 'hidden'),
    expect(destinationRoot('gate6-screen-animation-in-b')).toHaveCSS('visibility', 'hidden'),
  ])

  await Promise.all([vue.keyboard.press('ArrowRight'), react.keyboard.press('ArrowRight')])
  await Promise.all([
    expect(sourceAnimated('gate6-screen-animation-in-a')).toHaveClass(/animate__fadeIn/),
    expect(destinationAnimated('gate6-screen-animation-in-a')).toHaveClass(/animate__fadeIn/),
    expect(sourceAnimated('gate6-screen-animation-in-b')).toHaveClass(/animate__slideInUp/),
    expect(destinationAnimated('gate6-screen-animation-in-b')).toHaveClass(/animate__slideInUp/),
  ])
  expect(await sourceAnimated('gate6-screen-animation-in-a').evaluate(element => element.style.getPropertyValue('--animate-duration'))).toBe('5000ms')
  expect(await destinationAnimated('gate6-screen-animation-in-a').evaluate(element => element.style.getPropertyValue('--animate-duration'))).toBe('5000ms')
  await Promise.all([
    sourceAnimated('gate6-screen-animation-in-a').dispatchEvent('animationend'),
    destinationAnimated('gate6-screen-animation-in-a').dispatchEvent('animationend'),
    sourceAnimated('gate6-screen-animation-in-b').dispatchEvent('animationend'),
    destinationAnimated('gate6-screen-animation-in-b').dispatchEvent('animationend'),
  ])
  await Promise.all([
    expect(sourceRoot('gate6-screen-animation-in-a')).toHaveCSS('visibility', 'visible'),
    expect(destinationRoot('gate6-screen-animation-in-a')).toHaveCSS('visibility', 'visible'),
    expect(sourceAnimated('gate6-screen-animation-in-a')).not.toHaveClass(/animate__fadeIn/),
    expect(destinationAnimated('gate6-screen-animation-in-a')).not.toHaveClass(/animate__fadeIn/),
  ])

  await Promise.all([vue.waitForTimeout(520), react.waitForTimeout(520)])
  await Promise.all([vue.keyboard.press('ArrowRight'), react.keyboard.press('ArrowRight')])
  await Promise.all([
    expect(sourceAnimated('gate6-screen-animation-attention')).toHaveClass(/animate__pulse/),
    expect(destinationAnimated('gate6-screen-animation-attention')).toHaveClass(/animate__pulse/),
  ])
  await Promise.all([
    sourceAnimated('gate6-screen-animation-attention').dispatchEvent('animationend'),
    destinationAnimated('gate6-screen-animation-attention').dispatchEvent('animationend'),
  ])

  await Promise.all([vue.waitForTimeout(520), react.waitForTimeout(520)])
  await Promise.all([vue.keyboard.press('ArrowRight'), react.keyboard.press('ArrowRight')])
  await Promise.all([
    expect(sourceAnimated('gate6-screen-animation-out')).toHaveClass(/animate__fadeOut/),
    expect(destinationAnimated('gate6-screen-animation-out')).toHaveClass(/animate__fadeOut/),
  ])
  await Promise.all([
    sourceAnimated('gate6-screen-animation-out').dispatchEvent('animationend'),
    destinationAnimated('gate6-screen-animation-out').dispatchEvent('animationend'),
  ])
  await Promise.all([
    expect(sourceAnimated('gate6-screen-animation-title')).toHaveClass(/animate__heartBeat/),
    expect(destinationAnimated('gate6-screen-animation-title')).toHaveClass(/animate__heartBeat/),
  ])
  await Promise.all([
    sourceAnimated('gate6-screen-animation-title').dispatchEvent('animationend'),
    destinationAnimated('gate6-screen-animation-title').dispatchEvent('animationend'),
  ])
  await Promise.all([
    expect(sourceAnimated('gate6-screen-animation-out')).toHaveClass(/animate__fadeOut/),
    expect(destinationAnimated('gate6-screen-animation-out')).toHaveClass(/animate__fadeOut/),
  ])

  await Promise.all([vue.waitForTimeout(520), react.waitForTimeout(520)])
  await Promise.all([vue.keyboard.press('ArrowLeft'), react.keyboard.press('ArrowLeft')])
  await Promise.all([
    expect(sourceAnimated('gate6-screen-animation-out')).not.toHaveClass(/animate__fadeOut/),
    expect(destinationAnimated('gate6-screen-animation-out')).not.toHaveClass(/animate__fadeOut/),
  ])
  await Promise.all([vue.waitForTimeout(520), react.waitForTimeout(520)])
  await Promise.all([vue.keyboard.press('ArrowLeft'), react.keyboard.press('ArrowLeft')])
  await Promise.all([
    expect(sourceRoot('gate6-screen-animation-in-a')).toHaveCSS('visibility', 'hidden'),
    expect(destinationRoot('gate6-screen-animation-in-a')).toHaveCSS('visibility', 'hidden'),
    expect(sourceRoot('gate6-screen-animation-in-b')).toHaveCSS('visibility', 'hidden'),
    expect(destinationRoot('gate6-screen-animation-in-b')).toHaveCSS('visibility', 'hidden'),
  ])

  await closeEditors(sourceContext, destinationContext)
})

test('automatic first animations and the unplayed-previous-slide reset match', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  await Promise.all([vue, react].map(page => page.addStyleTag({ content: '.animate__animated { animation-play-state: paused !important; }' })))
  await selectEditorSlide(vue, react, 17)
  await startSlideshow(vue, react)

  const sourceAnimated = (id: string) => vue.locator(`#screen-element-${id} [class^="base-element-"]`)
  const destinationAnimated = (id: string) => react.locator(`#screen-element-${id} [data-element-id]`)
  await Promise.all([
    expect(sourceAnimated('gate6-screen-auto-a')).toHaveClass(/animate__fadeIn/),
    expect(destinationAnimated('gate6-screen-auto-a')).toHaveClass(/animate__fadeIn/),
    expect(sourceAnimated('gate6-screen-auto-b')).toHaveClass(/animate__fadeIn/),
    expect(destinationAnimated('gate6-screen-auto-b')).toHaveClass(/animate__fadeIn/),
  ])
  await Promise.all([
    sourceAnimated('gate6-screen-auto-a').dispatchEvent('animationend'),
    destinationAnimated('gate6-screen-auto-a').dispatchEvent('animationend'),
    sourceAnimated('gate6-screen-auto-b').dispatchEvent('animationend'),
    destinationAnimated('gate6-screen-auto-b').dispatchEvent('animationend'),
  ])
  await Promise.all([
    expect(sourceAnimated('gate6-screen-auto-a')).not.toHaveClass(/animate__fadeIn/),
    expect(destinationAnimated('gate6-screen-auto-a')).not.toHaveClass(/animate__fadeIn/),
  ])

  await Promise.all([vue.waitForTimeout(520), react.waitForTimeout(520)])
  await Promise.all([vue.keyboard.press('ArrowLeft'), react.keyboard.press('ArrowLeft')])
  expect(await currentScreenIndex(vue, 'vue')).toBe(17)
  expect(await currentScreenIndex(react, 'react')).toBe(17)
  await Promise.all([vue.waitForTimeout(520), react.waitForTimeout(520)])
  await Promise.all([vue.keyboard.press('ArrowLeft'), react.keyboard.press('ArrowLeft')])
  expect(await currentScreenIndex(vue, 'vue')).toBe(16)
  expect(await currentScreenIndex(react, 'react')).toBe(16)
  await Promise.all([
    expect(vue.locator('#screen-element-gate6-screen-animation-in-a')).toHaveCSS('visibility', 'hidden'),
    expect(react.locator('#screen-element-gate6-screen-animation-in-a')).toHaveCSS('visibility', 'hidden'),
  ])

  await closeEditors(sourceContext, destinationContext)
})

test('presenter layout, notes, thumbnail loading, controls, and view-state reset match', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  await selectEditorSlide(vue, react, 16)
  await startSlideshow(vue, react)
  await Promise.all([vue.mouse.move(1420, 880), react.mouse.move(1420, 880), vue.waitForTimeout(250), react.waitForTimeout(250)])
  await Promise.all([
    vue.locator('.tools-right .tool-btn').nth(4).click(),
    react.locator('.mona-screen-tools-right-content .mona-screen-tool-button').nth(4).click(),
  ])
  const sourcePresenter = vue.locator('.presenter-view')
  const destinationPresenter = react.locator('.mona-screen-presenter')
  await Promise.all([expect(sourcePresenter).toBeVisible(), expect(destinationPresenter).toBeVisible()])
  await Promise.all([vue.waitForTimeout(700), react.waitForTimeout(700)])
  expect(roundedRect(await destinationPresenter.boundingBox())).toEqual(roundedRect(await sourcePresenter.boundingBox()))
  expect((await destinationPresenter.textContent())?.replace(/\s/g, '')).toBe((await sourcePresenter.textContent())?.replace(/\s/g, ''))
  await compareRaster(sourcePresenter, destinationPresenter)

  const sourceRemark = vue.locator('.remark-content')
  const destinationRemark = react.locator('.mona-screen-presenter-remark-content')
  expect(await destinationRemark.innerHTML()).toBe(await sourceRemark.innerHTML())
  expect(await destinationRemark.evaluate(element => getComputedStyle(element).fontSize)).toBe('16px')
  for (let index = 0; index < 12; index += 1) {
    await Promise.all([
      vue.locator('.remark-scale .scale-btn').nth(1).click(),
      react.locator('.mona-screen-presenter-remark-scale > div').nth(1).click(),
    ])
  }
  await Promise.all([
    expect(vue.locator('.remark-scale .scale-btn').nth(1)).toHaveClass(/disable/),
    expect(react.locator('.mona-screen-presenter-remark-scale > div').nth(1)).toHaveClass(/is-disabled/),
  ])
  expect(await destinationRemark.evaluate(element => getComputedStyle(element).fontSize)).toBe('40px')
  for (let index = 0; index < 14; index += 1) {
    await Promise.all([
      vue.locator('.remark-scale .scale-btn').first().click(),
      react.locator('.mona-screen-presenter-remark-scale > div').first().click(),
    ])
  }
  await Promise.all([
    expect(vue.locator('.remark-scale .scale-btn').first()).toHaveClass(/disable/),
    expect(react.locator('.mona-screen-presenter-remark-scale > div').first()).toHaveClass(/is-disabled/),
  ])
  expect(await destinationRemark.evaluate(element => getComputedStyle(element).fontSize)).toBe('12px')

  await Promise.all([
    vue.locator('.presenter-view .thumbnails').dispatchEvent('wheel', { deltaY: 260 }),
    react.locator('.mona-screen-presenter-thumbnails').dispatchEvent('wheel', { deltaY: 260 }),
  ])
  expect(await react.locator('.mona-screen-presenter-thumbnails').evaluate(element => element.scrollLeft)).toBe(await vue.locator('.presenter-view .thumbnails').evaluate(element => element.scrollLeft))

  await Promise.all([
    vue.locator('.presenter-view .toolbar .tool-btn').first().click(),
    react.locator('.mona-screen-presenter-tool').first().click(),
  ])
  await Promise.all([expect(vue.locator('.base-view')).toBeVisible(), expect(react.locator('.mona-screen-base')).toBeVisible()])
  await Promise.all([
    expect(vue.locator('#screen-element-gate6-screen-animation-in-a')).toHaveCSS('visibility', 'hidden'),
    expect(react.locator('#screen-element-gate6-screen-animation-in-a')).toHaveCSS('visibility', 'hidden'),
  ])

  await closeEditors(sourceContext, destinationContext)
})

test('countdown timer rendering, editing, reset, drag bounds, and timing limits match', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  await startSlideshow(vue, react)
  await Promise.all([vue.mouse.move(1420, 880), react.mouse.move(1420, 880), vue.waitForTimeout(250), react.waitForTimeout(250)])
  await Promise.all([
    vue.locator('.tools-right .tool-btn').nth(3).click(),
    react.locator('.mona-screen-tools-right-content .mona-screen-tool-button').nth(3).click(),
  ])
  const sourceTimer = vue.locator('.countdown-timer')
  const destinationTimer = react.locator('.mona-screen-countdown')
  await Promise.all([expect(sourceTimer).toBeVisible(), expect(destinationTimer).toBeVisible()])
  expect(roundedRect(await destinationTimer.boundingBox())).toEqual(roundedRect(await sourceTimer.boundingBox()))
  await compareRaster(sourceTimer, destinationTimer)

  const sourceInputs = sourceTimer.locator('input')
  const destinationInputs = destinationTimer.locator('input')
  await Promise.all([
    expect(sourceInputs.first()).toBeDisabled(),
    expect(destinationInputs.first()).toBeDisabled(),
    expect(sourceInputs.nth(1)).toBeDisabled(),
    expect(destinationInputs.nth(1)).toBeDisabled(),
  ])
  await Promise.all([
    sourceTimer.locator('.header .text-btn').nth(2).click(),
    destinationTimer.locator('.mona-screen-timer-header span').nth(2).click(),
  ])
  await Promise.all([
    expect(sourceInputs.first()).toHaveValue('10'),
    expect(destinationInputs.first()).toHaveValue('10'),
    expect(sourceInputs.nth(1)).toHaveValue('00'),
    expect(destinationInputs.nth(1)).toHaveValue('00'),
  ])
  await Promise.all([sourceInputs.nth(1).fill('99'), destinationInputs.nth(1).fill('99')])
  await Promise.all([sourceInputs.nth(1).press('Enter'), destinationInputs.nth(1).press('Enter')])
  await Promise.all([expect(sourceInputs.nth(1)).toHaveValue('59'), expect(destinationInputs.nth(1)).toHaveValue('59')])
  await Promise.all([sourceInputs.first().fill('0'), destinationInputs.first().fill('0')])
  await Promise.all([sourceInputs.first().press('Enter'), destinationInputs.first().press('Enter')])
  await Promise.all([sourceInputs.nth(1).fill('1'), destinationInputs.nth(1).fill('1')])
  await Promise.all([sourceInputs.nth(1).press('Enter'), destinationInputs.nth(1).press('Enter')])

  await Promise.all([vue.clock.install(), react.clock.install()])
  await Promise.all([
    sourceTimer.locator('.header .text-btn').first().click(),
    destinationTimer.locator('.mona-screen-timer-header span').first().click(),
  ])
  await Promise.all([vue.clock.fastForward(1000), react.clock.fastForward(1000)])
  await Promise.all([
    expect(sourceInputs.first()).toHaveValue('10'),
    expect(destinationInputs.first()).toHaveValue('10'),
    expect(sourceInputs.nth(1)).toHaveValue('00'),
    expect(destinationInputs.nth(1)).toHaveValue('00'),
  ])
  expect((await sourceTimer.locator('.header .text-btn').first().textContent())?.trim()).toBe((await destinationTimer.locator('.mona-screen-timer-header span').first().textContent())?.trim())

  await Promise.all([
    sourceTimer.locator('.header .text-btn').nth(2).click(),
    destinationTimer.locator('.mona-screen-timer-header span').nth(2).click(),
  ])
  await Promise.all([vue, react].map(page => page.evaluate(() => {
    const testWindow = window as typeof window & { __gate6TimerTick?: () => void }
    const originalSetInterval = window.setInterval
    window.setInterval = ((handler: TimerHandler, timeout?: number, ...arguments_: unknown[]) => {
      if (timeout === 1000 && typeof handler === 'function') testWindow.__gate6TimerTick = handler as () => void
      return originalSetInterval(handler, timeout, ...arguments_)
    }) as typeof window.setInterval
  })))
  await Promise.all([
    sourceTimer.locator('.header .text-btn').first().click(),
    destinationTimer.locator('.mona-screen-timer-header span').first().click(),
  ])
  await Promise.all([vue, react].map(page => page.evaluate(() => {
    const tick = (window as typeof window & { __gate6TimerTick?: () => void }).__gate6TimerTick
    if (!tick) throw new Error('The one-second timer callback was not captured')
    for (let index = 0; index < 36_001; index += 1) tick()
  })))
  await Promise.all([
    expect(sourceInputs.first()).toHaveValue('600'),
    expect(destinationInputs.first()).toHaveValue('600'),
    expect(sourceInputs.nth(1)).toHaveValue('01'),
    expect(destinationInputs.nth(1)).toHaveValue('01'),
  ])

  const [sourceBox, destinationBox] = await Promise.all([sourceTimer.boundingBox(), destinationTimer.boundingBox()])
  if (!sourceBox || !destinationBox) throw new Error('Timer panels must be measurable')
  await Promise.all([
    vue.mouse.move(sourceBox.x + 90, sourceBox.y + 12),
    react.mouse.move(destinationBox.x + 90, destinationBox.y + 12),
  ])
  await Promise.all([vue.mouse.down(), react.mouse.down()])
  await Promise.all([vue.mouse.move(2000, 2000), react.mouse.move(2000, 2000)])
  await Promise.all([vue.mouse.up(), react.mouse.up()])
  expect(roundedRect(await destinationTimer.boundingBox())).toEqual(roundedRect(await sourceTimer.boundingBox()))

  await Promise.all([
    sourceTimer.locator('.close-btn').click(),
    destinationTimer.locator('.mona-screen-timer-close').click(),
  ])
  await Promise.all([expect(sourceTimer).toHaveCount(0), expect(destinationTimer).toHaveCount(0)])

  await closeEditors(sourceContext, destinationContext)
})

test('pen workspace, tool settings, drawing modes, persistence, and clearing match', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  await startSlideshow(vue, react)
  await Promise.all([vue.mouse.move(1420, 880), react.mouse.move(1420, 880)])
  await Promise.all([vue.waitForTimeout(250), react.waitForTimeout(250)])
  await Promise.all([
    vue.locator('.tools-right .tool-btn').nth(1).click(),
    react.locator('.mona-screen-tools-right-content .mona-screen-tool-button').nth(1).click(),
  ])

  const sourceBoard = vue.locator('.writing-board-tool')
  const destinationBoard = react.locator('.mona-screen-writing-board')
  const sourcePanel = vue.locator('.tools-panel')
  const destinationPanel = react.locator('.mona-screen-writing-tools-panel')
  await Promise.all([expect(sourceBoard).toBeVisible(), expect(destinationBoard).toBeVisible()])
  await Promise.all([vue.waitForTimeout(300), react.waitForTimeout(300)])
  expect(roundedRect(await destinationBoard.boundingBox())).toEqual(roundedRect(await sourceBoard.boundingBox()))
  expect(roundedRect(await destinationPanel.boundingBox())).toEqual(roundedRect(await sourcePanel.boundingBox()))
  await compareRaster(sourceBoard, destinationBoard)

  const sourceButtons = sourcePanel.locator('.btn')
  const destinationButtons = destinationPanel.locator('.mona-screen-writing-btn')
  await Promise.all([expect(sourceButtons).toHaveCount(7), expect(destinationButtons).toHaveCount(7)])
  for (let index = 0; index < 4; index += 1) {
    await Promise.all([sourceButtons.nth(index).click(), destinationButtons.nth(index).click()])
    await Promise.all([vue.waitForTimeout(250), react.waitForTimeout(250)])
    const sourcePopover = vue.locator('.tippy-box[data-theme~="popover"][data-state="visible"]')
    const destinationPopover = react.locator('.tippy-box[data-theme~="popover"][data-state="visible"]')
    await Promise.all([expect(sourcePopover).toBeVisible(), expect(destinationPopover).toBeVisible()])
    expect(roundedRect(await destinationPopover.boundingBox())).toEqual(roundedRect(await sourcePopover.boundingBox()))
    expect((await destinationPopover.textContent())?.replace(/\s/g, '')).toBe((await sourcePopover.textContent())?.replace(/\s/g, ''))
    await compareRaster(sourcePopover, destinationPopover)
  }

  await Promise.all([sourceButtons.nth(3).click(), destinationButtons.nth(3).click()])
  await Promise.all([
    expect(sourceButtons.nth(3)).toHaveClass(/active/),
    expect(destinationButtons.nth(3)).toHaveClass(/is-active/),
  ])
  await Promise.all([
    sourcePanel.locator('.color').nth(6).click(),
    destinationPanel.locator('.mona-screen-writing-color').nth(6).click(),
  ])
  await Promise.all([
    expect(sourceButtons.first()).toHaveClass(/active/),
    expect(destinationButtons.first()).toHaveClass(/is-active/),
    expect(sourcePanel.locator('.color').nth(6)).toHaveClass(/active/),
    expect(destinationPanel.locator('.mona-screen-writing-color').nth(6)).toHaveClass(/is-active/),
  ])

  await Promise.all([sourceButtons.nth(1).click(), destinationButtons.nth(1).click()])
  const sourceCanvas = vue.locator('.writing-board .canvas')
  const destinationCanvas = react.locator('.mona-screen-writing-canvas-element')
  const [sourceCanvasBox, destinationCanvasBox] = await Promise.all([sourceCanvas.boundingBox(), destinationCanvas.boundingBox()])
  if (!sourceCanvasBox || !destinationCanvasBox) throw new Error('Writing canvases must be measurable')
  expect(roundedRect(destinationCanvasBox)).toEqual(roundedRect(sourceCanvasBox))
  await Promise.all([
    vue.mouse.move(sourceCanvasBox.x + 270, sourceCanvasBox.y + 190),
    react.mouse.move(destinationCanvasBox.x + 270, destinationCanvasBox.y + 190),
  ])
  await Promise.all([vue.mouse.down(), react.mouse.down()])
  await Promise.all([
    vue.mouse.move(sourceCanvasBox.x + 480, sourceCanvasBox.y + 330),
    react.mouse.move(destinationCanvasBox.x + 480, destinationCanvasBox.y + 330),
  ])
  await Promise.all([vue.mouse.up(), react.mouse.up()])
  await expect.poll(async () => sourceCanvas.evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL())).not.toBe('')
  const sourceDrawing = await sourceCanvas.evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL())
  const destinationDrawing = await destinationCanvas.evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL())
  expect(destinationDrawing).toBe(sourceDrawing)
  await compareRaster(sourceCanvas, destinationCanvas)

  await Promise.all([vue.waitForTimeout(520), react.waitForTimeout(520)])
  await Promise.all([vue.keyboard.press('ArrowRight'), react.keyboard.press('ArrowRight')])
  await Promise.all([vue.waitForTimeout(100), react.waitForTimeout(100)])
  const sourceBlank = await sourceCanvas.evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL())
  const destinationBlank = await destinationCanvas.evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL())
  expect(destinationBlank).toBe(sourceBlank)
  expect(sourceBlank).not.toBe(sourceDrawing)
  await Promise.all([vue.waitForTimeout(520), react.waitForTimeout(520)])
  await Promise.all([vue.keyboard.press('ArrowLeft'), react.keyboard.press('ArrowLeft')])
  await expect.poll(async () => destinationCanvas.evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL())).toBe(sourceDrawing)
  expect(await sourceCanvas.evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL())).toBe(sourceDrawing)

  await Promise.all([sourceButtons.nth(5).click(), destinationButtons.nth(5).click()])
  await Promise.all([
    expect(vue.locator('.writing-board .blackboard')).toBeVisible(),
    expect(react.locator('.mona-screen-blackboard')).toBeVisible(),
  ])
  await compareRaster(vue.locator('.writing-board-wrap'), react.locator('.mona-screen-writing-wrap'))
  await Promise.all([sourceButtons.nth(4).click(), destinationButtons.nth(4).click()])
  await Promise.all([vue.waitForTimeout(50), react.waitForTimeout(50)])
  const sourceCleared = await sourceCanvas.evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL())
  const destinationCleared = await destinationCanvas.evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL())
  expect(destinationCleared).toBe(sourceCleared)
  expect(sourceCleared).not.toBe(sourceDrawing)
  await Promise.all([sourceButtons.nth(6).click(), destinationButtons.nth(6).click()])
  await Promise.all([expect(sourceBoard).toHaveCount(0), expect(destinationBoard).toHaveCount(0)])

  await closeEditors(sourceContext, destinationContext)
})

test('audience popup state, navigation, writing, blackboard, laser, and exit synchronization match', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  await startSlideshow(vue, react)
  await Promise.all([vue.mouse.move(1420, 880), react.mouse.move(1420, 880)])
  await Promise.all([vue.waitForTimeout(250), react.waitForTimeout(250)])

  const sourcePopupPromise = sourceContext.waitForEvent('page')
  const destinationPopupPromise = destinationContext.waitForEvent('page')
  await Promise.all([
    vue.locator('.tools-right .tool-btn').nth(5).click(),
    react.locator('.mona-screen-tools-right-content .mona-screen-tool-button').nth(5).click(),
  ])
  const [sourceAudience, destinationAudience] = await Promise.all([sourcePopupPromise, destinationPopupPromise])
  const sourceAudienceRoot = sourceAudience.locator('.audience-view')
  const destinationAudienceRoot = destinationAudience.locator('.mona-screen-audience')
  await Promise.all([
    expect(sourceAudienceRoot).toBeVisible(),
    expect(destinationAudienceRoot).toBeVisible(),
    sourceAudience.waitForFunction(() => document.querySelectorAll('.slide-item').length === 63),
    destinationAudience.waitForFunction(() => document.querySelectorAll('.mona-screen-slide-item').length === 63),
  ])
  expect(await currentScreenIndex(sourceAudience, 'vue')).toBe(0)
  expect(await currentScreenIndex(destinationAudience, 'react')).toBe(0)
  expect(roundedRect(await destinationAudienceRoot.boundingBox())).toEqual(roundedRect(await sourceAudienceRoot.boundingBox()))
  await compareRaster(sourceAudienceRoot, destinationAudienceRoot)

  await Promise.all([vue.keyboard.press('ArrowRight'), react.keyboard.press('ArrowRight')])
  await Promise.all([
    expect.poll(async () => currentScreenIndex(sourceAudience, 'vue')).toBe(1),
    expect.poll(async () => currentScreenIndex(destinationAudience, 'react')).toBe(1),
  ])
  expect(await currentScreenIndex(vue, 'vue')).toBe(1)
  expect(await currentScreenIndex(react, 'react')).toBe(1)
  await Promise.all([sourceAudience.waitForTimeout(520), destinationAudience.waitForTimeout(520)])
  await compareRaster(sourceAudienceRoot, destinationAudienceRoot)

  await Promise.all([vue.mouse.move(1420, 880), react.mouse.move(1420, 880)])
  await Promise.all([vue.waitForTimeout(250), react.waitForTimeout(250)])
  await Promise.all([
    vue.locator('.tools-right .tool-btn').nth(1).click(),
    react.locator('.mona-screen-tools-right-content .mona-screen-tool-button').nth(1).click(),
  ])
  await Promise.all([
    expect(sourceAudience.locator('.writing-board-overlay')).toBeVisible(),
    expect(destinationAudience.locator('.mona-screen-audience-writing-overlay')).toBeVisible(),
  ])
  const sourcePanel = vue.locator('.tools-panel')
  const destinationPanel = react.locator('.mona-screen-writing-tools-panel')
  await Promise.all([
    sourcePanel.locator('.btn').nth(1).click(),
    destinationPanel.locator('.mona-screen-writing-btn').nth(1).click(),
  ])
  const sourceCanvas = vue.locator('.writing-board .canvas')
  const destinationCanvas = react.locator('.mona-screen-writing-canvas-element')
  const [sourceCanvasBox, destinationCanvasBox] = await Promise.all([sourceCanvas.boundingBox(), destinationCanvas.boundingBox()])
  if (!sourceCanvasBox || !destinationCanvasBox) throw new Error('Writing canvases must be measurable')
  await Promise.all([
    vue.mouse.move(sourceCanvasBox.x + 210, sourceCanvasBox.y + 160),
    react.mouse.move(destinationCanvasBox.x + 210, destinationCanvasBox.y + 160),
  ])
  await Promise.all([vue.mouse.down(), react.mouse.down()])
  await Promise.all([
    vue.mouse.move(sourceCanvasBox.x + 430, sourceCanvasBox.y + 310),
    react.mouse.move(destinationCanvasBox.x + 430, destinationCanvasBox.y + 310),
  ])
  await Promise.all([vue.mouse.up(), react.mouse.up()])
  const sourceAudienceImage = sourceAudience.locator('.writing-board-content img')
  const destinationAudienceImage = destinationAudience.locator('.mona-screen-audience-writing-content img')
  await Promise.all([expect(sourceAudienceImage).toBeVisible(), expect(destinationAudienceImage).toBeVisible()])
  expect(await destinationAudienceImage.getAttribute('src')).toBe(await sourceAudienceImage.getAttribute('src'))
  expect(await destinationAudienceImage.getAttribute('src')).toBe(await destinationCanvas.evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL()))
  expect(await sourceAudienceImage.getAttribute('src')).toBe(await sourceCanvas.evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL()))
  await compareRaster(sourceAudience.locator('.writing-board-content'), destinationAudience.locator('.mona-screen-audience-writing-content'))

  await Promise.all([
    sourcePanel.locator('.btn').nth(5).click(),
    destinationPanel.locator('.mona-screen-writing-btn').nth(5).click(),
  ])
  await Promise.all([
    expect(sourceAudience.locator('.writing-board-content .blackboard')).toBeVisible(),
    expect(destinationAudience.locator('.mona-screen-audience-writing-content .mona-screen-blackboard')).toBeVisible(),
  ])
  await compareRaster(sourceAudience.locator('.writing-board-content'), destinationAudience.locator('.mona-screen-audience-writing-content'))
  await Promise.all([
    sourcePanel.locator('.btn').nth(6).click(),
    destinationPanel.locator('.mona-screen-writing-btn').nth(6).click(),
  ])
  await Promise.all([
    expect(sourceAudience.locator('.writing-board-overlay')).toHaveCount(0),
    expect(destinationAudience.locator('.mona-screen-audience-writing-overlay')).toHaveCount(0),
  ])

  await Promise.all([vue.mouse.move(1420, 880), react.mouse.move(1420, 880)])
  await Promise.all([vue.waitForTimeout(250), react.waitForTimeout(250)])
  await Promise.all([
    vue.locator('.tools-right .tool-btn').nth(2).click(),
    react.locator('.mona-screen-tools-right-content .mona-screen-tool-button').nth(2).click(),
  ])
  await Promise.all([vue.mouse.move(720, 430), react.mouse.move(720, 430)])
  const sourceLaser = sourceAudience.locator('.laser-pen')
  const destinationLaser = destinationAudience.locator('.mona-screen-audience-laser')
  await Promise.all([expect(sourceLaser).toBeVisible(), expect(destinationLaser).toBeVisible()])
  expect(roundedRect(await destinationLaser.boundingBox())).toEqual(roundedRect(await sourceLaser.boundingBox()))
  expect(await destinationLaser.evaluate(element => getComputedStyle(element).backgroundImage)).toBe(await sourceLaser.evaluate(element => getComputedStyle(element).backgroundImage))
  await compareRaster(sourceLaser, destinationLaser)
  await Promise.all([vue.mouse.move(1420, 880), react.mouse.move(1420, 880)])
  await Promise.all([vue.waitForTimeout(250), react.waitForTimeout(250)])
  await Promise.all([
    vue.locator('.tools-right .tool-btn').nth(2).click(),
    react.locator('.mona-screen-tools-right-content .mona-screen-tool-button').nth(2).click(),
  ])
  await Promise.all([expect(sourceLaser).toHaveCount(0), expect(destinationLaser).toHaveCount(0)])

  await Promise.all([vue.keyboard.press('Escape'), react.keyboard.press('Escape')])
  await Promise.all([
    expect.poll(() => sourceAudience.isClosed()).toBe(true),
    expect.poll(() => destinationAudience.isClosed()).toBe(true),
    expect(vue.locator('.pptist-editor')).toBeVisible(),
    expect(react.getByRole('application', { name: 'Editable slide canvas' })).toBeVisible(),
  ])
  await closeEditors(sourceContext, destinationContext)
})

test('slide links, web links, native anchors, and fullscreen ownership match', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  await Promise.all([vue, react].map(page => page.evaluate(() => {
    const testWindow = window as typeof window & { __gate6OpenedURLs?: string[] }
    testWindow.__gate6OpenedURLs = []
    window.addEventListener('click', event => {
      if ((event.target as HTMLElement | null)?.tagName === 'A') event.preventDefault()
    }, true)
    window.open = ((url?: string | URL) => {
      testWindow.__gate6OpenedURLs?.push(String(url))
      return null
    }) as typeof window.open
  })))
  await selectEditorSlide(vue, react, 18)
  await startSlideshow(vue, react)
  const sourceSlideLink = vue.locator('#screen-element-gate6-screen-slide-link')
  const destinationSlideLink = react.locator('#screen-element-gate6-screen-slide-link')
  const sourceWebLink = vue.locator('#screen-element-gate6-screen-web-link')
  const destinationWebLink = react.locator('#screen-element-gate6-screen-web-link')
  await Promise.all([
    expect(sourceSlideLink).toHaveAttribute('title', 'gate6-screen-transition-no'),
    expect(destinationSlideLink).toHaveAttribute('title', 'gate6-screen-transition-no'),
    expect(sourceWebLink).toHaveAttribute('title', 'https://example.com'),
    expect(destinationWebLink).toHaveAttribute('title', 'https://example.com'),
  ])
  expect(await destinationSlideLink.evaluate(element => getComputedStyle(element).cursor)).toBe(await sourceSlideLink.evaluate(element => getComputedStyle(element).cursor))
  await compareRaster(vue.locator('.screen-slide-list'), react.locator('.mona-screen-slide-list'))

  const sourceSlideLinkContent = sourceSlideLink.locator('[class^="base-element-"]')
  const destinationSlideLinkContent = destinationSlideLink.locator('[data-element-id]')
  await Promise.all([expect(sourceSlideLinkContent).toBeVisible(), expect(destinationSlideLinkContent).toBeVisible()])
  await destinationSlideLinkContent.click()
  await sourceSlideLinkContent.click()
  expect(await currentScreenIndex(vue, 'vue')).toBe(4)
  expect(await currentScreenIndex(react, 'react')).toBe(4)
  await Promise.all([
    expect.poll(() => vue.evaluate(() => !!document.fullscreenElement)).toBe(true),
    expect.poll(() => react.evaluate(() => !!document.fullscreenElement)).toBe(true),
  ])

  await openScreenMenus(vue, react)
  await Promise.all([
    vue.locator('.contextmenu .menu-item-content > .text').filter({ hasText: /All slides/i }).click(),
    react.locator('.mona-screen-context-menu [data-action="all-slides"]').click(),
  ])
  await Promise.all([
    vue.locator('.slide-thumbnails-content > .thumbnail').nth(18).click(),
    react.locator('.mona-screen-all-slides-content > .mona-screen-thumbnail').nth(18).click(),
  ])
  expect(await currentScreenIndex(vue, 'vue')).toBe(18)
  expect(await currentScreenIndex(react, 'react')).toBe(18)

  await destinationWebLink.locator('[data-element-id]').click({ position: { x: 300, y: 70 } })
  await sourceWebLink.locator('[class^="base-element-"]').click({ position: { x: 300, y: 70 } })
  await Promise.all([
    expect.poll(() => vue.evaluate(() => !!document.fullscreenElement)).toBe(false),
    expect.poll(() => react.evaluate(() => !!document.fullscreenElement)).toBe(false),
  ])
  expect(await vue.evaluate(() => (window as typeof window & { __gate6OpenedURLs?: string[] }).__gate6OpenedURLs)).toEqual(['https://example.com'])
  expect(await react.evaluate(() => (window as typeof window & { __gate6OpenedURLs?: string[] }).__gate6OpenedURLs)).toEqual(['https://example.com'])
  await Promise.all([expect(vue.locator('.pptist-screen')).toBeVisible(), expect(react.locator('.mona-pptist-screen')).toBeVisible()])

  await Promise.all([vue.mouse.move(1420, 880), react.mouse.move(1420, 880)])
  await Promise.all([vue.waitForTimeout(250), react.waitForTimeout(250)])
  await Promise.all([
    vue.locator('.tools-right .tool-btn').nth(6).click(),
    react.locator('.mona-screen-tools-right-content .mona-screen-tool-button').nth(6).click(),
  ])
  await Promise.all([
    expect.poll(() => vue.evaluate(() => !!document.fullscreenElement)).toBe(true),
    expect.poll(() => react.evaluate(() => !!document.fullscreenElement)).toBe(true),
  ])
  const sourceAnchor = sourceWebLink.locator('a')
  const destinationAnchor = destinationWebLink.locator('a')
  expect(await destinationAnchor.evaluate(element => getComputedStyle(element).color)).toBe(await sourceAnchor.evaluate(element => getComputedStyle(element).color))
  expect(await destinationAnchor.evaluate(element => getComputedStyle(element).textDecorationLine)).toBe(await sourceAnchor.evaluate(element => getComputedStyle(element).textDecorationLine))
  await destinationAnchor.click()
  await sourceAnchor.click()
  await Promise.all([
    expect.poll(() => vue.evaluate(() => !!document.fullscreenElement)).toBe(false),
    expect.poll(() => react.evaluate(() => !!document.fullscreenElement)).toBe(false),
  ])
  expect(await vue.evaluate(() => (window as typeof window & { __gate6OpenedURLs?: string[] }).__gate6OpenedURLs)).toEqual(['https://example.com'])
  expect(await react.evaluate(() => (window as typeof window & { __gate6OpenedURLs?: string[] }).__gate6OpenedURLs)).toEqual(['https://example.com'])
  await Promise.all([expect(vue.locator('.pptist-screen')).toBeVisible(), expect(react.locator('.mona-pptist-screen')).toBeVisible()])

  await closeEditors(sourceContext, destinationContext)
})

test('active-slide media, custom controls, autoplay, looping, touch volume, and errors match', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  await Promise.all([vue, react].map(page => page.evaluate(() => {
    const mediaPrototype = HTMLMediaElement.prototype as HTMLMediaElement & { play: () => Promise<void> }
    Object.defineProperty(mediaPrototype, 'play', {
      configurable: true,
      value(this: HTMLMediaElement) {
        this.dispatchEvent(new Event('play'))
        return Promise.resolve()
      },
    })
    Object.defineProperty(mediaPrototype, 'pause', {
      configurable: true,
      value(this: HTMLMediaElement) {
        this.dispatchEvent(new Event('pause'))
      },
    })
  })))
  await selectEditorSlide(vue, react, 3)
  await startSlideshow(vue, react)
  const sourceVideo = vue.locator('.screen-element-video .video-player')
  const destinationVideo = react.locator('.mona-video-element .mona-video-player')
  const sourceAudio = vue.locator('.screen-element-audio')
  const destinationAudio = react.locator('.mona-audio-element')
  const sourceVideoNative = sourceVideo.locator('video')
  const destinationVideoNative = destinationVideo.locator('video')
  const sourceAudioNative = sourceAudio.locator('audio')
  const destinationAudioNative = destinationAudio.locator('audio')
  await Promise.all([
    expect(sourceVideoNative).toHaveCount(1),
    expect(destinationVideoNative).toHaveCount(1),
    expect(sourceAudioNative).toHaveCount(1),
    expect(destinationAudioNative).toHaveCount(1),
  ])
  expect(await sourceVideoNative.evaluate(element => element.autoplay)).toBe(true)
  expect(await destinationVideoNative.evaluate(element => element.autoplay)).toBe(true)
  expect(await sourceAudioNative.evaluate(element => element.autoplay)).toBe(true)
  expect(await destinationAudioNative.evaluate(element => element.autoplay)).toBe(true)
  expect(roundedRect(await destinationVideo.boundingBox())).toEqual(roundedRect(await sourceVideo.boundingBox()))
  await compareRaster(sourceVideo, destinationVideo)

  await Promise.all([sourceVideoNative, destinationVideoNative].map(locator => locator.evaluate(element => {
    Object.defineProperty(element, 'duration', { configurable: true, value: 125 })
    Object.defineProperty(element, 'currentTime', { configurable: true, writable: true, value: 65 })
    element.dispatchEvent(new Event('durationchange'))
    element.dispatchEvent(new Event('timeupdate'))
  })))
  expect((await destinationVideo.textContent())?.replace(/\s/g, '')).toBe((await sourceVideo.textContent())?.replace(/\s/g, ''))
  await compareRaster(sourceVideo, destinationVideo)
  await Promise.all([
    sourceVideo.locator('.video-wrap').click(),
    destinationVideo.locator('.mona-video-wrap').click(),
  ])
  await Promise.all([
    expect(destinationVideo.getByRole('button', { name: 'Pause' })).toBeVisible(),
  ])
  await compareRaster(sourceVideo.locator('.play-icon'), destinationVideo.getByRole('button', { name: 'Pause' }))

  await Promise.all([
    sourceVideo.locator('.speed-icon .icon-content').click(),
    destinationVideo.locator('.mona-video-speed .is-speed').click(),
  ])
  const sourceSpeedMenu = sourceVideo.locator('.speed-menu')
  const destinationSpeedMenu = destinationVideo.locator('.mona-video-speed-menu')
  await Promise.all([expect(sourceSpeedMenu).toBeVisible(), expect(destinationSpeedMenu).toBeVisible()])
  expect(roundedRect(await destinationSpeedMenu.boundingBox())).toEqual(roundedRect(await sourceSpeedMenu.boundingBox()))
  expect((await destinationSpeedMenu.textContent())?.replace(/\s/g, '')).toBe((await sourceSpeedMenu.textContent())?.replace(/\s/g, ''))
  await compareRaster(sourceSpeedMenu, destinationSpeedMenu)
  await Promise.all([
    sourceSpeedMenu.locator('.speed-menu-item').filter({ hasText: '1.5x' }).click(),
    destinationSpeedMenu.getByRole('button', { name: '1.5x' }).click(),
  ])
  expect(await sourceVideoNative.evaluate(element => element.playbackRate)).toBe(1.5)
  expect(await destinationVideoNative.evaluate(element => element.playbackRate)).toBe(1.5)
  await Promise.all([
    sourceVideo.locator('.loop').click(),
    destinationVideo.locator('.mona-player-icon.is-loop').click(),
  ])
  await Promise.all([
    expect(sourceVideo.locator('.loop-icon')).toHaveClass(/active/),
    expect(destinationVideo.locator('.mona-player-icon.is-loop')).toHaveClass(/is-active/),
  ])

  await Promise.all([sourceAudio.hover(), destinationAudio.hover()])
  const sourceAudioPlayer = sourceAudio.locator('.audio-player')
  const destinationAudioPlayer = destinationAudio.locator('.mona-audio-player')
  await Promise.all([expect(sourceAudioPlayer).toBeVisible(), expect(destinationAudioPlayer).toBeVisible()])
  await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
  expect(roundedRect(await destinationAudioPlayer.boundingBox())).toEqual(roundedRect(await sourceAudioPlayer.boundingBox()))
  await compareRaster(sourceAudioPlayer, destinationAudioPlayer)
  await Promise.all([
    sourceAudio.locator('.audio-icon').click(),
    destinationAudio.locator('.mona-audio-icon').click(),
  ])
  await Promise.all([
    expect(destinationAudioPlayer.getByRole('button', { name: 'Pause' })).toBeVisible(),
  ])
  await compareRaster(sourceAudioPlayer.locator('.play-icon'), destinationAudioPlayer.getByRole('button', { name: 'Pause' }))
  await Promise.all([sourceAudioNative, destinationAudioNative].map(locator => locator.evaluate(element => {
    Object.defineProperty(element, 'duration', { configurable: true, value: 90 })
    Object.defineProperty(element, 'currentTime', { configurable: true, writable: true, value: 30 })
    element.dispatchEvent(new Event('durationchange'))
    element.dispatchEvent(new Event('timeupdate'))
    element.dispatchEvent(new Event('ended'))
  })))
  expect(await sourceAudioNative.evaluate(element => element.currentTime)).toBe(0)
  expect(await destinationAudioNative.evaluate(element => element.currentTime)).toBe(0)

  const sourceVolumeWrap = sourceAudioPlayer.locator('.volume-bar-wrap')
  const destinationVolumeWrap = destinationAudioPlayer.locator('.mona-player-volume-wrap')
  const [sourceVolumeBox, destinationVolumeBox] = await Promise.all([sourceVolumeWrap.boundingBox(), destinationVolumeWrap.boundingBox()])
  if (!sourceVolumeBox || !destinationVolumeBox) throw new Error('Audio volume bars must be measurable')
  await Promise.all([
    sourceVolumeWrap.dispatchEvent('touchstart', { changedTouches: [{ clientX: sourceVolumeBox.x + 5, identifier: 0 }] }),
    destinationVolumeWrap.dispatchEvent('touchstart', { changedTouches: [{ clientX: destinationVolumeBox.x + 5, identifier: 0 }] }),
  ])
  await Promise.all([
    vue.locator('body').dispatchEvent('touchmove', { changedTouches: [{ clientX: sourceVolumeBox.x + 34, identifier: 0 }] }),
    react.locator('body').dispatchEvent('touchmove', { changedTouches: [{ clientX: destinationVolumeBox.x + 34, identifier: 0 }] }),
  ])
  await Promise.all([
    vue.locator('body').dispatchEvent('touchend', { changedTouches: [{ clientX: sourceVolumeBox.x + 34, identifier: 0 }] }),
    react.locator('body').dispatchEvent('touchend', { changedTouches: [{ clientX: destinationVolumeBox.x + 34, identifier: 0 }] }),
  ])
  expect(await destinationAudioPlayer.locator('.mona-player-volume-inner').getAttribute('style')).toBe(await sourceAudioPlayer.locator('.volume-bar-inner').getAttribute('style'))

  await Promise.all([vue.keyboard.press('ArrowRight'), react.keyboard.press('ArrowRight')])
  await Promise.all([
    expect(sourceVideoNative).toHaveCount(0),
    expect(destinationVideoNative).toHaveCount(0),
    expect(sourceAudioNative).toHaveCount(0),
    expect(destinationAudioNative).toHaveCount(0),
  ])
  await Promise.all([vue.waitForTimeout(520), react.waitForTimeout(520)])
  await Promise.all([vue.keyboard.press('ArrowLeft'), react.keyboard.press('ArrowLeft')])
  await Promise.all([expect(sourceVideo.locator('video')).toHaveCount(1), expect(destinationVideo.locator('video')).toHaveCount(1)])
  await Promise.all([
    expect(vue.locator('.message')).toHaveCount(0, { timeout: 6000 }),
    expect(react.locator('.mona-message')).toHaveCount(0, { timeout: 6000 }),
  ])

  await Promise.all([
    sourceVideo.locator('video').dispatchEvent('error'),
    destinationVideo.locator('video').dispatchEvent('error'),
  ])
  await Promise.all([
    expect(sourceVideo.locator('.load-error')).toBeVisible(),
    expect(destinationVideo.locator('.mona-video-load-error')).toBeVisible(),
  ])
  await compareRaster(sourceVideo.locator('.load-error'), destinationVideo.locator('.mona-video-load-error'))
  await Promise.all([
    sourceAudio.locator('audio').dispatchEvent('error'),
    destinationAudio.locator('audio').dispatchEvent('error'),
  ])
  const sourceNotice = vue.locator('.message')
  const destinationNotice = react.locator('.mona-message')
  await Promise.all([expect(sourceNotice).toHaveCount(1), expect(destinationNotice).toHaveCount(1)])
  await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
  expect((await destinationNotice.textContent())?.trim()).toBe((await sourceNotice.textContent())?.trim())
  await compareRaster(sourceNotice, destinationNotice)

  await closeEditors(sourceContext, destinationContext)
})

test('alternate keys, bottom-strip jumps, presenter tools, and fullscreen teardown match', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  await startSlideshow(vue, react)
  await Promise.all([vue.keyboard.press('PageDown'), react.keyboard.press('PageDown')])
  expect(await currentScreenIndex(vue, 'vue')).toBe(1)
  expect(await currentScreenIndex(react, 'react')).toBe(1)
  await Promise.all([vue.waitForTimeout(520), react.waitForTimeout(520)])
  await Promise.all([vue.keyboard.press('PageUp'), react.keyboard.press('PageUp')])
  expect(await currentScreenIndex(vue, 'vue')).toBe(0)
  expect(await currentScreenIndex(react, 'react')).toBe(0)
  await Promise.all([vue.waitForTimeout(520), react.waitForTimeout(520)])
  await Promise.all([vue.keyboard.press('Space'), react.keyboard.press('Space')])
  expect(await currentScreenIndex(vue, 'vue')).toBe(1)
  expect(await currentScreenIndex(react, 'react')).toBe(1)
  await Promise.all([vue.waitForTimeout(520), react.waitForTimeout(520)])
  await Promise.all([vue.keyboard.press('Enter'), react.keyboard.press('Enter')])
  expect(await currentScreenIndex(vue, 'vue')).toBe(2)
  expect(await currentScreenIndex(react, 'react')).toBe(2)

  await openScreenMenus(vue, react)
  await Promise.all([
    vue.locator('.contextmenu .menu-item').filter({ hasText: /thumbnails.*bottom/i }).click(),
    react.locator('.mona-screen-context-menu [data-action="bottom-thumbnails"]').click(),
  ])
  await Promise.all([vue.mouse.move(720, 899), react.mouse.move(720, 899)])
  await Promise.all([vue.waitForTimeout(250), react.waitForTimeout(250)])
  await Promise.all([
    vue.locator('.bottom-thumbnails .thumbnails > .thumbnail').nth(18).click(),
    react.locator('.mona-screen-bottom-thumbnail-list > .mona-screen-thumbnail').nth(18).click(),
  ])
  expect(await currentScreenIndex(vue, 'vue')).toBe(18)
  expect(await currentScreenIndex(react, 'react')).toBe(18)
  await openScreenMenus(vue, react)
  await Promise.all([
    vue.locator('.contextmenu .menu-item').filter({ hasText: /thumbnails.*bottom/i }).click(),
    react.locator('.mona-screen-context-menu [data-action="bottom-thumbnails"]').click(),
  ])

  await Promise.all([vue.mouse.move(1420, 880), react.mouse.move(1420, 880)])
  await Promise.all([vue.waitForTimeout(250), react.waitForTimeout(250)])
  await Promise.all([
    vue.locator('.tools-right .tool-btn').nth(4).click(),
    react.locator('.mona-screen-tools-right-content .mona-screen-tool-button').nth(4).click(),
  ])
  await Promise.all([
    vue.locator('.presenter-view .slide-list-wrap').click({ button: 'right', position: { x: 500, y: 300 } }),
    react.locator('.mona-screen-presenter-slide-wrap').click({ button: 'right', position: { x: 500, y: 300 } }),
  ])
  const sourceMenu = vue.locator('.contextmenu')
  const destinationMenu = react.locator('.mona-screen-context-menu')
  await Promise.all([expect(sourceMenu).toBeVisible(), expect(destinationMenu).toBeVisible()])
  expect(roundedRect(await destinationMenu.boundingBox())).toEqual(roundedRect(await sourceMenu.boundingBox()))
  expect((await destinationMenu.textContent())?.replace(/\s/g, '')).toBe((await sourceMenu.textContent())?.replace(/\s/g, ''))
  await compareRaster(sourceMenu, destinationMenu)
  await Promise.all([vue.keyboard.press('Escape'), react.keyboard.press('Escape')])
  await Promise.all([expect(vue.locator('.pptist-editor')).toBeVisible(), expect(react.getByRole('application', { name: 'Editable slide canvas' })).toBeVisible()])

  await startSlideshow(vue, react)
  await Promise.all([vue.mouse.move(1420, 880), react.mouse.move(1420, 880)])
  await Promise.all([vue.waitForTimeout(250), react.waitForTimeout(250)])
  await Promise.all([
    vue.locator('.tools-right .tool-btn').nth(4).click(),
    react.locator('.mona-screen-tools-right-content .mona-screen-tool-button').nth(4).click(),
  ])
  await Promise.all([
    vue.locator('.presenter-view .toolbar .tool-btn').nth(4).click(),
    react.locator('.mona-screen-presenter-tool').nth(4).click(),
  ])
  const sourceTimer = vue.locator('.presenter-view .countdown-timer')
  const destinationTimer = react.locator('.mona-screen-presenter .mona-screen-countdown')
  await Promise.all([expect(sourceTimer).toBeVisible(), expect(destinationTimer).toBeVisible()])
  expect(roundedRect(await destinationTimer.boundingBox())).toEqual(roundedRect(await sourceTimer.boundingBox()))
  await compareRaster(sourceTimer, destinationTimer)
  await Promise.all([
    vue.locator('.presenter-view .toolbar .tool-btn').nth(4).click(),
    react.locator('.mona-screen-presenter-tool').nth(4).click(),
  ])
  await Promise.all([
    vue.locator('.presenter-view .toolbar .tool-btn').nth(2).click(),
    react.locator('.mona-screen-presenter-tool').nth(2).click(),
  ])
  const sourceWritingPanel = vue.locator('.presenter-view .tools-panel')
  const destinationWritingPanel = react.locator('.mona-screen-presenter .mona-screen-writing-tools-panel')
  await Promise.all([expect(sourceWritingPanel).toBeVisible(), expect(destinationWritingPanel).toBeVisible()])
  expect(roundedRect(await destinationWritingPanel.boundingBox())).toEqual(roundedRect(await sourceWritingPanel.boundingBox()))
  await compareRaster(sourceWritingPanel, destinationWritingPanel)
  await Promise.all([
    vue.locator('.presenter-view .toolbar .tool-btn').nth(2).click(),
    react.locator('.mona-screen-presenter-tool').nth(2).click(),
  ])
  await Promise.all([
    vue.locator('.presenter-view .toolbar .tool-btn').first().click(),
    react.locator('.mona-screen-presenter-tool').first().click(),
  ])

  await Promise.all([vue.mouse.move(1420, 880), react.mouse.move(1420, 880)])
  await Promise.all([vue.waitForTimeout(250), react.waitForTimeout(250)])
  await Promise.all([
    vue.locator('.tools-right .tool-btn').nth(6).click(),
    react.locator('.mona-screen-tools-right-content .mona-screen-tool-button').nth(6).click(),
  ])
  await Promise.all([
    expect.poll(() => vue.evaluate(() => !!document.fullscreenElement)).toBe(false),
    expect.poll(() => react.evaluate(() => !!document.fullscreenElement)).toBe(false),
    expect(vue.locator('.pptist-screen')).toBeVisible(),
    expect(react.locator('.mona-pptist-screen')).toBeVisible(),
  ])
  await Promise.all([vue.mouse.move(1420, 880), react.mouse.move(1420, 880)])
  await Promise.all([vue.waitForTimeout(250), react.waitForTimeout(250)])
  await Promise.all([
    vue.locator('.tools-right .tool-btn').nth(6).click(),
    react.locator('.mona-screen-tools-right-content .mona-screen-tool-button').nth(6).click(),
  ])
  await Promise.all([
    expect.poll(() => vue.evaluate(() => !!document.fullscreenElement)).toBe(true),
    expect.poll(() => react.evaluate(() => !!document.fullscreenElement)).toBe(true),
  ])
  await Promise.all([vue.evaluate(() => document.exitFullscreen()), react.evaluate(() => document.exitFullscreen())])
  await Promise.all([
    expect(vue.locator('.pptist-editor')).toBeVisible(),
    expect(react.getByRole('application', { name: 'Editable slide canvas' })).toBeVisible(),
  ])

  await closeEditors(sourceContext, destinationContext)
})
