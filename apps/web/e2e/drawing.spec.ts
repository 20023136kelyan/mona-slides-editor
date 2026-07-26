import { expect, openApp, reloadApp, test, type Page } from './electron-fixture'

interface PersistedSketch {
  scene: {
    appState?: {
      scrollX?: number
      scrollY?: number
      zoom?: { value?: number }
    }
    elements: Array<{
      height: number
      isDeleted?: boolean
      type: string
      width: number
      x: number
      y: number
      points?: Array<[number, number]>
    }>
  }
  slideId: string
}

const readSketches = (page: Page) => page.evaluate(async () => {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('mona')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
  })
  return new Promise<PersistedSketch[]>((resolve, reject) => {
    const request = database.transaction('sketches', 'readonly').objectStore('sketches').getAll()
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result as PersistedSketch[])
  })
})

const clearSketches = (page: Page) => page.evaluate(async () => {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('mona')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
  })
  await new Promise<void>((resolve, reject) => {
    const request = database.transaction('sketches', 'readwrite').objectStore('sketches').clear()
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve()
  })
})

// Drawing is opened from the header, not the creation rail: it is a canvas
// mode rather than a category of things to insert, and the rail entry that once
// held it opened no panel of its own.
const openDrawing = async (page: Page) => {
  const draw = page.getByRole('button', { exact: true, name: 'Draw' })
  await draw.click()
  await expect(draw).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('region', { name: 'Drawing layer' })).toBeVisible()
  await expect(page.getByRole('toolbar', { name: 'Drawing tools' })).toBeVisible()
}

const drawStroke = async (page: Page) => {
  const canvas = page.locator('.mona-drawing-canvas canvas.interactive')
  await expect(canvas).toBeVisible()
  const box = await canvas.boundingBox()
  expect(box).not.toBeNull()
  const points = [
    { x: box!.x + box!.width * 0.22, y: box!.y + box!.height * 0.32 },
    { x: box!.x + box!.width * 0.32, y: box!.y + box!.height * 0.46 },
    { x: box!.x + box!.width * 0.48, y: box!.y + box!.height * 0.37 },
    { x: box!.x + box!.width * 0.62, y: box!.y + box!.height * 0.5 },
  ]
  await page.mouse.move(points[0]!.x, points[0]!.y)
  await page.mouse.down()
  for (const point of points.slice(1)) await page.mouse.move(point.x, point.y, { steps: 4 })
  await page.mouse.up()
  return { box: box!, start: points[0]! }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('mona:ui-locale', 'en-US')
    }
    catch {
      // Sandboxed agent frames intentionally have an opaque origin.
    }
  })
  // The normal working-copy loader, which is what drawing persistence uses.
  // There is no agent fixture to pair with it any more: the deterministic
  // provider went with the provider stack.
  await openApp(page, '?persistTest=1')
  await expect(page.getByRole('application', { name: 'Editable slide canvas' })).toBeVisible()
  await clearSketches(page)
})

test('lazy-loads the slide-coordinate drawing surface and persists its independent scene', async ({ page }) => {
  const problems: string[] = []
  const drawingRequests: string[] = []
  page.on('request', request => {
    if (request.url().includes('DrawingWorkspace')) drawingRequests.push(request.url())
  })
  page.on('console', message => {
    if (message.type() === 'error' || message.type() === 'warning') problems.push(`${message.type()}: ${message.text()}`)
  })
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`))

  await reloadApp(page)
  await expect(page.getByRole('application', { name: 'Editable slide canvas' })).toBeVisible()
  expect(drawingRequests).toEqual([])
  await openDrawing(page)
  await expect.poll(() => drawingRequests.length).toBeGreaterThan(0)

  await expect(page.getByRole('button', { name: 'Build this' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Undo drawing' })).toBeDisabled()
  const gesture = await drawStroke(page)
  await expect(page.getByRole('button', { name: 'Build this' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Undo drawing' })).toBeEnabled()

  await expect.poll(async () => (await readSketches(page)).length).toBe(1)
  const [sketch] = await readSketches(page)
  const [stroke] = sketch!.scene.elements.filter(element => !element.isDeleted)
  expect(stroke?.type).toBe('freedraw')
  const viewportSize = await page.evaluate(() => window.__MONA_TEST__!.getState().presentation.viewportSize)
  const scale = gesture.box.width / viewportSize
  expect(Number(await page.getByRole('region', { name: 'Drawing layer' }).getAttribute('data-scene-zoom'))).toBeCloseTo(scale, 2)
  const firstPoint = stroke!.points?.[0] ?? [0, 0]
  expect(stroke!.x + firstPoint[0]).toBeCloseTo((gesture.start.x - gesture.box.x) / scale, 0)
  expect(stroke!.y + firstPoint[1]).toBeCloseTo((gesture.start.y - gesture.box.y) / scale, 0)

  const sceneBefore = sketch!.scene.elements.map(element => ({
    height: element.height,
    id: (element as { id?: string }).id,
    type: element.type,
    width: element.width,
    x: element.x,
    y: element.y,
  }))
  await page.getByRole('button', { name: 'Show slide 2' }).click()
  await expect(page.getByRole('region', { name: 'Drawing layer' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Build this' })).toBeDisabled()
  await page.getByRole('button', { name: 'Show slide 1' }).click()
  await expect(page.getByRole('region', { name: 'Drawing layer' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Build this' })).toBeEnabled()

  const drawingBeforeZoom = await page.getByRole('region', { name: 'Drawing layer' }).boundingBox()
  await page.getByRole('slider').press('ArrowRight')
  await expect.poll(async () => (await page.getByRole('region', { name: 'Drawing layer' }).boundingBox())?.width).toBeGreaterThan(drawingBeforeZoom!.width)

  await page.getByRole('radio', { name: 'Reference slide elements' }).click()
  await page.getByRole('button', { name: /^Select shape / }).first().click()
  await expect(page.locator('.mona-editor-status')).toHaveText('1 selected element')
  await expect(page.getByRole('button', { exact: true, name: 'Draw' })).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: 'Exit drawing' }).click()
  await expect(page.getByRole('toolbar', { name: 'Drawing tools' })).toHaveCount(0)
  const drawingBeforePan = await page.getByRole('region', { name: 'Drawing layer' }).boundingBox()
  const stage = page.getByRole('application', { name: 'Editable slide canvas' })
  const stageBox = await stage.boundingBox()
  await page.keyboard.down('Space')
  await page.mouse.move(stageBox!.x + stageBox!.width * 0.8, stageBox!.y + stageBox!.height * 0.75)
  await page.mouse.down()
  await page.mouse.move(stageBox!.x + stageBox!.width * 0.8 + 45, stageBox!.y + stageBox!.height * 0.75 + 25, { steps: 3 })
  await page.mouse.up()
  await page.keyboard.up('Space')
  await expect.poll(async () => (await page.getByRole('region', { name: 'Drawing layer' }).boundingBox())?.x).toBeGreaterThan(drawingBeforePan!.x)

  await page.getByRole('button', { name: 'Templates', exact: true }).first().click()
  // Task panels name the drawer after themselves via aria-label.
  await expect(page.getByRole('complementary', { name: 'Templates' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Drawing layer' })).toBeVisible()
  expect((await readSketches(page))[0]!.scene.elements.map(element => ({
    height: element.height,
    id: (element as { id?: string }).id,
    type: element.type,
    width: element.width,
    x: element.x,
    y: element.y,
  }))).toEqual(sceneBefore)
  expect(problems).toEqual([])
})

test('hands the sketch to Mona, survives reload, and clears without touching slide content', async ({ page }) => {
  await openDrawing(page)
  await drawStroke(page)
  await expect(page.getByRole('button', { name: 'Build this' })).toBeEnabled()

  const elementCount = await page.evaluate(() => window.__MONA_TEST__!.getState().presentation.slides[0]!.elements.length)
  await page.getByRole('button', { name: 'Build this' }).click()
  await expect(page.getByRole('complementary', { name: 'Mona AI' })).toBeVisible()
  await expect(page.getByText('Drawing attached')).toBeVisible()
  await expect(page.getByRole('img', { name: 'Preview of the attached drawing' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Message Mona AI' })).toHaveValue('Build this sketch as a polished, fully editable slide.')
  // The handoff is asserted; the turn is not. Sending needs a model, and the
  // preview-then-apply flow this used to check no longer exists — the agent
  // applies one transaction itself. Attaching the sketch, with the right
  // prompt, is the part that belongs to drawing.
  expect(await page.evaluate(() => window.__MONA_TEST__!.getState().presentation.slides[0]!.elements.length)).toBe(elementCount)

  // The sketch is written asynchronously, so wait for it to exist before
  // restarting; otherwise this asserts persistence against something that was
  // never persisted.
  await expect.poll(async () => (await readSketches(page)).length).toBe(1)
  await reloadApp(page)
  await expect(page.getByRole('application', { name: 'Editable slide canvas' })).toBeVisible()
  // The layer arrives with the workspace, which is loaded on demand — the test
  // above exists to prove exactly that. So what survives a restart is the
  // scene, and it is `openDrawing` (which asserts the layer) plus a clearable
  // drawing that shows it did.
  await openDrawing(page)
  await expect(page.getByRole('button', { name: 'Clear drawing' })).toBeEnabled()
  await page.getByRole('button', { name: 'Clear drawing' }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await page.getByTestId('confirm-clear-drawing').click()
  await expect(dialog).toHaveCount(0)
  await expect.poll(async () => (await readSketches(page)).length).toBe(0)
  await expect(page.getByRole('button', { name: 'Build this' })).toBeDisabled()
  expect(await page.evaluate(() => window.__MONA_TEST__!.getState().presentation.slides[0]!.elements.length)).toBe(elementCount)
})
