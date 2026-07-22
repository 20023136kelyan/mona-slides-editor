import { expect, test, type Browser, type Locator, type Page } from '@playwright/test'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

import type { PPTAudioElement, PPTElement, PPTVideoElement } from '@mona/presentation-core/model'

interface VueState {
  editor: { activeElementIdList: string[]; handleElementId: string }
  history: { snapshotCursor: number; snapshotLength: number }
  presentation: { slideIndex: number; slides: Array<{ elements: PPTElement[] }> }
}

interface ReactState {
  presentation: VueState['presentation']
  session: { activeElementIds: string[]; handleElementId: string | null }
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

const fixturePath = '/?rendererFixture=gate4-editor'

async function openEditors(browser: Browser) {
  const sourceContext = await browser.newContext({ viewport: { height: 900, width: 1440 } })
  const destinationContext = await browser.newContext({ viewport: { height: 900, width: 1440 } })
  await Promise.all([
    sourceContext.addInitScript(() => localStorage.setItem('mona:ui-locale', 'en-US')),
    destinationContext.addInitScript(() => localStorage.setItem('mona:ui-locale', 'en-US')),
  ])
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

const roundedRect = (rect: { height: number; width: number; x: number; y: number } | null) => rect && ({
  height: Math.round(rect.height * 100) / 100,
  width: Math.round(rect.width * 100) / 100,
  x: Math.round(rect.x * 100) / 100,
  y: Math.round(rect.y * 100) / 100,
})

const normalizeDocument = <T, >(value: T): T => {
  if (typeof value === 'number') return (Math.round(value * 1e10) / 1e10) as T
  if (Array.isArray(value)) return value.map(normalizeDocument) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).flatMap(([key, nested]) => {
      if (key === 'id') return []
      if (key === 'src' && typeof nested === 'string' && nested.startsWith('blob:')) return [[key, 'blob:fixture']]
      return [[key, normalizeDocument(nested)]]
    })) as T
  }
  return value
}

async function history(page: Page, app: 'react' | 'vue') {
  if (app === 'react') return page.evaluate(() => window.__MONA_REACT_TEST__!.getHistoryState())
  return page.evaluate(() => {
    const state = window.__MONA_TEST__!.getState().history
    return { cursor: state.snapshotCursor, length: state.snapshotLength }
  })
}

async function currentSlide(page: Page, app: 'react' | 'vue') {
  return page.evaluate(appName => {
    const state = appName === 'vue' ? window.__MONA_TEST__!.getState() : window.__MONA_REACT_TEST__!.getState()
    return structuredClone(state.presentation.slides[state.presentation.slideIndex]!.elements)
  }, app)
}

async function expectDocumentParity(vue: Page, react: Page) {
  await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
  await expect.poll(async () => JSON.stringify(await history(react, 'react')) === JSON.stringify(await history(vue, 'vue'))).toBe(true)
  expect(normalizeDocument(await currentSlide(react, 'react'))).toEqual(normalizeDocument(await currentSlide(vue, 'vue')))
}

async function selectSlide(vue: Page, react: Page, index: number) {
  await Promise.all([
    vue.locator('.thumbnail-slide').nth(index).click(),
    react.getByRole('button', { name: `Show slide ${index + 1}` }).click(),
  ])
}

async function openMediaInput(vue: Page, react: Page) {
  await Promise.all([
    vue.locator('.canvas-tool .insert-handler-item').nth(7).click(),
    react.locator('.mona-canvas-insert-item').filter({ hasText: /^Media$/ }).click(),
  ])
  const source = vue.locator('.popover-content:visible:has(.media-input)')
  const destination = react.locator('.mona-canvas-tool-popover.is-media-input')
  await Promise.all([expect(source).toBeVisible(), expect(destination).toBeVisible(), vue.waitForTimeout(350), react.waitForTimeout(350)])
  return { destination, source }
}

function rasterDelta(sourceBuffer: Buffer, destinationBuffer: Buffer, threshold = 0) {
  const source = PNG.sync.read(sourceBuffer)
  const destination = PNG.sync.read(destinationBuffer)
  expect([destination.width, destination.height]).toEqual([source.width, source.height])
  let changedPixels = 0
  let maxChannelDelta = 0
  for (let index = 0; index < source.data.length; index += 4) {
    let changed = false
    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs(source.data[index + channel]! - destination.data[index + channel]!)
      if (delta) changed = true
      maxChannelDelta = Math.max(maxChannelDelta, delta)
    }
    if (changed) changedPixels += 1
  }
  return {
    changedPixels,
    maxChannelDelta,
    visiblePixelDelta: pixelmatch(source.data, destination.data, null, source.width, source.height, { threshold }),
  }
}

async function compareRaster(source: Locator, destination: Locator, threshold = 0, masks: { destination: Locator[]; source: Locator[] } = { destination: [], source: [] }) {
  const [sourceBuffer, destinationBuffer] = await Promise.all([
    source.screenshot({ animations: 'disabled', caret: 'hide', mask: masks.source }),
    destination.screenshot({ animations: 'disabled', caret: 'hide', mask: masks.destination }),
  ])
  return rasterDelta(sourceBuffer, destinationBuffer, threshold)
}

async function selectMedia(vue: Page, react: Page, type: 'audio' | 'video') {
  if (type === 'audio') {
    await Promise.all([
      vue.locator('.editable-element-audio .audio-icon').click({ force: true }),
      react.locator('.mona-editor-slide-canvas .mona-audio-icon').click({ force: true }),
    ])
  }
  else {
    await vue.locator('.editable-element-video .element-content').evaluate(element => element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })))
    await react.locator('.mona-editor-slide-canvas .mona-video-editor-content').evaluate(element => element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1 })))
  }
  await expect.poll(() => Promise.all([
    vue.evaluate(() => window.__MONA_TEST__!.getState().editor.handleElementId),
    react.evaluate(() => window.__MONA_REACT_TEST__!.getState().session.handleElementId),
  ])).toEqual([`gate3-${type}`, `gate3-${type}`])
}

test('media popover has complete URL/upload/validation/dismissal branches and exact settled surface', async ({ browser }) => {
  test.setTimeout(90_000)
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  const beforeSource = await currentSlide(vue, 'vue')
  const beforeHistory = await history(vue, 'vue')
  const { destination, source } = await openMediaInput(vue, react)

  expect(roundedRect(await destination.boundingBox())).toEqual(roundedRect(await source.boundingBox()))
  expect(await destination.locator('.mona-media-input').boundingBox().then(roundedRect)).toEqual(await source.locator('.media-input').boundingBox().then(roundedRect))
  expect(await destination.getByRole('tab').allTextContents()).toEqual(await source.locator('.tabs .tab').allTextContents())
  expect(await destination.getByRole('textbox').inputValue()).toBe(await source.locator('.input input').inputValue())
  expect(await destination.getByRole('textbox').getAttribute('placeholder')).toBe(await source.locator('.input input').getAttribute('placeholder'))
  expect(await destination.locator('button').allTextContents()).toEqual(['Video', 'Audio', ' Upload video', 'Cancel', 'Confirm'])
  const popupDelta = await compareRaster(source, destination, .01)
  expect(popupDelta.visiblePixelDelta).toBeLessThanOrEqual(450)
  expect(popupDelta.changedPixels).toBeLessThanOrEqual(600)
  expect(popupDelta.maxChannelDelta).toBeLessThanOrEqual(64)

  await Promise.all([
    source.locator('.tabs .tab').filter({ hasText: /^Audio$/ }).click(),
    destination.getByRole('tab', { name: 'Audio' }).click(),
  ])
  expect(await destination.getByRole('textbox').inputValue()).toBe(await source.locator('.input input').inputValue())
  expect(await destination.getByRole('textbox').getAttribute('placeholder')).toBe(await source.locator('.input input').getAttribute('placeholder'))
  expect(await destination.locator('.mona-media-button').first().innerText()).toBe(await source.locator('.button').first().innerText())
  expect((await compareRaster(source, destination, .01)).visiblePixelDelta).toBeLessThanOrEqual(450)

  await Promise.all([source.locator('.input input').fill(''), destination.getByRole('textbox').fill('')])
  await Promise.all([
    source.locator('.button.primary').click(),
    destination.locator('.mona-media-button.is-primary').click(),
  ])
  const sourceNotice = vue.locator('.message:visible').last()
  const destinationNotice = react.locator('.mona-message:visible').last()
  await Promise.all([expect(sourceNotice).toBeVisible(), expect(destinationNotice).toBeVisible()])
  expect(await destinationNotice.innerText()).toBe(await sourceNotice.innerText())
  expect(roundedRect(await destinationNotice.boundingBox())).toEqual(roundedRect(await sourceNotice.boundingBox()))
  expect(await currentSlide(vue, 'vue')).toEqual(beforeSource)
  expect(await currentSlide(react, 'react')).toEqual(beforeSource)
  expect(await history(vue, 'vue')).toEqual(beforeHistory)
  expect(await history(react, 'react')).toEqual(beforeHistory)

  await Promise.all([
    source.locator('.button.default').filter({ hasText: /^Cancel$/ }).click(),
    destination.locator('.mona-media-button').filter({ hasText: /^Cancel$/ }).click(),
  ])
  await Promise.all([expect(source).toBeHidden(), expect(destination).toBeHidden()])
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('URL and uploaded video/audio creation, MIME extensions, selection, history, undo, and redo match source', async ({ browser }) => {
  test.setTimeout(120_000)
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  const initialLength = (await currentSlide(vue, 'vue')).length

  let input = await openMediaInput(vue, react)
  await Promise.all([
    input.source.locator('.input input').fill('https://example.test/demo.mp4'),
    input.destination.getByRole('textbox').fill('https://example.test/demo.mp4'),
  ])
  await Promise.all([
    input.source.locator('.button.primary').click(),
    input.destination.locator('.mona-media-button.is-primary').click(),
  ])
  await expectDocumentParity(vue, react)
  let sourceElements = await currentSlide(vue, 'vue')
  let created = sourceElements.at(-1) as PPTVideoElement
  expect(created).toMatchObject({ autoplay: false, height: 300, left: 250, rotate: 0, src: 'https://example.test/demo.mp4', top: 131.25, type: 'video', width: 500 })

  await Promise.all([
    vue.locator('.canvas-tool .left-handler > .handler-item').nth(0).click(),
    react.getByLabel('Undo (Ctrl + Z)').click(),
  ])
  await expect.poll(async () => [(await currentSlide(vue, 'vue')).length, (await currentSlide(react, 'react')).length]).toEqual([initialLength, initialLength])
  await expectDocumentParity(vue, react)
  await Promise.all([
    vue.locator('.canvas-tool .left-handler > .handler-item').nth(1).click(),
    react.getByLabel('Redo (Ctrl + Y)').click(),
  ])
  await expect.poll(async () => [(await currentSlide(vue, 'vue')).length, (await currentSlide(react, 'react')).length]).toEqual([initialLength + 1, initialLength + 1])
  await expectDocumentParity(vue, react)

  const videoFile = { buffer: Buffer.from('video-fixture'), mimeType: 'video/mp4', name: 'fixture.mp4' }
  input = await openMediaInput(vue, react)
  await Promise.all([
    input.source.locator('input[type="file"]').setInputFiles(videoFile),
    input.destination.locator('input[type="file"]').setInputFiles(videoFile),
  ])
  await expectDocumentParity(vue, react)
  created = (await currentSlide(vue, 'vue')).at(-1) as PPTVideoElement
  expect(created.ext).toBe('mp4')
  expect(created.src.startsWith('blob:')).toBe(true)

  const audioFile = { buffer: Buffer.from('audio-fixture'), mimeType: 'audio/mpeg', name: 'fixture.mp3' }
  input = await openMediaInput(vue, react)
  await Promise.all([
    input.source.locator('.tabs .tab').filter({ hasText: /^Audio$/ }).click(),
    input.destination.getByRole('tab', { name: 'Audio' }).click(),
  ])
  await Promise.all([
    input.source.locator('input[type="file"]').setInputFiles(audioFile),
    input.destination.locator('input[type="file"]').setInputFiles(audioFile),
  ])
  await expectDocumentParity(vue, react)
  sourceElements = await currentSlide(vue, 'vue')
  const createdAudio = sourceElements.at(-1) as PPTAudioElement
  expect(createdAudio).toMatchObject({ autoplay: false, color: '#5b9bd5', ext: 'mp3', fixedRatio: true, height: 50, left: 475, loop: false, rotate: 0, top: 256.25, type: 'audio', width: 50 })
  expect(createdAudio.src.startsWith('blob:')).toBe(true)
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('editor video player render tree, geometry, error state, controls, speed menu, volume, loop, play, and edge-only dragging match source', async ({ browser }) => {
  test.setTimeout(120_000)
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  await selectSlide(vue, react, 3)
  const source = vue.locator('.editable-element-video')
  const destination = react.locator('.mona-editor-slide-canvas .mona-video-element')
  await Promise.all([expect(source).toBeVisible(), expect(destination).toBeVisible(), vue.waitForTimeout(500), react.waitForTimeout(500)])

  expect(roundedRect(await destination.boundingBox())).toEqual(roundedRect(await source.boundingBox()))
  expect(roundedRect(await destination.locator('.mona-video-player').boundingBox())).toEqual(roundedRect(await source.locator('.video-player').boundingBox()))
  expect(roundedRect(await destination.locator('video').boundingBox())).toEqual(roundedRect(await source.locator('video').boundingBox()))
  expect(await destination.locator('.mona-video-load-error').innerText()).toBe(await source.locator('.load-error').innerText())
  expect(await destination.locator('.mona-video-controller').innerText()).toBe(await source.locator('.controller').innerText())
  expect(await destination.locator('.mona-video-drag-border').count()).toBe(await source.locator('.handler-border').count())
  for (const [sourceClass, destinationClass] of [['t', 'top'], ['b', 'bottom'], ['l', 'left'], ['r', 'right']] as const) {
    expect(roundedRect(await destination.locator(`.mona-video-drag-border.is-${destinationClass}`).boundingBox()))
      .toEqual(roundedRect(await source.locator(`.handler-border.${sourceClass}`).boundingBox()))
  }
  const videoDelta = await compareRaster(source, destination, .01, {
    source: [source.locator('.load-error'), source.locator('.controller svg'), source.locator('.controller .time'), source.locator('.speed-icon'), source.locator('.loop-icon')],
    destination: [destination.locator('.mona-video-load-error'), destination.locator('.mona-video-controller svg'), destination.locator('.mona-video-time'), destination.locator('.mona-player-icon.is-speed'), destination.locator('.mona-player-icon.is-loop')],
  })
  expect(videoDelta.visiblePixelDelta).toBeLessThanOrEqual(20)
  expect(videoDelta.maxChannelDelta).toBeLessThanOrEqual(160)

  await Promise.all([
    source.locator('.speed-icon .icon-content').click(),
    destination.locator('.mona-player-icon.is-speed').click(),
  ])
  const sourceMenu = source.locator('.speed-menu')
  const destinationMenu = destination.locator('.mona-video-speed-menu')
  expect(await destinationMenu.locator('button').allTextContents()).toEqual(await sourceMenu.locator('.speed-menu-item').allTextContents())
  expect(roundedRect(await destinationMenu.boundingBox())).toEqual(roundedRect(await sourceMenu.boundingBox()))
  for (const index of [0, 1, 2, 3, 4, 5]) {
    await Promise.all([
      sourceMenu.locator('.speed-menu-item').nth(index).click(),
      destinationMenu.locator('button').nth(index).click(),
    ])
    const [sourceRate, destinationRate] = await Promise.all([
      source.locator('video').evaluate(element => element.playbackRate),
      destination.locator('video').evaluate(element => element.playbackRate),
    ])
    expect(destinationRate).toBe(sourceRate)
  }
  await Promise.all([
    source.locator('.loop').click(),
    destination.locator('.mona-player-icon.is-loop').click(),
  ])
  expect(await destination.locator('.mona-player-icon.is-loop').innerText()).toBe(await source.locator('.loop').innerText())
  await Promise.all([
    source.locator('.volume-icon').click(),
    destination.locator('.mona-video-controller .mona-player-icon').nth(1).click(),
  ])
  expect(await destination.locator('video').evaluate(element => ({ muted: element.muted, volume: element.volume })))
    .toEqual(await source.locator('video').evaluate(element => ({ muted: element.muted, volume: element.volume })))
  await Promise.all([
    source.locator('.play-icon').click(),
    destination.locator('.mona-video-controller .mona-player-icon.is-play').click(),
  ])
  expect(await destination.locator('.mona-video-controller .mona-player-icon.is-play svg path').getAttribute('d'))
    .toBe(await source.locator('.controller .play-icon svg path').getAttribute('d'))

  await Promise.all([
    vue.locator('.canvas').click({ position: { x: 40, y: 40 } }),
    react.getByRole('application', { name: 'Editable slide canvas' }).click({ position: { x: 40, y: 40 } }),
  ])
  const sourceBefore = (await currentSlide(vue, 'vue')).find(element => element.id === 'gate3-video') as PPTVideoElement
  const sourceBorder = source.locator('.handler-border.t')
  const destinationBorder = destination.locator('.mona-video-drag-border.is-top')
  const [sourceBox, destinationBox] = await Promise.all([sourceBorder.boundingBox(), destinationBorder.boundingBox()])
  await Promise.all([
    vue.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2),
    react.mouse.move(destinationBox!.x + destinationBox!.width / 2, destinationBox!.y + destinationBox!.height / 2),
  ])
  await Promise.all([vue.mouse.down(), react.mouse.down()])
  await Promise.all([
    vue.mouse.move(sourceBox!.x + sourceBox!.width / 2 + 30, sourceBox!.y + sourceBox!.height / 2 + 20),
    react.mouse.move(destinationBox!.x + destinationBox!.width / 2 + 30, destinationBox!.y + destinationBox!.height / 2 + 20),
  ])
  await Promise.all([vue.mouse.up(), react.mouse.up()])
  await expectDocumentParity(vue, react)
  const moved = (await currentSlide(vue, 'vue')).find(element => element.id === 'gate3-video') as PPTVideoElement
  expect(moved.left - sourceBefore.left).toBeGreaterThan(30)
  expect(moved.top - sourceBefore.top).toBeGreaterThan(15)
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('audio player selection, placement, complete controller state, inspector color/autoplay/loop, and history match source', async ({ browser }) => {
  test.setTimeout(120_000)
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  await selectSlide(vue, react, 3)
  await selectMedia(vue, react, 'audio')
  const source = vue.locator('.editable-element-audio')
  const destination = react.locator('.mona-editor-slide-canvas .mona-audio-element')
  const sourcePlayer = source.locator('.audio-player')
  const destinationPlayer = destination.locator('.mona-audio-player')
  expect(roundedRect(await destination.boundingBox())).toEqual(roundedRect(await source.boundingBox()))
  expect(roundedRect(await destinationPlayer.boundingBox())).toEqual(roundedRect(await sourcePlayer.boundingBox()))
  expect(await destinationPlayer.innerText()).toBe(await sourcePlayer.innerText())
  expect(await destinationPlayer.locator('svg path').evaluateAll(paths => paths.map(path => path.getAttribute('d'))))
    .toEqual(await sourcePlayer.locator('svg path').evaluateAll(paths => paths.map(path => path.getAttribute('d'))))
  const audioDelta = await compareRaster(sourcePlayer, destinationPlayer, .01)
  expect(audioDelta.visiblePixelDelta).toBeLessThanOrEqual(100)
  expect(audioDelta.maxChannelDelta).toBeLessThanOrEqual(90)

  await Promise.all([
    sourcePlayer.locator('.volume-icon').evaluate(element => (element as HTMLElement).click()),
    destinationPlayer.locator('.mona-player-icon').nth(1).evaluate(element => (element as HTMLElement).click()),
  ])
  expect(await destinationPlayer.locator('audio').evaluate(element => ({ muted: element.muted, volume: element.volume })))
    .toEqual(await sourcePlayer.locator('audio').evaluate(element => ({ muted: element.muted, volume: element.volume })))
  await Promise.all([
    sourcePlayer.locator('.play-icon').evaluate(element => (element as HTMLElement).click()),
    destinationPlayer.locator('.mona-player-icon.is-play').evaluate(element => (element as HTMLElement).click()),
  ])
  expect(await destinationPlayer.locator('.mona-player-icon.is-play svg path').getAttribute('d'))
    .toBe(await sourcePlayer.locator('.play-icon svg path').getAttribute('d'))

  const sourcePanel = vue.locator('.audio-style-panel')
  const destinationPanel = react.locator('.mona-audio-style-panel')
  expect(roundedRect(await destinationPanel.boundingBox())).toEqual(roundedRect(await sourcePanel.boundingBox()))
  expect(await destinationPanel.innerText()).toBe(await sourcePanel.innerText())
  expect((await compareRaster(sourcePanel, destinationPanel, .01)).visiblePixelDelta).toBeLessThanOrEqual(30)

  await Promise.all([sourcePanel.locator('.color-btn').click(), destinationPanel.locator('.mona-panel-color-button').click()])
  await Promise.all([
    vue.locator('.tippy-box[data-theme~="popover"]:visible .picker-presets').first().locator('.picker-presets-color').nth(6).click(),
    react.locator('.mona-panel-popover-content .mona-color-picker-presets').first().locator('.mona-color-picker-swatch').nth(6).click(),
  ])
  await expectDocumentParity(vue, react)
  await Promise.all([sourcePanel.locator('.color-btn').click(), destinationPanel.locator('.mona-panel-color-button').click()])
  await Promise.all([vue.waitForTimeout(300), react.waitForTimeout(300)])
  for (const index of [0, 1]) {
    await Promise.all([
      sourcePanel.locator('.switch').nth(index).click(),
      destinationPanel.locator('.mona-panel-switch').nth(index).click(),
    ])
    await expectDocumentParity(vue, react)
  }
  const audio = (await currentSlide(vue, 'vue')).find(element => element.id === 'gate3-audio') as PPTAudioElement
  expect(audio).toMatchObject({ autoplay: true, color: '#9aba60', loop: true })
  await Promise.all([
    vue.locator('.canvas-tool .left-handler > .handler-item').nth(0).click(),
    react.getByLabel('Undo (Ctrl + Z)').click(),
  ])
  await expectDocumentParity(vue, react)
  await Promise.all([
    vue.locator('.canvas-tool .left-handler > .handler-item').nth(1).click(),
    react.getByLabel('Redo (Ctrl + Y)').click(),
  ])
  await expectDocumentParity(vue, react)
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('video inspector poster upload/reset, autoplay, first-frame failure, exact geometry, state, and history match source', async ({ browser }) => {
  test.setTimeout(120_000)
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  await selectSlide(vue, react, 3)
  await selectMedia(vue, react, 'video')
  const sourcePanel = vue.locator('.video-style-panel')
  const destinationPanel = react.locator('.mona-video-style-panel')
  expect(roundedRect(await destinationPanel.boundingBox())).toEqual(roundedRect(await sourcePanel.boundingBox()))
  expect(await destinationPanel.innerText()).toBe(await sourcePanel.innerText())
  expect(roundedRect(await destinationPanel.locator('.mona-video-poster').boundingBox()))
    .toEqual(roundedRect(await sourcePanel.locator('.background-image').boundingBox()))
  const panelDelta = await compareRaster(sourcePanel, destinationPanel, .01)
  expect(panelDelta.visiblePixelDelta).toBeLessThanOrEqual(1_200)
  expect(panelDelta.changedPixels).toBeLessThanOrEqual(7_500)
  expect(panelDelta.maxChannelDelta).toBeLessThanOrEqual(190)

  const poster = {
    name: 'poster.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="#2468ac"/></svg>'),
  }
  await Promise.all([
    sourcePanel.locator('input[type="file"]').setInputFiles(poster),
    destinationPanel.locator('input[type="file"]').setInputFiles(poster),
  ])
  await expectDocumentParity(vue, react)
  let video = (await currentSlide(vue, 'vue')).find(element => element.id === 'gate3-video') as PPTVideoElement
  expect(video.poster).toContain('data:image/svg+xml;base64,')
  await Promise.all([
    sourcePanel.locator('.button').filter({ hasText: 'Reset preview image' }).click(),
    destinationPanel.locator('.mona-panel-button').filter({ hasText: 'Reset preview image' }).click(),
  ])
  await expectDocumentParity(vue, react)
  video = (await currentSlide(vue, 'vue')).find(element => element.id === 'gate3-video') as PPTVideoElement
  expect(video.poster).toBe('')
  await Promise.all([
    sourcePanel.locator('.switch').click(),
    destinationPanel.locator('.mona-panel-switch').click(),
  ])
  await expectDocumentParity(vue, react)
  video = (await currentSlide(vue, 'vue')).find(element => element.id === 'gate3-video') as PPTVideoElement
  expect(video.autoplay).toBe(true)

  const beforeFirstFrame = await history(vue, 'vue')
  await Promise.all([
    sourcePanel.locator('.button').filter({ hasText: 'Use first frame as preview' }).click(),
    destinationPanel.locator('.mona-panel-button').filter({ hasText: 'Use first frame as preview' }).click(),
  ])
  await Promise.all([vue.waitForTimeout(400), react.waitForTimeout(400)])
  expect(normalizeDocument(await currentSlide(react, 'react'))).toEqual(normalizeDocument(await currentSlide(vue, 'vue')))
  expect(await history(react, 'react')).toEqual(await history(vue, 'vue'))
  expect((await history(vue, 'vue')).cursor).toBeGreaterThanOrEqual(beforeFirstFrame.cursor)
  await Promise.all([sourceContext.close(), destinationContext.close()])
})
