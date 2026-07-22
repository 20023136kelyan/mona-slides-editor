import { expect, test, type BrowserContext, type Locator, type Page, type TestInfo } from '@playwright/test'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import type { PPTElement } from '@mona/presentation-core/model'
import type { RichTextAttrs } from '@mona/rich-text'

interface VueState {
  presentation: {
    slides: Array<{ elements: PPTElement[] }>
    slideIndex: number
  }
  editor: {
    activeElementIdList: string[]
    activeGroupElementId: string
    handleElementId: string
    richTextAttrs: RichTextAttrs
  }
  history: {
    snapshotCursor: number
    snapshotLength: number
  }
}

interface ReactState {
  presentation: VueState['presentation']
  session: {
    activeElementIds: string[]
    activeGroupElementId: string | null
    handleElementId: string | null
  }
}

declare global {
  interface Window {
    __MONA_AI_WRITING_REQUESTS__?: Array<Record<string, unknown>>
    __MONA_TEST__?: { getState: () => VueState; isReady: () => boolean }
    __MONA_REACT_TEST__?: {
      getHistoryState: () => { cursor: number; length: number }
      getRichTextState: () => { elementId: string | null; attrs: RichTextAttrs }
      getState: () => ReactState
      isReady: () => boolean
    }
  }
}

const fixturePath = '/?rendererFixture=gate4-editor'

async function openEditors(context: BrowserContext) {
  await context.addInitScript(() => localStorage.setItem('mona:ui-locale', 'en-US'))
  const vue = await context.newPage()
  const react = await context.newPage()
  await Promise.all([
    vue.goto(`http://127.0.0.1:5173${fixturePath}`),
    react.goto(`http://127.0.0.1:5174${fixturePath}`),
  ])
  await Promise.all([
    expect(vue.locator('.pptist-editor')).toBeVisible(),
    expect(react.getByRole('application', { name: 'Editable slide canvas' })).toBeVisible(),
  ])
  await Promise.all([
    vue.waitForFunction(() => window.__MONA_TEST__?.isReady()),
    react.waitForFunction(() => window.__MONA_REACT_TEST__?.isReady()),
  ])
  return { react, vue }
}

async function selectTitle(vue: Page, react: Page) {
  const vueTitle = vue.locator('#editable-element-gate3-title .editable-element-text')
  const reactTitle = react.locator('.mona-editor-slide-canvas [data-element-id="gate3-title"] .mona-text-content')
  await Promise.all([
    vueTitle.click({ position: { x: 30, y: 20 } }),
    reactTitle.click({ position: { x: 30, y: 20 } }),
  ])
  await expect.poll(() => Promise.all([
    vue.evaluate(() => window.__MONA_TEST__!.getState().editor.handleElementId),
    react.evaluate(() => window.__MONA_REACT_TEST__!.getState().session.handleElementId),
  ])).toEqual(['gate3-title', 'gate3-title'])
  await Promise.all([
    vueTitle.click({ position: { x: 30, y: 20 } }),
    reactTitle.click({ position: { x: 30, y: 20 } }),
  ])
  await expect.poll(() => Promise.all([
    vue.evaluate(() => window.__MONA_TEST__!.getState().editor.activeGroupElementId || null),
    react.evaluate(() => window.__MONA_REACT_TEST__!.getState().session.activeGroupElementId),
  ])).toEqual(['gate3-title', 'gate3-title'])
  await expect.poll(async () => {
    const [vueAttrs, reactAttrs] = await Promise.all([
      vue.evaluate(() => window.__MONA_TEST__!.getState().editor.richTextAttrs),
      react.evaluate(() => window.__MONA_REACT_TEST__!.getRichTextState().attrs),
    ])
    return JSON.stringify(reactAttrs) === JSON.stringify(vueAttrs)
  }).toBe(true)
}

async function textElement(page: Page, app: 'react' | 'vue') {
  return textElementOnSlide(page, app, 0, 'gate3-title')
}

async function textElementOnSlide(page: Page, app: 'react' | 'vue', slideIndex: number, elementId: string) {
  return page.evaluate(({ app, elementId, slideIndex }) => {
    const state = app === 'vue' ? window.__MONA_TEST__!.getState() : window.__MONA_REACT_TEST__!.getState()
    return structuredClone(state.presentation.slides[slideIndex]!.elements.find(element => element.id === elementId)!)
  }, { app, elementId, slideIndex })
}

async function historyState(page: Page, app: 'react' | 'vue') {
  if (app === 'react') return page.evaluate(() => window.__MONA_REACT_TEST__!.getHistoryState())
  return page.evaluate(() => {
    const history = window.__MONA_TEST__!.getState().history
    return { cursor: history.snapshotCursor, length: history.snapshotLength }
  })
}

async function expectTextDocumentParity(vue: Page, react: Page) {
  await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
  try {
    await expect.poll(async () => JSON.stringify(await textElement(react, 'react')) === JSON.stringify(await textElement(vue, 'vue'))).toBe(true)
  }
  catch {
    // Preserve the complete structural diff instead of reporting only a
    // boolean timeout when a parity transition never settles.
    expect(await textElement(react, 'react')).toEqual(await textElement(vue, 'vue'))
  }
  expect(await textElement(react, 'react')).toEqual(await textElement(vue, 'vue'))
}

async function expectTextElementAndHistoryParity(vue: Page, react: Page) {
  await expectTextDocumentParity(vue, react)
  // Both implementations persist rich-text DOM changes after 300 ms and then
  // debounce the corresponding history snapshot for another 300 ms. Waiting
  // from document equality prevents a transient equal cursor from masking an
  // in-flight snapshot on either side.
  await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
  await expect.poll(async () => (
    JSON.stringify(await historyState(react, 'react')) === JSON.stringify(await historyState(vue, 'vue'))
  )).toBe(true)
  expect(await historyState(react, 'react')).toEqual(await historyState(vue, 'vue'))
}

async function expectCurrentSlideAndHistoryParity(vue: Page, react: Page) {
  await Promise.all([vue.waitForTimeout(400), react.waitForTimeout(400)])
  const [sourceSlide, destinationSlide] = await Promise.all([
    vue.evaluate(() => structuredClone(window.__MONA_TEST__!.getState().presentation.slides[window.__MONA_TEST__!.getState().presentation.slideIndex])),
    react.evaluate(() => structuredClone(window.__MONA_REACT_TEST__!.getState().presentation.slides[window.__MONA_REACT_TEST__!.getState().presentation.slideIndex])),
  ])
  expect(destinationSlide).toEqual(sourceSlide)
  await expect.poll(async () => JSON.stringify(await historyState(react, 'react')) === JSON.stringify(await historyState(vue, 'vue'))).toBe(true)
  expect(await historyState(react, 'react')).toEqual(await historyState(vue, 'vue'))
}

async function normalizedAnimationSlide(page: Page, app: 'react' | 'vue') {
  return page.evaluate(appName => {
    const state = appName === 'vue' ? window.__MONA_TEST__!.getState() : window.__MONA_REACT_TEST__!.getState()
    const slide = structuredClone(state.presentation.slides[state.presentation.slideIndex]!)
    if (slide.animations) slide.animations = slide.animations.map(animation => ({ ...animation, id: '__animation__' }))
    return slide
  }, app)
}

async function expectAnimationSlideAndHistoryParity(vue: Page, react: Page) {
  await Promise.all([vue.waitForTimeout(400), react.waitForTimeout(400)])
  expect(await normalizedAnimationSlide(react, 'react')).toEqual(await normalizedAnimationSlide(vue, 'vue'))
  await expect.poll(async () => JSON.stringify(await historyState(react, 'react')) === JSON.stringify(await historyState(vue, 'vue'))).toBe(true)
  expect(await historyState(react, 'react')).toEqual(await historyState(vue, 'vue'))
}

async function openPositionPanel(vue: Page, react: Page) {
  await Promise.all([
    vue.locator('.toolbar .tabs.card .tab').filter({ hasText: /^Position$/ }).click(),
    react.getByRole('tab', { name: 'Position', exact: true }).click(),
  ])
  await Promise.all([
    expect(vue.locator('.element-positopn-panel')).toBeVisible(),
    expect(react.locator('.mona-element-position-panel')).toBeVisible(),
  ])
}

async function openAnimationPanel(vue: Page, react: Page) {
  await Promise.all([
    vue.locator('.toolbar .tabs.card .tab').filter({ hasText: /^Animation$/ }).click(),
    react.getByRole('tab', { name: 'Animation', exact: true }).click(),
  ])
  await Promise.all([
    expect(vue.locator('.element-animation-panel')).toBeVisible(),
    expect(react.locator('.mona-element-animation-panel')).toBeVisible(),
  ])
}

async function openAnimationPool(vue: Page, react: Page, settle = true) {
  await Promise.all([
    vue.locator('.element-animation-btn').click(),
    react.getByRole('button', { name: 'Add animation', exact: true }).click(),
  ])
  const sourcePool = vue.locator('.tippy-box[data-theme~="popover"]:visible .animation-pool')
  const destinationPool = react.locator('.mona-animation-popover:visible .mona-animation-pool')
  await Promise.all([expect(sourcePool).toBeVisible(), expect(destinationPool).toBeVisible()])
  await Promise.all([vue.waitForTimeout(250), react.waitForTimeout(250)])
  if (settle) await Promise.all([vue.waitForTimeout(600), react.waitForTimeout(600)])
  return { destinationPool, sourcePool }
}

async function pointerDragBefore(page: Page, moving: ReturnType<Page['locator']>, before: ReturnType<Page['locator']>) {
  const movingBox = await moving.boundingBox()
  const beforeBox = await before.boundingBox()
  if (!movingBox || !beforeBox) throw new Error('Animation sequence drag geometry is unavailable')
  await page.mouse.move(movingBox.x + (movingBox.width / 2), movingBox.y + (movingBox.height / 2))
  await page.mouse.down()
  await page.mouse.move(beforeBox.x + (beforeBox.width / 2), beforeBox.y + 2, { steps: 12 })
  await page.mouse.up()
}

async function chooseInspectorSelect(vue: Page, react: Page, index: number, label: string) {
  await Promise.all([
    vue.locator('.text-style-panel .select').nth(index).click(),
    react.locator('.mona-text-style-panel .mona-panel-select').nth(index).click(),
  ])
  await Promise.all([
    vue.locator('.tippy-box[data-theme~="popover"] .option').filter({ hasText: new RegExp(`^${label}$`) }).last().click(),
    react.locator('.mona-panel-select-popover').getByRole('button', { name: label, exact: true }).click(),
  ])
}

async function openCanvasContextMenus(vue: Page, react: Page) {
  await Promise.all([
    vue.locator('.canvas').click({ button: 'right', position: { x: 40, y: 40 } }),
    react.getByRole('application', { name: 'Editable slide canvas' }).click({ button: 'right', position: { x: 40, y: 40 } }),
  ])
  await Promise.all([
    expect(vue.locator('.contextmenu')).toBeVisible(),
    expect(react.getByRole('menu', { name: 'Canvas menu' })).toBeVisible(),
  ])
}

const normalizedRect = (rect: { height: number; width: number; x: number; y: number } | null) => rect && ({
  height: Math.round(rect.height * 10) / 10,
  width: Math.round(rect.width * 10) / 10,
  x: Math.round(rect.x * 10) / 10,
  y: Math.round(rect.y * 10) / 10,
})

interface RasterParityTolerance {
  maxChannelDelta?: number
  maxExactPixelDelta?: number
  maxPerceptualPixelDelta?: number
}

function expectExactRasterParity(
  actual: Buffer,
  expected: Buffer,
  tolerance: RasterParityTolerance = {},
) {
  const actualImage = PNG.sync.read(actual)
  const expectedImage = PNG.sync.read(expected)
  expect({ height: actualImage.height, width: actualImage.width }).toEqual({
    height: expectedImage.height,
    width: expectedImage.width,
  })

  let exactPixelDelta = 0
  let maxChannelDelta = 0
  for (let offset = 0; offset < actualImage.data.length; offset += 4) {
    let pixelChanged = false
    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs(actualImage.data[offset + channel]! - expectedImage.data[offset + channel]!)
      if (delta) pixelChanged = true
      maxChannelDelta = Math.max(maxChannelDelta, delta)
    }
    if (pixelChanged) exactPixelDelta += 1
  }

  const perceptualPixelDelta = pixelmatch(
    actualImage.data,
    expectedImage.data,
    null,
    actualImage.width,
    actualImage.height,
    { includeAA: true, threshold: 0 },
  )
  expect(exactPixelDelta).toBeLessThanOrEqual(tolerance.maxExactPixelDelta ?? 0)
  expect(maxChannelDelta).toBeLessThanOrEqual(tolerance.maxChannelDelta ?? 0)
  expect(perceptualPixelDelta).toBeLessThanOrEqual(tolerance.maxPerceptualPixelDelta ?? 0)
}

async function expectLocatorRasterParity(
  testInfo: TestInfo,
  name: string,
  destination: Locator,
  source: Locator,
  tolerance?: RasterParityTolerance,
) {
  const destinationPath = testInfo.outputPath(`react-${name}.png`)
  const sourcePath = testInfo.outputPath(`vue-${name}.png`)
  const [destinationPixels, sourcePixels] = await Promise.all([
    destination.screenshot({ animations: 'disabled', caret: 'hide', path: destinationPath }),
    source.screenshot({ animations: 'disabled', caret: 'hide', path: sourcePath }),
  ])
  await Promise.all([
    testInfo.attach(`react-${name}.png`, { contentType: 'image/png', path: destinationPath }),
    testInfo.attach(`vue-${name}.png`, { contentType: 'image/png', path: sourcePath }),
  ])
  expectExactRasterParity(destinationPixels, sourcePixels, tolerance)
}

test('text inspector starts from the same handle, rich-text attributes, viewport, and chassis', async ({ browser }) => {
  const context = await browser.newContext()
  const { react, vue } = await openEditors(context)
  await selectTitle(vue, react)

  const [vueState, reactState, richText] = await Promise.all([
    vue.evaluate(() => window.__MONA_TEST__!.getState()),
    react.evaluate(() => window.__MONA_REACT_TEST__!.getState()),
    react.evaluate(() => window.__MONA_REACT_TEST__!.getRichTextState()),
  ])
  expect([...reactState.session.activeElementIds].sort()).toEqual([...vueState.editor.activeElementIdList].sort())
  expect(reactState.session.handleElementId).toBe(vueState.editor.handleElementId)
  expect(richText.elementId).toBe('gate3-title')
  expect(richText.attrs).toEqual(vueState.editor.richTextAttrs)

  const viewportMetrics = await Promise.all([
    vue.evaluate(() => ({ body: document.body.scrollHeight, inner: innerHeight, root: document.documentElement.scrollTop })),
    react.evaluate(() => ({ body: document.body.scrollHeight, inner: innerHeight, root: document.documentElement.scrollTop })),
  ])
  for (const metrics of viewportMetrics) {
    expect(metrics.root).toBe(0)
    expect(metrics.body - metrics.inner).toBeLessThanOrEqual(1)
  }

  const vuePanel = vue.locator('.toolbar')
  const reactPanel = react.locator('.mona-render-inspector')
  expect(normalizedRect(await reactPanel.boundingBox())).toEqual(normalizedRect(await vuePanel.boundingBox()))
  expect(normalizedRect(await react.locator('.mona-inspector-content').boundingBox())).toEqual(
    normalizedRect(await vue.locator('.toolbar > .content').boundingBox()),
  )

  const sourceTabLabels = await vue.locator('.toolbar > .tabs .tab').allTextContents()
  await expect(react.getByRole('tab')).toHaveText(sourceTabLabels)
  expect(await react.getByRole('tab').count()).toBe(await vue.locator('.toolbar > .tabs .tab').count())
  await context.close()
})

test('text inspector exposes the complete source control inventory', async ({ browser }) => {
  const context = await browser.newContext()
  const { react, vue } = await openEditors(context)
  await selectTitle(vue, react)

  expect(await react.locator('.mona-text-preset').allTextContents()).toEqual(
    await vue.locator('.preset-style-item').allTextContents(),
  )
  expect(await react.locator('.mona-text-preset').count()).toBe(6)
  expect(await react.locator('.mona-panel-select').count()).toBe(await vue.locator('.text-style-panel .select').count())
  expect(await react.locator('.mona-panel-button').count()).toBe(await vue.locator('.text-style-panel button.button').count())
  expect(await react.locator('.mona-panel-divider').count()).toBe(await vue.locator('.text-style-panel .divider.horizontal').count())
  await context.close()
})

test('text style inspector is pixel-identical to the source at the canonical viewport', async ({ browser }, testInfo) => {
  const context = await browser.newContext()
  const { react, vue } = await openEditors(context)
  await selectTitle(vue, react)
  await Promise.all([
    vue.evaluate(() => document.fonts.ready),
    react.evaluate(() => document.fonts.ready),
    vue.waitForTimeout(250),
    react.waitForTimeout(250),
  ])

  await expectLocatorRasterParity(testInfo, 'text-inspector', react.locator('.mona-render-inspector'), vue.locator('.toolbar'))
  await context.close()
})

test('all six preset styles execute the same shared commands and history boundaries', async ({ browser }) => {
  const context = await browser.newContext()
  const { react, vue } = await openEditors(context)
  await selectTitle(vue, react)
  const initialHistory = await Promise.all([historyState(vue, 'vue'), historyState(react, 'react')])
  expect(initialHistory[1]).toEqual(initialHistory[0])

  const vuePresets = vue.locator('.preset-style-item')
  const reactPresets = react.locator('.mona-text-preset')
  for (let index = 0; index < 6; index += 1) {
    await Promise.all([vuePresets.nth(index).click(), reactPresets.nth(index).click()])
    await expectTextDocumentParity(vue, react)
    await expect.poll(async () => {
      const [source, destination] = await Promise.all([
        vue.evaluate(() => window.__MONA_TEST__!.getState().editor.richTextAttrs),
        react.evaluate(() => window.__MONA_REACT_TEST__!.getRichTextState().attrs),
      ])
      return JSON.stringify(destination) === JSON.stringify(source)
    }).toBe(true)
    await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
    expect(await historyState(react, 'react')).toEqual(await historyState(vue, 'vue'))
  }
  expect((await historyState(react, 'react')).cursor).toBeGreaterThan(initialHistory[1].cursor)
  expect((await historyState(react, 'react')).length).toBeGreaterThan(initialHistory[1].length)
  await context.close()
})

test('font sizing, marks, block format, and all four alignments stay document- and state-identical', async ({ browser }) => {
  test.slow()
  const context = await browser.newContext()
  const { react, vue } = await openEditors(context)
  await selectTitle(vue, react)
  const sourceButtons = vue.locator('.text-style-panel button.button')
  const destinationButtons = react.locator('.mona-text-style-panel .mona-panel-button')
  const commandIndexes = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 16, 17, 18, 19]

  for (const index of commandIndexes) {
    await Promise.all([sourceButtons.nth(index).click(), destinationButtons.nth(index).click()])
    await expectTextDocumentParity(vue, react)
    await expect.poll(async () => {
      const [source, destination] = await Promise.all([
        vue.evaluate(() => window.__MONA_TEST__!.getState().editor.richTextAttrs),
        react.evaluate(() => window.__MONA_REACT_TEST__!.getRichTextState().attrs),
      ])
      return JSON.stringify(destination) === JSON.stringify(source)
    }).toBe(true)
    await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
    expect(await historyState(react, 'react')).toEqual(await historyState(vue, 'vue'))
  }
  await context.close()
})

test('font and spacing selectors preserve exact values, document output, and transaction history', async ({ browser }) => {
  const context = await browser.newContext()
  const { react, vue } = await openEditors(context)
  await selectTitle(vue, react)
  const cases = [
    { index: 0, label: 'Inter' },
    { index: 1, label: '32px' },
    { index: 2, label: '2×' },
    { index: 3, label: '20px' },
    { index: 4, label: '5px' },
  ]

  for (const item of cases) {
    await chooseInspectorSelect(vue, react, item.index, item.label)
    await expectTextDocumentParity(vue, react)
    await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
    expect(await historyState(react, 'react')).toEqual(await historyState(vue, 'vue'))
  }
  await context.close()
})

test('bullet, numbering, paragraph indent, and first-line indent popovers match source behavior', async ({ browser }) => {
  test.slow()
  const context = await browser.newContext()
  const { react, vue } = await openEditors(context)
  await selectTitle(vue, react)
  const sourceButtons = vue.locator('.text-style-panel button.button')
  const destinationButtons = react.locator('.mona-text-style-panel .mona-panel-button')

  const assertAfterAction = async () => {
    await expectTextDocumentParity(vue, react)
    await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
    expect(await historyState(react, 'react')).toEqual(await historyState(vue, 'vue'))
  }

  await Promise.all([sourceButtons.nth(20).click(), destinationButtons.nth(20).click()])
  await assertAfterAction()

  await Promise.all([
    sourceButtons.nth(21).click(),
    react.getByRole('button', { name: 'Bullet style' }).click(),
  ])
  await Promise.all([
    vue.locator('.tippy-box[data-theme~="popover"]:visible .list-wrap .list').nth(2).click(),
    react.getByRole('button', { name: 'Bullet style: square' }).click(),
  ])
  await assertAfterAction()

  await Promise.all([sourceButtons.nth(22).click(), destinationButtons.nth(22).click()])
  await assertAfterAction()

  await Promise.all([
    sourceButtons.nth(23).click(),
    react.getByRole('button', { name: 'Numbering style' }).click(),
  ])
  await Promise.all([
    vue.locator('.tippy-box[data-theme~="popover"]:visible .list-wrap .list').nth(2).click(),
    react.getByRole('button', { name: 'Numbering style: upper-roman' }).click(),
  ])
  await assertAfterAction()

  for (const [sourceIndex, destinationName, popoverItem] of [
    [24, 'Decrease paragraph indent', null],
    [25, 'Decrease first-line indent', 'Decrease first-line indent'],
    [26, 'Increase paragraph indent', null],
    [27, 'Increase first-line indent', 'Increase first-line indent'],
  ] as const) {
    if (popoverItem) {
      await Promise.all([
        sourceButtons.nth(sourceIndex).click(),
        react.getByRole('button', { name: destinationName }).click(),
      ])
      await Promise.all([
        vue.locator('.tippy-box[data-theme~="popover"]:visible .popover-menu-item').filter({ hasText: new RegExp(`^${popoverItem}$`) }).click(),
        react.locator('.mona-panel-popover-content').getByRole('button', { name: popoverItem }).click(),
      ])
    }
    else await Promise.all([sourceButtons.nth(sourceIndex).click(), destinationButtons.nth(sourceIndex).click()])
    await assertAfterAction()
  }
  await context.close()
})

test('text hyperlinks validate, apply, reopen, and remove with source-equivalent feedback', async ({ browser }) => {
  const context = await browser.newContext()
  const { react, vue } = await openEditors(context)
  await selectTitle(vue, react)
  const sourceLinkButton = vue.locator('.text-style-panel button.button').nth(15)
  const destinationLinkButton = react.getByRole('button', { name: 'Hyperlink' })

  await Promise.all([sourceLinkButton.click(), destinationLinkButton.click()])
  await Promise.all([
    vue.locator('.link-popover input').fill('not-a-link'),
    react.locator('.mona-text-link-popover input').fill('not-a-link'),
  ])
  await Promise.all([
    vue.locator('.link-popover .btns button').nth(1).click(),
    react.locator('.mona-text-link-popover').getByRole('button', { name: 'Confirm' }).click(),
  ])
  await expect(vue.locator('.message-wrap .description')).toHaveText('Enter a valid web address')
  await expect(react.locator('.mona-message-description')).toHaveText('Enter a valid web address')

  await Promise.all([
    vue.locator('.link-popover input').fill('https://example.com/slides'),
    react.locator('.mona-text-link-popover input').fill('https://example.com/slides'),
  ])
  await Promise.all([
    vue.locator('.link-popover .btns button').nth(1).click(),
    react.locator('.mona-text-link-popover').getByRole('button', { name: 'Confirm' }).click(),
  ])
  await expectTextDocumentParity(vue, react)
  await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
  expect(await historyState(react, 'react')).toEqual(await historyState(vue, 'vue'))

  await Promise.all([sourceLinkButton.click(), destinationLinkButton.click()])
  await expect(vue.locator('.link-popover input')).toHaveValue('https://example.com/slides')
  await expect(react.locator('.mona-text-link-popover input')).toHaveValue('https://example.com/slides')
  await Promise.all([
    vue.locator('.link-popover .btns button').nth(0).click(),
    react.locator('.mona-text-link-popover').getByRole('button', { name: 'Remove' }).click(),
  ])
  await expectTextDocumentParity(vue, react)
  await context.close()
})

test('single-use and persistent text format painter state and application match Vue', async ({ browser }) => {
  test.slow()
  const context = await browser.newContext()
  const { react, vue } = await openEditors(context)
  await selectTitle(vue, react)
  const sourcePainter = vue.locator('.text-style-panel button.button').nth(14)
  const destinationPainter = react.getByRole('button', { name: 'Format painter (double-click to keep using)' })

  await Promise.all([sourcePainter.click(), destinationPainter.click()])
  await expect.poll(async () => Promise.all([
    vue.evaluate(() => Boolean(window.__MONA_TEST__!.getState().editor.textFormatPainter)),
    react.evaluate(() => Boolean(window.__MONA_REACT_TEST__!.getRichTextState().formatPainter)),
  ])).toEqual([true, true])
  expect(await react.evaluate(() => window.__MONA_REACT_TEST__!.getRichTextState().formatPainter)).toEqual(
    await vue.evaluate(() => window.__MONA_TEST__!.getState().editor.textFormatPainter),
  )

  await Promise.all([
    vue.locator('.thumbnail-slide').nth(4).click(),
    react.getByRole('button', { name: 'Show slide 5' }).click(),
  ])
  const sourceTarget = vue.locator('#editable-element-gate4-horizontal-text .editable-element-text')
  const destinationTarget = react.locator('.mona-editor-slide-canvas [data-element-id="gate4-horizontal-text"] .mona-text-content')
  await Promise.all([
    sourceTarget.click({ position: { x: 25, y: 15 } }),
    destinationTarget.click({ position: { x: 25, y: 15 } }),
  ])
  await expect.poll(async () => {
    const [source, destination] = await Promise.all([
      vue.evaluate(() => window.__MONA_TEST__!.getState().editor.textFormatPainter),
      react.evaluate(() => window.__MONA_REACT_TEST__!.getRichTextState().formatPainter),
    ])
    return source === null && destination === null
  }).toBe(true)
  await expect.poll(async () => {
    const [source, destination] = await Promise.all([
      textElementOnSlide(vue, 'vue', 4, 'gate4-horizontal-text'),
      textElementOnSlide(react, 'react', 4, 'gate4-horizontal-text'),
    ])
    return JSON.stringify(destination) === JSON.stringify(source)
  }).toBe(true)

  await Promise.all([
    vue.locator('.thumbnail-slide').first().click(),
    react.getByRole('button', { name: 'Show slide 1' }).click(),
  ])
  await selectTitle(vue, react)
  await Promise.all([
    vue.locator('.text-style-panel button.button').nth(14).dblclick(),
    react.getByRole('button', { name: 'Format painter (double-click to keep using)' }).dblclick(),
  ])
  await expect.poll(async () => Promise.all([
    vue.evaluate(() => window.__MONA_TEST__!.getState().editor.textFormatPainter?.keep),
    react.evaluate(() => window.__MONA_REACT_TEST__!.getRichTextState().formatPainter?.keep),
  ])).toEqual([true, true])

  await Promise.all([
    vue.locator('.thumbnail-slide').nth(4).click(),
    react.getByRole('button', { name: 'Show slide 5' }).click(),
  ])
  await Promise.all([
    vue.locator('#editable-element-gate4-horizontal-text .editable-element-text').click({ position: { x: 25, y: 15 } }),
    react.locator('.mona-editor-slide-canvas [data-element-id="gate4-horizontal-text"] .mona-text-content').click({ position: { x: 25, y: 15 } }),
  ])
  await expect.poll(async () => Promise.all([
    vue.evaluate(() => window.__MONA_TEST__!.getState().editor.textFormatPainter?.keep),
    react.evaluate(() => window.__MONA_REACT_TEST__!.getRichTextState().formatPainter?.keep),
  ])).toEqual([true, true])
  await Promise.all([
    vue.locator('.text-style-panel button.button').nth(14).click(),
    react.getByRole('button', { name: 'Format painter (double-click to keep using)' }).click(),
  ])
  await expect.poll(async () => Promise.all([
    vue.evaluate(() => window.__MONA_TEST__!.getState().editor.textFormatPainter),
    react.evaluate(() => window.__MONA_REACT_TEST__!.getRichTextState().formatPainter),
  ])).toEqual([null, null])
  await context.close()
})

test('clear formatting removes every source mark and block style with identical history', async ({ browser }) => {
  const context = await browser.newContext()
  const { react, vue } = await openEditors(context)
  await selectTitle(vue, react)
  const sourceButtons = vue.locator('.text-style-panel button.button')
  const destinationButtons = react.locator('.mona-text-style-panel .mona-panel-button')

  for (const index of [4, 5, 6, 7, 8, 10, 11, 17, 20]) {
    await Promise.all([sourceButtons.nth(index).click(), destinationButtons.nth(index).click()])
    await expectTextDocumentParity(vue, react)
  }
  await Promise.all([sourceButtons.nth(13).click(), destinationButtons.nth(13).click()])
  await expectTextDocumentParity(vue, react)
  await expect.poll(async () => {
    const [source, destination] = await Promise.all([
      vue.evaluate(() => window.__MONA_TEST__!.getState().editor.richTextAttrs),
      react.evaluate(() => window.__MONA_REACT_TEST__!.getRichTextState().attrs),
    ])
    return JSON.stringify(destination) === JSON.stringify(source)
  }).toBe(true)
  expect(await historyState(react, 'react')).toEqual(await historyState(vue, 'vue'))
  await context.close()
})

test('foreground, highlight, and text-box fill use the complete source picker and exact color values', async ({ browser }) => {
  test.slow()
  const context = await browser.newContext()
  const { react, vue } = await openEditors(context)
  await selectTitle(vue, react)
  const sourceButtons = vue.locator('.text-style-panel button.button')

  await Promise.all([
    sourceButtons.nth(0).click(),
    react.getByRole('button', { name: 'Text color' }).click(),
  ])
  await Promise.all([
    expect(vue.locator('.tippy-box[data-theme~="popover"]:visible .color-picker')).toBeVisible(),
    expect(react.locator('.mona-panel-popover-content .mona-color-picker')).toBeVisible(),
  ])
  expect(await react.locator('.mona-color-picker-swatch').count()).toBe(
    await vue.locator('.tippy-box[data-theme~="popover"]:visible .picker-presets-color, .tippy-box[data-theme~="popover"]:visible .picker-gradient-color').count(),
  )
  await Promise.all([
    vue.locator('.tippy-box[data-theme~="popover"]:visible .picker-presets').first().locator('.picker-presets-color').nth(5).click(),
    react.getByRole('button', { name: 'Select color #e2534d' }).click(),
  ])
  await expectTextDocumentParity(vue, react)
  await Promise.all([sourceButtons.nth(0).click(), react.getByRole('button', { name: 'Text color' }).click()])

  await Promise.all([
    sourceButtons.nth(1).click(),
    react.getByRole('button', { name: 'Text highlight' }).click(),
  ])
  await Promise.all([
    vue.locator('.tippy-box[data-theme~="popover"]:visible .picker-field .transparent').last().click(),
    react.getByRole('button', { name: 'Transparent' }).click(),
  ])
  await expectTextDocumentParity(vue, react)
  await Promise.all([sourceButtons.nth(1).click(), react.getByRole('button', { name: 'Text highlight' }).click()])

  await Promise.all([
    sourceButtons.nth(28).click(),
    react.getByRole('button', { name: 'Text box fill:' }).click(),
  ])
  await Promise.all([
    vue.locator('.tippy-box[data-theme~="popover"]:visible').last().locator('.picker-presets').first().locator('.picker-presets-color').nth(8).click(),
    react.getByRole('button', { name: 'Select color #47acc5' }).click(),
  ])
  await expectTextDocumentParity(vue, react)
  await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
  expect(await historyState(react, 'react')).toEqual(await historyState(vue, 'vue'))
  await context.close()
})

test('custom color saturation, hue, alpha, hex input, and recent-color cache match Vue', async ({ browser }) => {
  test.slow()
  const context = await browser.newContext()
  const { react, vue } = await openEditors(context)
  await selectTitle(vue, react)
  await Promise.all([
    vue.locator('.text-style-panel button.button').nth(0).click(),
    react.getByRole('button', { name: 'Text color' }).click(),
  ])

  await Promise.all([
    vue.locator('.tippy-box[data-theme~="popover"]:visible .input-content').fill('33669980'),
    react.getByRole('textbox', { name: 'Hex color' }).fill('33669980'),
  ])
  await expectTextDocumentParity(vue, react)
  await expect(react.getByRole('slider', { name: 'Color saturation and brightness' })).toBeVisible()

  const clickAtRatio = async (source: ReturnType<Page['locator']>, destination: ReturnType<Page['locator']>, xRatio: number, yRatio: number) => {
    const [sourceRect, destinationRect] = await Promise.all([source.boundingBox(), destination.boundingBox()])
    expect(sourceRect).not.toBeNull()
    expect(destinationRect).not.toBeNull()
    await Promise.all([
      source.click({ position: { x: Math.floor(sourceRect!.width * xRatio), y: Math.floor(sourceRect!.height * yRatio) } }),
      destination.click({ position: { x: Math.floor(destinationRect!.width * xRatio), y: Math.floor(destinationRect!.height * yRatio) } }),
    ])
  }

  await clickAtRatio(
    vue.locator('.tippy-box[data-theme~="popover"]:visible .saturation'),
    react.getByRole('slider', { name: 'Color saturation and brightness' }),
    0.35,
    0.25,
  )
  await expectTextDocumentParity(vue, react)

  const [sourceHueMetrics, destinationHueMetrics] = await Promise.all([
    vue.locator('.tippy-box[data-theme~="popover"]:visible .hue-container').evaluate(element => ({
      clientWidth: element.clientWidth,
      left: element.getBoundingClientRect().left,
      width: element.getBoundingClientRect().width,
    })),
    react.getByRole('slider', { name: 'Color hue' }).evaluate(element => ({
      clientWidth: element.clientWidth,
      left: element.getBoundingClientRect().left,
      width: element.getBoundingClientRect().width,
    })),
  ])
  expect(destinationHueMetrics.clientWidth).toBe(sourceHueMetrics.clientWidth)

  await clickAtRatio(
    vue.locator('.tippy-box[data-theme~="popover"]:visible .hue-container'),
    react.getByRole('slider', { name: 'Color hue' }),
    0.72,
    0.5,
  )
  await expectTextDocumentParity(vue, react)

  await clickAtRatio(
    vue.locator('.tippy-box[data-theme~="popover"]:visible .alpha-container'),
    react.getByRole('slider', { name: 'Color opacity' }),
    0.42,
    0.5,
  )
  await expectTextDocumentParity(vue, react)
  await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])

  const [sourceRecent, destinationRecent, sourceCache, destinationCache] = await Promise.all([
    vue.locator('.tippy-box[data-theme~="popover"]:visible .picker-presets-color.alpha .picker-presets-color-content').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).backgroundColor)),
    react.locator('.mona-color-picker-recent-title + .mona-color-picker-presets .mona-color-picker-swatch').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).backgroundColor)),
    vue.evaluate(() => localStorage.getItem('RECENT_COLORS')),
    react.evaluate(() => localStorage.getItem('RECENT_COLORS')),
  ])
  expect(destinationRecent).toEqual(sourceRecent)
  expect(destinationCache).toBe(sourceCache)
  expect(await historyState(react, 'react')).toEqual(await historyState(vue, 'vue'))
  await context.close()
})

test('native eyedropper activation, sampled value, feedback, and recent cache match Vue', async ({ browser }) => {
  const context = await browser.newContext()
  await context.addInitScript(() => {
    Object.defineProperty(window, 'EyeDropper', {
      configurable: true,
      value: class {
        open() {
          return new Promise(resolve => setTimeout(() => resolve({ sRGBHex: '#2468ac' }), 250))
        }
      },
    })
  })
  const { react, vue } = await openEditors(context)
  await selectTitle(vue, react)
  await Promise.all([
    vue.locator('.text-style-panel button.button').nth(0).click(),
    react.getByRole('button', { name: 'Text color' }).click(),
  ])
  await Promise.all([
    vue.locator('.tippy-box[data-theme~="popover"]:visible .straw').click(),
    react.getByRole('button', { name: 'Eyedropper' }).click(),
  ])
  await Promise.all([
    expect(vue.locator('.message-wrap .description')).toHaveText('Press Esc to close the eyedropper'),
    expect(react.locator('.mona-message-description')).toHaveText('Press Esc to close the eyedropper'),
  ])
  await expectTextDocumentParity(vue, react)
  await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
  expect(await react.evaluate(() => localStorage.getItem('RECENT_COLORS'))).toBe(
    await vue.evaluate(() => localStorage.getItem('RECENT_COLORS')),
  )
  await context.close()
})

test('custom canvas eyedropper fallback samples the rendered slide and cleans up like Vue', async ({ browser }) => {
  test.slow()
  const context = await browser.newContext()
  await context.addInitScript(() => {
    Reflect.deleteProperty(window, 'EyeDropper')
  })
  const { react, vue } = await openEditors(context)
  await selectTitle(vue, react)
  await Promise.all([
    vue.locator('.text-style-panel button.button').nth(0).click(),
    react.getByRole('button', { name: 'Text color' }).click(),
  ])
  await Promise.all([
    vue.locator('.tippy-box[data-theme~="popover"]:visible .straw').click(),
    react.getByRole('button', { name: 'Eyedropper' }).click(),
  ])

  const sourceCanvas = vue.locator('body > div[style*="z-index: 9999"] canvas')
  const destinationCanvas = react.locator('.mona-color-picker-eyedropper-mask .mona-color-picker-eyedropper-canvas')
  await Promise.all([
    expect(sourceCanvas).toBeVisible({ timeout: 20_000 }),
    expect(destinationCanvas).toBeVisible({ timeout: 20_000 }),
  ])
  const findFixtureBackground = (element: HTMLCanvasElement) => {
    const context = element.getContext('2d')!
    const pixels = context.getImageData(0, 0, element.width, element.height).data
    for (let y = 0; y < element.height; y += 2) {
      for (let x = 0; x < element.width; x += 2) {
        const index = ((y * element.width) + x) * 4
        if (pixels[index] === 247 && pixels[index + 1] === 243 && pixels[index + 2] === 235 && pixels[index + 3] === 255) {
          return { x, y }
        }
      }
    }
    return null
  }
  const [sourcePoint, destinationPoint, sourceCanvasRect, destinationCanvasRect] = await Promise.all([
    sourceCanvas.evaluate(findFixtureBackground),
    destinationCanvas.evaluate(findFixtureBackground),
    sourceCanvas.boundingBox(),
    destinationCanvas.boundingBox(),
  ])
  expect(sourcePoint).not.toBeNull()
  expect(destinationPoint).not.toBeNull()
  expect(sourceCanvasRect).not.toBeNull()
  expect(destinationCanvasRect).not.toBeNull()
  await Promise.all([
    vue.mouse.move(sourceCanvasRect!.x + sourcePoint!.x, sourceCanvasRect!.y + sourcePoint!.y),
    react.mouse.move(destinationCanvasRect!.x + destinationPoint!.x, destinationCanvasRect!.y + destinationPoint!.y),
  ])
  await Promise.all([
    vue.mouse.down(),
    react.mouse.down(),
  ])
  await Promise.all([
    vue.mouse.up(),
    react.mouse.up(),
  ])
  await expectTextDocumentParity(vue, react)
  await Promise.all([
    expect(vue.locator('body > div[style*="z-index: 9999"]')).toHaveCount(0),
    expect(react.locator('.mona-color-picker-eyedropper-mask')).toHaveCount(0),
  ])
  await context.close()
})

test('AI writing sends the source request and applies cumulative streaming replacements', async ({ browser }) => {
  test.slow()
  const context = await browser.newContext()
  await context.addInitScript(() => {
    const originalFetch = window.fetch.bind(window)
    window.__MONA_AI_WRITING_REQUESTS__ = []
    window.fetch = (input, init) => {
      if (String(input).includes('/api/tools/ai_writing')) {
        window.__MONA_AI_WRITING_REQUESTS__!.push(JSON.parse(String(init?.body || '{}')) as Record<string, unknown>)
        const encoder = new TextEncoder()
        return Promise.resolve(new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('Polished deck'))
            setTimeout(() => controller.enqueue(encoder.encode('\nwith editable visuals')), 900)
            setTimeout(() => controller.close(), 1_100)
          },
        }), { headers: { 'Content-Type': 'application/octet-stream' } }))
      }
      return originalFetch(input, init)
    }
  })
  const { react, vue } = await openEditors(context)
  await selectTitle(vue, react)
  await Promise.all([
    vue.locator('.text-style-panel button.button').nth(12).click(),
    react.getByRole('button', { name: 'AI assist' }).click(),
  ])
  await Promise.all([
    vue.locator('.tippy-box[data-theme~="popover"]:visible .popover-menu-item').filter({ hasText: /^Polish$/ }).click(),
    react.locator('.mona-ai-writing-menu').getByRole('button', { name: 'Polish' }).click(),
  ])

  await expect.poll(async () => Promise.all([
    vue.evaluate(() => window.__MONA_AI_WRITING_REQUESTS__?.length),
    react.evaluate(() => window.__MONA_AI_WRITING_REQUESTS__?.length),
  ])).toEqual([1, 1])
  expect(await react.evaluate(() => window.__MONA_AI_WRITING_REQUESTS__![0])).toEqual(
    await vue.evaluate(() => window.__MONA_AI_WRITING_REQUESTS__![0]),
  )
  expect(await react.evaluate(() => window.__MONA_AI_WRITING_REQUESTS__![0])).toMatchObject({
    command: 'Polish and rewrite',
    model: 'glm-4.7-flash',
    stream: true,
  })
  await Promise.all([
    expect(vue.locator('.ai-loading')).toBeVisible(),
    expect(react.locator('.mona-ai-writing-loading')).toBeVisible(),
  ])
  await expect.poll(async () => {
    const [source, destination] = await Promise.all([textElement(vue, 'vue'), textElement(react, 'react')])
    return source.content.includes('Polished deck')
      && !source.content.includes('with editable visuals')
      && destination.content === source.content
  }).toBe(true)
  await expect.poll(async () => {
    const [source, destination] = await Promise.all([textElement(vue, 'vue'), textElement(react, 'react')])
    return source.content.includes('with editable visuals') && destination.content === source.content
  }).toBe(true)
  await expectTextDocumentParity(vue, react)
  await Promise.all([
    expect(vue.locator('.ai-loading')).toHaveCount(0),
    expect(react.locator('.mona-ai-writing-loading')).toHaveCount(0),
  ])
  expect(await historyState(react, 'react')).toEqual(await historyState(vue, 'vue'))
  await context.close()
})

test('AI writing busy feedback and element-change stream cancellation match Vue', async ({ browser }) => {
  test.slow()
  const busyContext = await browser.newContext()
  await busyContext.addInitScript(() => {
    const originalFetch = window.fetch.bind(window)
    window.fetch = (input, init) => String(input).includes('/api/tools/ai_writing')
      ? Promise.resolve(new Response(JSON.stringify({ state: -1 }), { headers: { 'Content-Type': 'application/json' } }))
      : originalFetch(input, init)
  })
  const busyEditors = await openEditors(busyContext)
  await selectTitle(busyEditors.vue, busyEditors.react)
  const originalDocuments = await Promise.all([textElement(busyEditors.vue, 'vue'), textElement(busyEditors.react, 'react')])
  await Promise.all([
    busyEditors.vue.locator('.text-style-panel button.button').nth(12).click(),
    busyEditors.react.getByRole('button', { name: 'AI assist' }).click(),
  ])
  await Promise.all([
    busyEditors.vue.locator('.tippy-box[data-theme~="popover"]:visible .popover-menu-item').filter({ hasText: /^Expand$/ }).click(),
    busyEditors.react.locator('.mona-ai-writing-menu').getByRole('button', { name: 'Expand' }).click(),
  ])
  await Promise.all([
    expect(busyEditors.vue.locator('.message-wrap .description')).toHaveText('The selected model is at its concurrency limit. Try another model.'),
    expect(busyEditors.react.locator('.mona-message-description')).toHaveText('The selected model is at its concurrency limit. Try another model.'),
  ])
  expect(await textElement(busyEditors.react, 'react')).toEqual(originalDocuments[1])
  expect(await textElement(busyEditors.vue, 'vue')).toEqual(originalDocuments[0])
  await busyContext.close()

  const streamContext = await browser.newContext()
  await streamContext.addInitScript(() => {
    const originalFetch = window.fetch.bind(window)
    window.fetch = (input, init) => {
      if (String(input).includes('/api/tools/ai_writing')) {
        const encoder = new TextEncoder()
        return Promise.resolve(new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('First streamed result'))
            setTimeout(() => controller.enqueue(encoder.encode(' that must be cancelled')), 400)
            setTimeout(() => controller.close(), 550)
          },
        }), { headers: { 'Content-Type': 'application/octet-stream' } }))
      }
      return originalFetch(input, init)
    }
  })
  const streamEditors = await openEditors(streamContext)
  await selectTitle(streamEditors.vue, streamEditors.react)
  await Promise.all([
    streamEditors.vue.locator('.text-style-panel button.button').nth(12).click(),
    streamEditors.react.getByRole('button', { name: 'AI assist' }).click(),
  ])
  await Promise.all([
    streamEditors.vue.locator('.tippy-box[data-theme~="popover"]:visible .popover-menu-item').filter({ hasText: /^Condense$/ }).click(),
    streamEditors.react.locator('.mona-ai-writing-menu').getByRole('button', { name: 'Condense' }).click(),
  ])
  await expect.poll(async () => Promise.all([
    (await textElement(streamEditors.vue, 'vue')).content.includes('First streamed result'),
    (await textElement(streamEditors.react, 'react')).content.includes('First streamed result'),
  ])).toEqual([true, true])
  await Promise.all([
    streamEditors.vue.locator('.thumbnail-slide').nth(4).click(),
    streamEditors.react.getByRole('button', { name: 'Show slide 5' }).click(),
  ])
  await Promise.all([streamEditors.vue.waitForTimeout(700), streamEditors.react.waitForTimeout(700)])
  const [sourceCancelled, destinationCancelled] = await Promise.all([
    textElementOnSlide(streamEditors.vue, 'vue', 0, 'gate3-title'),
    textElementOnSlide(streamEditors.react, 'react', 0, 'gate3-title'),
  ])
  expect(destinationCancelled).toEqual(sourceCancelled)
  expect(sourceCancelled.content).toContain('First streamed result')
  expect(sourceCancelled.content).not.toContain('that must be cancelled')
  await streamContext.close()
})

test('text insets, fixed height, vertical alignment, outline, shadow, and opacity match source transactions', async ({ browser }) => {
  test.slow()
  const context = await browser.newContext()
  const { react, vue } = await openEditors(context)
  await selectTitle(vue, react)

  const sourceInsets = vue.locator('.text-style-panel:visible > .row .number-input')
  for (const [index, label, initialValue, value] of [
    [0, 'Top margin', 6, 12],
    [1, 'Bottom margin', 6, 14],
    [2, 'Left margin', 10, 16],
    [3, 'Right margin', 10, 18],
  ] as const) {
    const sourceNumber = sourceInsets.nth(index)
    const destinationNumber = react.getByRole('textbox', { name: label }).locator('..').locator('..')
    await Promise.all([
      sourceNumber.scrollIntoViewIfNeeded(),
      destinationNumber.scrollIntoViewIfNeeded(),
    ])
    await Promise.all([
      sourceNumber.hover(),
      destinationNumber.hover(),
    ])
    for (let step = initialValue; step < value; step += 1) {
      await Promise.all([
        sourceNumber.locator('.handler').nth(0).click(),
        destinationNumber.locator('.mona-panel-number-handlers button').nth(0).click(),
      ])
    }
    await expectTextElementAndHistoryParity(vue, react)
  }

  await Promise.all([
    vue.locator('.text-style-panel .switch').nth(0).click(),
    react.getByRole('switch', { name: 'Fixed height' }).click(),
  ])
  await expectTextElementAndHistoryParity(vue, react)
  await Promise.all([
    vue.locator('.text-style-panel .switch').nth(0).click(),
    react.getByRole('switch', { name: 'Fixed height' }).click(),
  ])
  await expectTextElementAndHistoryParity(vue, react)
  await Promise.all([
    vue.locator('.text-style-panel > .radio-group button.button').nth(2).click(),
    react.getByRole('button', { name: 'Align bottom' }).click(),
  ])
  await expectTextElementAndHistoryParity(vue, react)

  await Promise.all([
    vue.locator('.element-outline .switch').click(),
    react.getByRole('switch', { name: 'Enable border' }).click(),
  ])
  await expectTextElementAndHistoryParity(vue, react)
  await Promise.all([
    vue.locator('.element-outline .select').click(),
    react.getByRole('button', { name: 'Border style' }).click(),
  ])
  await Promise.all([
    vue.locator('.tippy-box[data-theme~="popover"]:visible .option').nth(2).click(),
    react.locator('.mona-panel-select-popover').getByRole('button', { name: 'Dotted' }).click(),
  ])
  await expectTextElementAndHistoryParity(vue, react)
  await Promise.all([
    vue.locator('.element-outline .row').nth(2).locator('.color-btn').click(),
    react.getByRole('button', { name: 'Border color' }).click(),
  ])
  await Promise.all([
    vue.locator('.tippy-box[data-theme~="popover"]:visible .picker-presets').first().locator('.picker-presets-color').nth(3).click(),
    react.getByRole('button', { name: 'Select color #1e497b' }).click(),
  ])
  await expectTextElementAndHistoryParity(vue, react)
  await Promise.all([
    vue.locator('.element-outline .number-input input').fill('6'),
    react.getByRole('textbox', { name: 'Border width' }).fill('6'),
  ])
  await Promise.all([
    vue.locator('.element-outline .number-input input').press('Enter'),
    react.getByRole('textbox', { name: 'Border width' }).press('Enter'),
  ])
  await Promise.all([
    vue.locator('.element-outline .number-input input').blur(),
    react.getByRole('textbox', { name: 'Border width' }).blur(),
  ])
  await expectTextElementAndHistoryParity(vue, react)

  await Promise.all([
    vue.locator('.element-shadow .switch').click(),
    react.getByRole('switch', { name: 'Enable shadow' }).click(),
  ])
  await expectTextElementAndHistoryParity(vue, react)

  const dragSlider = async (source: ReturnType<Page['locator']>, destination: ReturnType<Page['locator']>, ratio: number) => {
    const [sourceRect, destinationRect] = await Promise.all([source.boundingBox(), destination.boundingBox()])
    expect(sourceRect).not.toBeNull()
    expect(destinationRect).not.toBeNull()
    await Promise.all([
      source.click({ position: { x: Math.floor(sourceRect!.width * ratio), y: Math.floor(sourceRect!.height / 2) } }),
      destination.click({ position: { x: Math.floor(destinationRect!.width * ratio), y: Math.floor(destinationRect!.height / 2) } }),
    ])
  }
  for (const [index, label, ratio] of [
    [0, 'Horizontal shadow', 0.75],
    [1, 'Vertical shadow', 0.25],
    [2, 'Blur radius', 0.6],
  ] as const) {
    await dragSlider(
      vue.locator('.element-shadow .slider').nth(index),
      react.getByRole('slider', { name: label }),
      ratio,
    )
    await expectTextElementAndHistoryParity(vue, react)
  }
  await Promise.all([
    vue.locator('.element-shadow .row').nth(4).locator('.color-btn').click(),
    react.getByRole('button', { name: 'Shadow color' }).click(),
  ])
  await Promise.all([
    vue.locator('.tippy-box[data-theme~="popover"]:visible .picker-presets').first().locator('.picker-presets-color').nth(7).click(),
    react.getByRole('button', { name: 'Select color #8165a0' }).click(),
  ])
  await expectTextElementAndHistoryParity(vue, react)

  await dragSlider(
    vue.locator('.element-opacity .slider'),
    react.getByRole('slider', { exact: true, name: 'Opacity:' }),
    0.4,
  )
  await expectTextElementAndHistoryParity(vue, react)
  await context.close()
})

test('text shadow toggle owns the same standalone history boundary', async ({ browser }) => {
  const context = await browser.newContext()
  const { react, vue } = await openEditors(context)
  await selectTitle(vue, react)
  expect(await historyState(react, 'react')).toEqual(await historyState(vue, 'vue'))
  await Promise.all([
    vue.locator('.element-shadow .switch').click(),
    react.getByRole('switch', { name: 'Enable shadow' }).click(),
  ])
  await expectTextDocumentParity(vue, react)
  await Promise.all([vue.waitForTimeout(1_000), react.waitForTimeout(1_000)])
  expect(await historyState(react, 'react')).toEqual(await historyState(vue, 'vue'))
  await context.close()
})

test('toolbar tabs and complete text position-panel chassis match source geometry and control state', async ({ browser }) => {
  const context = await browser.newContext()
  const { react, vue } = await openEditors(context)
  await selectTitle(vue, react)

  const sourceTabs = vue.locator('.toolbar .tabs.card .tab')
  const destinationTabs = react.getByRole('tab')
  expect(await destinationTabs.allTextContents()).toEqual(await sourceTabs.allTextContents())
  expect(await destinationTabs.count()).toBe(await sourceTabs.count())
  for (let index = 0; index < await sourceTabs.count(); index++) {
    expect(normalizedRect(await destinationTabs.nth(index).boundingBox())).toEqual(normalizedRect(await sourceTabs.nth(index).boundingBox()))
  }

  await openPositionPanel(vue, react)
  const sourcePanel = vue.locator('.element-positopn-panel')
  const destinationPanel = react.locator('.mona-element-position-panel')

  const sourceButtons = sourcePanel.locator('.button')
  const destinationButtons = destinationPanel.locator('.mona-panel-button')
  expect(await destinationButtons.count()).toBe(await sourceButtons.count())
  for (let index = 0; index < await sourceButtons.count(); index++) {
    expect(normalizedRect(await destinationButtons.nth(index).boundingBox())).toEqual(normalizedRect(await sourceButtons.nth(index).boundingBox()))
  }

  const sourceNumbers = sourcePanel.locator('.number-input')
  const destinationNumbers = destinationPanel.locator('.mona-panel-number')
  expect(await destinationNumbers.count()).toBe(await sourceNumbers.count())
  for (let index = 0; index < await sourceNumbers.count(); index++) {
    expect(await destinationNumbers.nth(index).boundingBox()).toEqual(await sourceNumbers.nth(index).boundingBox())
  }
  expect(normalizedRect(await destinationPanel.boundingBox())).toEqual(normalizedRect(await sourcePanel.boundingBox()))
  expect(await destinationNumbers.locator('input').evaluateAll(inputs => inputs.map(input => ({ disabled: (input as HTMLInputElement).disabled, value: (input as HTMLInputElement).value })))).toEqual(
    await sourceNumbers.locator('input').evaluateAll(inputs => inputs.map(input => ({ disabled: (input as HTMLInputElement).disabled, value: (input as HTMLInputElement).value }))),
  )
  expect(await destinationNumbers.evaluateAll(elements => elements.map(element => {
    const style = getComputedStyle(element)
    return { backgroundColor: style.backgroundColor, border: style.border, borderRadius: style.borderRadius }
  }))).toEqual(await sourceNumbers.evaluateAll(elements => elements.map(element => {
    const style = getComputedStyle(element)
    return { backgroundColor: style.backgroundColor, border: style.border, borderRadius: style.borderRadius }
  })))
  await context.close()
})

test('text position inspector matches source with bounded corner compositing', async ({ browser }, testInfo) => {
  const context = await browser.newContext()
  const { react, vue } = await openEditors(context)
  await selectTitle(vue, react)
  await openPositionPanel(vue, react)
  await Promise.all([
    vue.evaluate(() => document.fonts.ready),
    react.evaluate(() => document.fonts.ready),
    vue.waitForTimeout(100),
    react.waitForTimeout(100),
  ])
  // The five number-input boxes are raw-geometry and computed-style identical
  // above. Across separate Chromium trees, four rounded input corners resolve
  // 16 antialias samples by at most two channels; the helper's strict
  // threshold-zero pixelmatch count is pinned to those same samples.
  await expectLocatorRasterParity(testInfo, 'text-position-inspector', react.locator('.mona-render-inspector'), vue.locator('.toolbar'), {
    maxChannelDelta: 2,
    maxExactPixelDelta: 16,
    maxPerceptualPixelDelta: 16,
  })
  await context.close()
})

test('position panel preserves every layer, canvas-alignment, coordinate, size, and rotation transaction', async ({ browser }) => {
  test.slow()
  const context = await browser.newContext()
  const { react, vue } = await openEditors(context)
  await selectTitle(vue, react)
  await openPositionPanel(vue, react)
  const sourcePanel = vue.locator('.element-positopn-panel')
  const destinationPanel = react.locator('.mona-element-position-panel')
  const sourceButtons = sourcePanel.locator('.button')
  const destinationButtons = destinationPanel.locator('.mona-panel-button')

  for (const index of [2, 3, 0, 1, 4, 5, 6, 7, 8, 9]) {
    await Promise.all([sourceButtons.nth(index).click(), destinationButtons.nth(index).click()])
    await expectCurrentSlideAndHistoryParity(vue, react)
  }

  const sourceInputs = sourcePanel.locator('.number-input input')
  const destinationInputs = destinationPanel.locator('.mona-panel-number input')
  for (const [index, value] of [[0, '415'], [1, '95'], [2, '605'], [3, '145'], [4, '17']] as const) {
    await Promise.all([sourceInputs.nth(index).fill(value), destinationInputs.nth(index).fill(value)])
    await Promise.all([sourceInputs.nth(index).press('Enter'), destinationInputs.nth(index).press('Enter')])
    await expectCurrentSlideAndHistoryParity(vue, react)
  }

  const sourceRotationButtons = sourcePanel.locator('.text-btn')
  for (const [index, name] of [[0, 'Rotate counterclockwise 45 degrees'], [1, 'Rotate clockwise 45 degrees']] as const) {
    await Promise.all([
      sourceRotationButtons.nth(index).click(),
      destinationPanel.getByRole('button', { name }).click(),
    ])
    await expectCurrentSlideAndHistoryParity(vue, react)
  }
  await context.close()
})

test('animation panel and complete shared effect pool match source inventory, labels, geometry, and mask lifecycle', async ({ browser }) => {
  const context = await browser.newContext()
  const { react, vue } = await openEditors(context)
  await selectTitle(vue, react)
  await openAnimationPanel(vue, react)

  const sourcePanel = vue.locator('.element-animation-panel')
  const destinationPanel = react.locator('.mona-element-animation-panel')
  expect(normalizedRect(await destinationPanel.boundingBox())).toEqual(normalizedRect(await sourcePanel.boundingBox()))
  expect(normalizedRect(await react.getByRole('button', { name: 'Add animation', exact: true }).boundingBox())).toEqual(
    normalizedRect(await vue.locator('.element-animation-btn').boundingBox()),
  )

  const { destinationPool, sourcePool } = await openAnimationPool(vue, react, false)
  expect(normalizedRect(await destinationPool.boundingBox())).toEqual(normalizedRect(await sourcePool.boundingBox()))
  const sourcePoolTabs = vue.locator('.tippy-box[data-theme~="popover"]:visible .tabs .tab')
  const destinationPoolTabs = react.locator('.mona-animation-popover:visible .mona-animation-pool-tabs [role="tab"]')
  expect(await destinationPoolTabs.allTextContents()).toEqual(await sourcePoolTabs.allTextContents())
  for (let index = 0; index < await sourcePoolTabs.count(); index++) {
    expect(normalizedRect(await destinationPoolTabs.nth(index).boundingBox())).toEqual(normalizedRect(await sourcePoolTabs.nth(index).boundingBox()))
  }
  expect(await destinationPool.locator('.mona-animation-pool-mask').count()).toBe(await sourcePool.locator('.mask').count())
  await Promise.all([vue.waitForTimeout(850), react.waitForTimeout(850)])
  expect(await destinationPool.locator('.mona-animation-pool-title').allTextContents()).toEqual(await sourcePool.locator('.type-title').allTextContents())
  expect(await destinationPool.locator('.mona-animation-pool-item').allTextContents()).toEqual(await sourcePool.locator('.pool-item').allTextContents())
  expect(await destinationPool.locator('.mona-animation-pool-item').count()).toBe(await sourcePool.locator('.pool-item').count())
  expect(await destinationPool.locator('.mona-animation-pool-mask').count()).toBe(await sourcePool.locator('.mask').count())
  await context.close()
})

test('text animation inspector and settled effect pool are pixel-identical to the source', async ({ browser }, testInfo) => {
  const context = await browser.newContext()
  const { react, vue } = await openEditors(context)
  await selectTitle(vue, react)
  await openAnimationPanel(vue, react)
  await Promise.all([
    vue.evaluate(() => document.fonts.ready),
    react.evaluate(() => document.fonts.ready),
    vue.waitForTimeout(100),
    react.waitForTimeout(100),
  ])
  await expectLocatorRasterParity(testInfo, 'text-animation-inspector', react.locator('.mona-render-inspector'), vue.locator('.toolbar'))

  const { destinationPool, sourcePool } = await openAnimationPool(vue, react)
  await expectLocatorRasterParity(testInfo, 'text-animation-pool', destinationPool, sourcePool)
  await context.close()
})

test('animation add, preview, timing, trigger, replace, reorder, and delete transactions match source', async ({ browser }) => {
  test.slow()
  const context = await browser.newContext()
  const { react, vue } = await openEditors(context)
  await selectTitle(vue, react)
  await openAnimationPanel(vue, react)

  let pools = await openAnimationPool(vue, react)
  await Promise.all([
    vue.evaluate(() => {
      const target = document.querySelector('#editable-element-gate3-title [class^="editable-element-"]')!
      const records: string[][] = []
      ;(window as typeof window & { __MONA_ANIMATION_CLASSES__?: string[][] }).__MONA_ANIMATION_CLASSES__ = records
      new MutationObserver(() => records.push([...target.classList].filter(name => name.startsWith('animate__')))).observe(target, { attributeFilter: ['class'], attributes: true })
    }),
    react.evaluate(() => {
      const target = document.querySelector('.mona-editor-slide-canvas [data-element-id="gate3-title"] .mona-text-content')!
      const records: string[][] = []
      ;(window as typeof window & { __MONA_ANIMATION_CLASSES__?: string[][] }).__MONA_ANIMATION_CLASSES__ = records
      new MutationObserver(() => records.push([...target.classList].filter(name => name.startsWith('animate__')))).observe(target, { attributeFilter: ['class'], attributes: true })
    }),
  ])
  await Promise.all([
    pools.sourcePool.locator('.pool-item').nth(0).click(),
    pools.destinationPool.locator('.mona-animation-pool-item').nth(0).click(),
  ])
  const sourceTarget = vue.locator('#editable-element-gate3-title [class^="editable-element-"]')
  const destinationTarget = react.locator('.mona-editor-slide-canvas [data-element-id="gate3-title"] .mona-text-content')
  const observedAnimation = (page: Page) => page.evaluate(() => (
    (window as typeof window & { __MONA_ANIMATION_CLASSES__?: string[][] }).__MONA_ANIMATION_CLASSES__ || []
  ).find(classes => classes.includes('animate__bounceIn')))
  await expect.poll(() => Promise.all([observedAnimation(vue), observedAnimation(react)])).toEqual([
    ['animate__animated', 'animate__bounceIn'],
    ['animate__animated', 'animate__bounceIn'],
  ])
  await Promise.all([expect(sourceTarget).toBeVisible(), expect(destinationTarget).toBeVisible()])
  await expectAnimationSlideAndHistoryParity(vue, react)

  const sourceSequence = vue.locator('.animation-sequence .sequence-item')
  const destinationSequence = react.locator('.mona-animation-sequence .mona-animation-sequence-item')
  expect(await destinationSequence.count()).toBe(await sourceSequence.count())
  expect(await destinationSequence.locator('.mona-animation-text').allTextContents()).toEqual(await sourceSequence.locator('.text').allTextContents())
  expect(normalizedRect(await destinationSequence.nth(0).boundingBox())).toEqual(normalizedRect(await sourceSequence.nth(0).boundingBox()))

  const sourceDuration = sourceSequence.nth(0).locator('.number-input input')
  const destinationDuration = destinationSequence.nth(0).locator('.mona-panel-number input')
  await Promise.all([sourceDuration.fill('1500'), destinationDuration.fill('1500')])
  await Promise.all([sourceDuration.press('Enter'), destinationDuration.press('Enter')])
  await expectAnimationSlideAndHistoryParity(vue, react)

  pools = await openAnimationPool(vue, react)
  await Promise.all([
    pools.sourcePool.locator('.pool-item').nth(1).click(),
    pools.destinationPool.locator('.mona-animation-pool-item').nth(1).click(),
  ])
  await expectAnimationSlideAndHistoryParity(vue, react)
  expect(await destinationSequence.count()).toBe(await sourceSequence.count())

  await Promise.all([
    vue.evaluate(() => {
      const records = (window as typeof window & { __MONA_ANIMATION_CLASSES__?: string[][] }).__MONA_ANIMATION_CLASSES__; if (records) records.length = 0 
    }),
    react.evaluate(() => {
      const records = (window as typeof window & { __MONA_ANIMATION_CLASSES__?: string[][] }).__MONA_ANIMATION_CLASSES__; if (records) records.length = 0 
    }),
  ])
  await Promise.all([
    sourceSequence.nth(0).locator('.handler-btn').first().click(),
    destinationSequence.nth(0).getByRole('button', { name: 'Preview' }).click(),
  ])
  await expect.poll(() => Promise.all([observedAnimation(vue), observedAnimation(react)])).toEqual([
    ['animate__animated', 'animate__bounceIn'],
    ['animate__animated', 'animate__bounceIn'],
  ])

  await Promise.all([
    vue.locator('.element-animation-panel .button').filter({ hasText: 'Preview all' }).click(),
    react.getByRole('button', { name: 'Preview all', exact: true }).click(),
  ])
  await Promise.all([
    expect(vue.locator('.element-animation-panel .button').filter({ hasText: 'Stop preview' })).toBeVisible(),
    expect(react.getByRole('button', { name: 'Stop preview', exact: true })).toBeVisible(),
  ])
  await Promise.all([
    vue.locator('.element-animation-panel .button').filter({ hasText: 'Stop preview' }).click(),
    react.getByRole('button', { name: 'Stop preview', exact: true }).click(),
  ])
  await Promise.all([
    expect(vue.locator('.element-animation-panel .button').filter({ hasText: 'Preview all' })).toBeVisible(),
    expect(react.getByRole('button', { name: 'Preview all', exact: true })).toBeVisible(),
  ])

  await Promise.all([
    sourceSequence.nth(1).locator('.select').click(),
    destinationSequence.nth(1).locator('.mona-panel-select').click(),
  ])
  await Promise.all([
    vue.locator('.tippy-box[data-theme~="popover"]:visible .option').filter({ hasText: /^After previous$/ }).click(),
    react.locator('.mona-panel-select-popover').getByRole('button', { name: 'After previous', exact: true }).click(),
  ])
  await expectAnimationSlideAndHistoryParity(vue, react)

  const [sourceAfterTrigger, destinationAfterTrigger] = await Promise.all([
    vue.evaluate(() => window.__MONA_TEST__!.getState().editor.activeElementIdList),
    react.evaluate(() => window.__MONA_REACT_TEST__!.getState().session.activeElementIds),
  ])
  expect(destinationAfterTrigger).toEqual(sourceAfterTrigger)
  expect(destinationAfterTrigger).toEqual(['gate3-title', 'gate3-gradient-shape'])
  await selectTitle(vue, react)
  await openAnimationPanel(vue, react)

  await Promise.all([
    sourceSequence.nth(0).locator('.configs .button').click(),
    destinationSequence.nth(0).getByRole('button', { name: /^Replace animation Bounce In$/ }).click(),
  ])
  const sourceReplacementPool = vue.locator('.tippy-box[data-theme~="popover"]:visible .animation-pool')
  const destinationReplacementPool = react.locator('.mona-animation-popover:visible .mona-animation-pool')
  await Promise.all([expect(sourceReplacementPool).toBeVisible(), expect(destinationReplacementPool).toBeVisible()])
  await Promise.all([vue.waitForTimeout(850), react.waitForTimeout(850)])
  await Promise.all([
    vue.locator('.tippy-box[data-theme~="popover"]:visible .tabs .tab').filter({ hasText: /^Exit$/ }).click(),
    react.locator('.mona-animation-popover:visible .mona-animation-pool-tabs [role="tab"]').filter({ hasText: /^Exit$/ }).click(),
  ])
  await Promise.all([
    sourceReplacementPool.locator('.pool-item').nth(0).click(),
    destinationReplacementPool.locator('.mona-animation-pool-item').nth(0).click(),
  ])
  await expectAnimationSlideAndHistoryParity(vue, react)

  await Promise.all([
    pointerDragBefore(vue, sourceSequence.nth(1), sourceSequence.nth(0)),
    pointerDragBefore(react, destinationSequence.nth(1), destinationSequence.nth(0)),
  ])
  await expectAnimationSlideAndHistoryParity(vue, react)

  await Promise.all([
    sourceSequence.nth(1).locator('.handler-btn').last().click(),
    destinationSequence.nth(1).getByRole('button', { name: 'Delete' }).click(),
  ])
  await expectAnimationSlideAndHistoryParity(vue, react)
  await expect.poll(async () => await destinationSequence.count() === await sourceSequence.count()).toBe(true)
  await context.close()
})

test('animation reorder listeners are removed when the panel unmounts mid-gesture', async ({ browser }) => {
  const context = await browser.newContext()
  const { react, vue } = await openEditors(context)
  await selectTitle(vue, react)
  await openAnimationPanel(vue, react)
  const { destinationPool, sourcePool } = await openAnimationPool(vue, react)
  await Promise.all([
    sourcePool.locator('.pool-item').first().click(),
    destinationPool.locator('.mona-animation-pool-item').first().click(),
  ])
  await expectAnimationSlideAndHistoryParity(vue, react)

  const row = react.locator('.mona-animation-sequence-item').first()
  const dragHandle = row.locator('.mona-animation-sequence-content')
  await expect(row).toBeVisible()
  await react.evaluate(() => {
    type AuditWindow = typeof window & {
      __MONA_REORDER_LISTENER_AUDIT__?: {
        active: Set<EventListenerOrEventListenerObject>
        restore: () => void
      }
    }
    const target = window as AuditWindow
    const active = new Set<EventListenerOrEventListenerObject>()
    const originalAdd = window.addEventListener
    const originalRemove = window.removeEventListener
    window.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: AddEventListenerOptions | boolean) => {
      if (type === 'pointermove' || type === 'pointerup' || type === 'pointercancel') active.add(listener)
      originalAdd.call(window, type, listener, options)
    }) as typeof window.addEventListener
    window.removeEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: EventListenerOptions | boolean) => {
      if (type === 'pointermove' || type === 'pointerup' || type === 'pointercancel') active.delete(listener)
      originalRemove.call(window, type, listener, options)
    }) as typeof window.removeEventListener
    target.__MONA_REORDER_LISTENER_AUDIT__ = {
      active,
      restore: () => {
        window.addEventListener = originalAdd
        window.removeEventListener = originalRemove
      },
    }
  })

  const box = await dragHandle.boundingBox()
  if (!box) throw new Error('Animation row geometry is unavailable')
  await react.mouse.move(box.x + 8, box.y + (box.height / 2))
  await react.mouse.down()
  expect(await react.evaluate(() => (
    (window as typeof window & { __MONA_REORDER_LISTENER_AUDIT__?: { active: Set<unknown> } })
      .__MONA_REORDER_LISTENER_AUDIT__?.active.size
  ))).toBe(2)

  await react.getByRole('tab', { name: 'Position', exact: true }).evaluate(element => (element as HTMLElement).click())
  await expect(react.locator('.mona-element-position-panel')).toBeVisible()
  expect(await react.evaluate(() => (
    (window as typeof window & { __MONA_REORDER_LISTENER_AUDIT__?: { active: Set<unknown> } })
      .__MONA_REORDER_LISTENER_AUDIT__?.active.size
  ))).toBe(0)
  await react.mouse.up()
  await react.evaluate(() => {
    const target = window as typeof window & { __MONA_REORDER_LISTENER_AUDIT__?: { restore: () => void } }
    target.__MONA_REORDER_LISTENER_AUDIT__?.restore()
    delete target.__MONA_REORDER_LISTENER_AUDIT__
  })
  await context.close()
})

test('floating text toolbar matches the source raster within one 8-bit compositing quantum', async ({ browser }, testInfo) => {
  const context = await browser.newContext()
  const { react, vue } = await openEditors(context)
  await openCanvasContextMenus(vue, react)
  await Promise.all([
    vue.locator('.contextmenu > .menu-content > .menu-item').filter({ hasText: /^Floating toolbar/ }).click(),
    react.locator('.mona-editor-context-menu [data-action="bubble-menu"]').click(),
  ])
  await selectTitle(vue, react)
  const sourceToolbar = vue.locator('.floating-toolbar')
  const destinationToolbar = react.locator('.mona-floating-text-toolbar')
  await Promise.all([
    expect(sourceToolbar).toBeVisible(),
    expect(destinationToolbar).toBeVisible(),
    vue.evaluate(() => document.fonts.ready),
    react.evaluate(() => document.fonts.ready),
  ])
  // The two DOMs have identical geometry and computed rendering properties.
  // Chromium still rounds two SVG edge samples and one cross-layer shadow
  // sample one channel value apart when Vue and React live in separate pages.
  // Keep that renderer-only allowance explicit and far below a visible pixel.
  await expectLocatorRasterParity(testInfo, 'floating-text-toolbar', destinationToolbar, sourceToolbar, {
    maxChannelDelta: 1,
    maxExactPixelDelta: 3,
    maxPerceptualPixelDelta: 3,
  })
  await context.close()
})

test('floating text toolbar matches source visibility, geometry, controls, commands, and viewport clamping', async ({ browser }) => {
  test.slow()
  const context = await browser.newContext()
  const { react, vue } = await openEditors(context)
  await openCanvasContextMenus(vue, react)
  await Promise.all([
    vue.locator('.contextmenu > .menu-content > .menu-item').filter({ hasText: /^Floating toolbar/ }).click(),
    react.locator('.mona-editor-context-menu [data-action="bubble-menu"]').click(),
  ])
  await selectTitle(vue, react)
  const sourceToolbar = vue.locator('.floating-toolbar')
  const destinationToolbar = react.locator('.mona-floating-text-toolbar')
  await Promise.all([expect(sourceToolbar).toBeVisible(), expect(destinationToolbar).toBeVisible()])
  expect(normalizedRect(await destinationToolbar.boundingBox())).toEqual(normalizedRect(await sourceToolbar.boundingBox()))
  expect(await destinationToolbar.locator('.mona-panel-select').count()).toBe(await sourceToolbar.locator('.select').count())
  expect(await destinationToolbar.locator('.mona-floating-toolbar-button').count()).toBe(await sourceToolbar.locator('.toolbar-btn').count())
  expect(await destinationToolbar.locator('.mona-floating-divider').count()).toBe(await sourceToolbar.locator('.divider').count())

  const sourceButtons = sourceToolbar.locator('.toolbar-btn')
  const destinationButtons = destinationToolbar.locator('.mona-floating-toolbar-button')
  for (const index of [1, 2, 3, 5, 7]) {
    await Promise.all([sourceButtons.nth(index).click(), destinationButtons.nth(index).click()])
    await expectTextElementAndHistoryParity(vue, react)
  }

  await Promise.all([
    sourceToolbar.locator('.select').nth(0).click(),
    destinationToolbar.locator('.mona-panel-select').nth(0).click(),
  ])
  await Promise.all([
    vue.locator('.tippy-box[data-theme~="popover"]:visible .option').filter({ hasText: /^Inter$/ }).last().click(),
    react.locator('.mona-panel-select-popover').getByRole('button', { name: 'Inter', exact: true }).click(),
  ])
  await expectTextElementAndHistoryParity(vue, react)

  await Promise.all([sourceButtons.nth(0).click(), destinationButtons.nth(0).click()])
  await Promise.all([
    vue.locator('.tippy-box[data-theme~="popover"]:visible .picker-presets').first().locator('.picker-presets-color').nth(6).click(),
    react.getByRole('button', { name: 'Select color #9aba60' }).click(),
  ])
  await expectTextElementAndHistoryParity(vue, react)
  await Promise.all([sourceButtons.nth(8).click(), destinationButtons.nth(8).click()])
  await expectTextElementAndHistoryParity(vue, react)

  await Promise.all([
    vue.locator('.thumbnail-slide').nth(3).click(),
    react.getByRole('button', { name: 'Show slide 4' }).click(),
  ])
  const sourceCaption = vue.locator('#editable-element-gate3-media-caption .editable-element-text')
  const destinationCaption = react.locator('.mona-editor-slide-canvas [data-element-id="gate3-media-caption"] .mona-text-content')
  await Promise.all([
    sourceCaption.click({ position: { x: 20, y: 15 } }),
    destinationCaption.click({ position: { x: 20, y: 15 } }),
  ])
  await Promise.all([expect(sourceToolbar).toBeVisible(), expect(destinationToolbar).toBeVisible()])
  expect(normalizedRect(await destinationToolbar.boundingBox())).toEqual(normalizedRect(await sourceToolbar.boundingBox()))

  await openCanvasContextMenus(vue, react)
  await Promise.all([
    vue.locator('.contextmenu > .menu-content > .menu-item').filter({ hasText: /^Floating toolbar/ }).click(),
    react.locator('.mona-editor-context-menu [data-action="bubble-menu"]').click(),
  ])
  await Promise.all([expect(sourceToolbar).toHaveCount(0), expect(destinationToolbar).toHaveCount(0)])
  await context.close()
})
