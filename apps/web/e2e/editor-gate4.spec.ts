import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('mona:ui-locale', 'en-US'))
  await page.goto('/?rendererFixture=gate4-editor')
  await expect(page.getByRole('application', { name: 'Editable slide canvas' })).toBeVisible()
})

test('does not activate snapping or guides until a real drag begins', async ({ page }) => {
  const target = page.getByRole('button', { name: 'Select shape gate3-radial-shape' })
  const rendered = page.locator('.mona-render-stage [data-element-id="gate3-radial-shape"]')
  const initialPosition = await rendered.evaluate(element => ({
    left: (element as HTMLElement).style.left,
    top: (element as HTMLElement).style.top,
  }))
  const targetBox = await target.boundingBox()
  expect(targetBox).not.toBeNull()
  const pointer = {
    x: targetBox!.x + targetBox!.width / 2,
    y: targetBox!.y + targetBox!.height / 2,
  }

  await page.mouse.move(pointer.x, pointer.y)
  await page.mouse.down()
  await page.mouse.move(pointer.x + 1, pointer.y + 1)
  await page.waitForTimeout(50)

  expect(await rendered.evaluate(element => ({
    left: (element as HTMLElement).style.left,
    top: (element as HTMLElement).style.top,
  }))).toEqual(initialPosition)
  await expect(page.locator('.mona-alignment-guide')).toHaveCount(0)
  await page.mouse.up()

  const dragBox = await target.boundingBox()
  expect(dragBox).not.toBeNull()
  const dragPointer = {
    x: dragBox!.x + dragBox!.width / 2,
    y: dragBox!.y + dragBox!.height / 2,
  }
  await page.mouse.move(dragPointer.x, dragPointer.y)
  await page.mouse.down()
  await page.mouse.move(dragPointer.x + 8, dragPointer.y)
  await expect(page.locator('.mona-alignment-guide')).toHaveCount(1)
  expect(await rendered.evaluate(element => ({
    left: (element as HTMLElement).style.left,
    top: (element as HTMLElement).style.top,
  }))).not.toEqual(initialPosition)
  await page.mouse.up()
})

test('selects, moves, resizes, rotates, and restores elements atomically', async ({ page }) => {
  const problems: string[] = []
  page.on('console', message => {
    if (message.type() === 'error' || message.type() === 'warning') problems.push(`${message.type()}: ${message.text()}`)
  })
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`))

  const target = page.getByRole('button', { name: 'Select shape gate3-radial-shape' })
  const rendered = page.locator('.mona-render-stage [data-element-id="gate3-radial-shape"]')
  await target.click()
  await expect(page.getByRole('button', { name: 'Resize bottom-right' })).toBeVisible()
  const initialLeft = await rendered.evaluate(element => (element as HTMLElement).style.left)
  const targetBox = await target.boundingBox()
  expect(targetBox).not.toBeNull()
  await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2)
  await page.mouse.down()
  await page.mouse.move(targetBox!.x + targetBox!.width / 2 + 70, targetBox!.y + targetBox!.height / 2 + 35, { steps: 4 })
  await page.mouse.up()
  await expect.poll(() => rendered.evaluate(element => (element as HTMLElement).style.left)).not.toBe(initialLeft)

  await page.waitForTimeout(350)
  await page.getByRole('application', { name: 'Editable slide canvas' }).press('Control+z')
  await expect.poll(() => rendered.evaluate(element => (element as HTMLElement).style.left)).toBe(initialLeft)
  await page.keyboard.press('Control+y')
  await expect.poll(() => rendered.evaluate(element => (element as HTMLElement).style.left)).not.toBe(initialLeft)
  await target.click()

  const widthBefore = Number.parseFloat(await rendered.evaluate(element => (element as HTMLElement).style.width))
  const resize = page.getByRole('button', { name: 'Resize bottom-right' })
  const resizeBox = await resize.boundingBox()
  await page.mouse.move(resizeBox!.x + resizeBox!.width / 2, resizeBox!.y + resizeBox!.height / 2)
  await page.mouse.down()
  await page.mouse.move(resizeBox!.x + 55, resizeBox!.y + 35, { steps: 3 })
  await page.mouse.up()
  await expect.poll(async () => Number.parseFloat(await rendered.evaluate(element => (element as HTMLElement).style.width))).toBeGreaterThan(widthBefore)

  const transformBefore = await rendered.locator('.mona-rotate-wrapper').evaluate(element => (element as HTMLElement).style.transform)
  const rotate = page.getByRole('button', { name: 'Rotate selection' })
  const selection = page.getByTestId('selection-frame')
  const rotateBox = await rotate.boundingBox()
  const selectionBox = await selection.boundingBox()
  await page.mouse.move(rotateBox!.x + rotateBox!.width / 2, rotateBox!.y + rotateBox!.height / 2)
  await page.mouse.down()
  await page.mouse.move(selectionBox!.x + selectionBox!.width + 40, selectionBox!.y + selectionBox!.height / 2, { steps: 4 })
  await page.mouse.up()
  await expect.poll(() => rendered.locator('.mona-rotate-wrapper').evaluate(element => (element as HTMLElement).style.transform)).not.toBe(transformBefore)
  expect(problems).toEqual([])
})

test('supports grouped selection, create gestures, context settings, clipboard, and deletion', async ({ page }) => {
  const canvas = page.getByRole('application', { name: 'Editable slide canvas' })
  const groupedShape = page.getByRole('button', { name: 'Select shape gate3-gradient-shape' })
  const groupedText = page.locator('.mona-editor-slide-canvas [data-element-id="gate3-title"] .mona-text-content')
  await groupedShape.click()
  await expect(page.locator('[aria-label="2 selected elements"]')).toBeVisible()
  await groupedShape.click({ button: 'right' })
  await expect(page.getByRole('menu', { name: 'Element menu' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Center horizontally' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Bring to front' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Add link' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Ungroup' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Insert rectangle' })).toHaveCount(0)
  await page.getByRole('menuitem', { name: 'Add link' }).click()
  await page.getByRole('textbox', { name: 'Web address' }).fill('https://example.com/deck')
  await page.getByRole('button', { name: 'Confirm' }).click()
  await groupedShape.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Add link' }).click()
  await expect(page.getByRole('textbox', { name: 'Web address' })).toHaveValue('https://example.com/deck')
  await page.getByRole('tab', { name: 'Slide', exact: true }).click()
  await expect(page.locator('.mona-link-slide-preview .mona-scaled-slide')).toBeVisible()
  await page.locator('.mona-link-select').click()
  await page.getByRole('option', { name: 'Slide 2' }).click()
  await page.getByRole('button', { name: 'Confirm' }).click()
  await groupedShape.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Add link' }).click()
  await expect(page.getByRole('tab', { name: 'Slide', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.mona-link-select-label')).toHaveText('Slide 2')
  await page.getByRole('button', { name: 'Cancel' }).click()
  await page.waitForTimeout(350)

  const groupPosition = () => page.evaluate(() => {
    const elements = window.__MONA_REACT_TEST__!.getState().presentation.slides[0]!.elements
    return {
      shape: elements.find(element => element.id === 'gate3-gradient-shape')!.left,
      text: elements.find(element => element.id === 'gate3-title')!.left,
    }
  })
  const groupBefore = await groupPosition()
  await groupedShape.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Center horizontally' }).click()
  const groupAfter = await groupPosition()
  expect(groupAfter.shape).not.toBe(groupBefore.shape)
  expect(groupAfter.shape - groupBefore.shape).toBeCloseTo(groupAfter.text - groupBefore.text, 3)
  await page.waitForTimeout(350)
  await canvas.press('Control+z')
  await expect.poll(groupPosition).toEqual(groupBefore)

  await groupedShape.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Ungroup' }).click()
  await groupedText.locator('.mona-text-drag-handler.is-top').click({ modifiers: ['Meta'] })
  await expect(page.locator('[aria-label="2 selected elements"]')).toBeVisible()
  await groupedShape.click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Bring to front' })).toBeDisabled()
  await page.getByRole('menuitem', { name: 'Group' }).click()
  await groupedShape.click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Ungroup' })).toBeVisible()
  await page.getByRole('menuitem', { name: 'Lock' }).click()
  await expect(page.locator('.mona-editor-status')).toHaveText('0 selected elements')
  await groupedShape.click({ button: 'right' })
  const lockedMenu = page.getByRole('menu', { name: 'Element menu' })
  await expect(lockedMenu.getByRole('menuitem')).toHaveCount(1)
  await expect(lockedMenu.getByRole('menuitem', { name: 'Unlock' })).toBeVisible()
  await lockedMenu.getByRole('menuitem', { name: 'Unlock' }).click()

  const elementCount = await page.locator('.mona-render-stage [data-element-id]').count()
  await groupedShape.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Copy' }).click()
  await groupedShape.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Paste' }).click()
  await expect.poll(() => page.locator('.mona-render-stage [data-element-id]').count()).toBe(elementCount + 2)
  await page.waitForTimeout(350)
  await page.keyboard.press('Delete')
  await expect.poll(() => page.locator('.mona-render-stage [data-element-id]').count()).toBe(elementCount)
  await page.waitForTimeout(350)
  await canvas.press('Control+z')
  await expect.poll(() => page.locator('.mona-render-stage [data-element-id]').count()).toBe(elementCount + 2)

  await canvas.click({ position: { x: 450, y: 700 } })
  await page.keyboard.press('r')
  await expect(canvas).toHaveAttribute('data-active-tool', 'shape')
  const slide = page.locator('.mona-editor-slide-canvas')
  const slideBox = await slide.boundingBox()
  const beforeCreate = await page.locator('.mona-render-stage [data-element-id]').count()
  await page.mouse.move(slideBox!.x + 25, slideBox!.y + slideBox!.height - 65)
  await page.mouse.down()
  await page.mouse.move(slideBox!.x + 125, slideBox!.y + slideBox!.height - 20, { steps: 3 })
  await page.mouse.up()
  await expect.poll(() => page.locator('.mona-render-stage [data-element-id]').count()).toBe(beforeCreate + 1)
  await expect(canvas).toHaveAttribute('data-active-tool', 'select')

  const blankCanvasPoint = { x: slideBox!.width - 20, y: slideBox!.height - 20 }
  await slide.click({ button: 'right', position: blankCanvasPoint })
  await expect(page.getByRole('menu', { name: 'Canvas menu' })).toBeVisible()
  await page.getByRole('menuitem', { name: 'Grid lines' }).hover()
  await expect(page.getByRole('menuitem', { name: 'Small' })).toBeVisible()
  await page.getByRole('menuitem', { name: 'Medium' }).click()
  await expect(page.locator('.mona-editor-grid')).toBeVisible()
  await slide.click({ button: 'right', position: blankCanvasPoint })
  await page.getByRole('menuitem', { name: 'Ruler' }).click()
  await expect(page.locator('.mona-editor-ruler.is-horizontal')).toBeVisible()
})

test('crops an image and supports lasso selection, zoom, and spacebar panning', async ({ page }) => {
  await page.getByRole('button', { name: 'Show slide 2' }).click()
  await page.getByRole('button', { name: 'Select image gate3-image-round' }).click()
  const cropModelBefore = await page.evaluate(() => {
    const element = window.__MONA_REACT_TEST__!.getState().presentation.slides[1]!.elements
      .find(item => item.id === 'gate3-image-round')!
    return structuredClone(element)
  })
  await page.getByRole('button', { name: 'Crop image' }).click()
  await expect(page.getByLabel('Image crop frame')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Move crop area' })).toBeVisible()
  const cropHandle = page.getByRole('button', { name: 'Crop right' })
  const cropBox = await cropHandle.boundingBox()
  await page.mouse.move(cropBox!.x + cropBox!.width / 2, cropBox!.y + cropBox!.height / 2)
  await page.mouse.down()
  await page.mouse.move(cropBox!.x - 30, cropBox!.y + cropBox!.height / 2, { steps: 3 })
  await page.mouse.up()
  expect(await page.evaluate(() => {
    const element = window.__MONA_REACT_TEST__!.getState().presentation.slides[1]!.elements
      .find(item => item.id === 'gate3-image-round')!
    return structuredClone(element)
  })).toEqual(cropModelBefore)

  await page.keyboard.press('Enter')
  await expect(page.getByLabel('Image crop frame')).toHaveCount(0)
  expect(await page.evaluate(() => {
    const element = window.__MONA_REACT_TEST__!.getState().presentation.slides[1]!.elements
      .find(item => item.id === 'gate3-image-round')!
    return structuredClone(element)
  })).not.toEqual(cropModelBefore)
  await page.waitForTimeout(350)
  await page.getByRole('application', { name: 'Editable slide canvas' }).press('Control+z')
  await expect.poll(() => page.evaluate(() => {
    const element = window.__MONA_REACT_TEST__!.getState().presentation.slides[1]!.elements
      .find(item => item.id === 'gate3-image-round')!
    return structuredClone(element)
  })).toEqual(cropModelBefore)

  const slide = page.locator('.mona-editor-slide-canvas')
  const lassoSlideBox = await slide.boundingBox()
  const lassoScale = lassoSlideBox!.width / 1000
  await page.mouse.move(lassoSlideBox!.x + 30 * lassoScale, lassoSlideBox!.y + 105 * lassoScale)
  await page.mouse.down()
  await page.mouse.move(lassoSlideBox!.x + 360 * lassoScale, lassoSlideBox!.y + 465 * lassoScale, { steps: 4 })
  await page.mouse.up()
  await expect(page.locator('[aria-label="1 selected element"]')).toBeVisible()

  const canvas = page.getByRole('application', { name: 'Editable slide canvas' })
  const frameBefore = await page.locator('.mona-editor-viewport-frame').boundingBox()
  await canvas.press('Control+=')
  const frameAfter = await page.locator('.mona-editor-viewport-frame').boundingBox()
  expect(frameAfter!.width).toBeGreaterThan(frameBefore!.width)

  await page.keyboard.down(' ')
  const stageBox = await canvas.boundingBox()
  const panBefore = await page.evaluate(() => window.__MONA_REACT_TEST__!.getState().session.canvasPan)
  await page.mouse.move(stageBox!.x + 70, stageBox!.y + 70)
  await page.mouse.down()
  await page.mouse.move(stageBox!.x + 120, stageBox!.y + 100, { steps: 2 })
  await page.mouse.up()
  await page.keyboard.up(' ')
  await expect.poll(() => page.evaluate(() => window.__MONA_REACT_TEST__!.getState().session.canvasPan)).toEqual({
    x: panBefore.x + 50,
    y: panBefore.y + 30,
  })
})
