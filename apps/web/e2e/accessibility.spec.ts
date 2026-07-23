import { expect, test, type Locator, type Page } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('mona:ui-locale', 'en-US'))
})

const tabTo = async (page: Page, target: Locator, limit = 160, key = 'Tab') => {
  for (let step = 0; step < limit; step += 1) {
    if (await target.evaluate(element => element === document.activeElement).catch(() => false)) return
    await page.keyboard.press(key)
  }
  throw new Error(`Keyboard focus did not reach ${await target.getAttribute('aria-label') ?? await target.textContent()}`)
}

test('supports a keyboard-only editor, panel, agent, and modal walkthrough', async ({ page }) => {
  await page.goto('/?developmentFixture=slides')
  const canvas = page.getByRole('application', { name: 'Editable slide canvas' })
  await expect(canvas).toBeVisible()

  const skip = page.getByRole('link', { name: 'Skip to slide canvas' })
  await page.keyboard.press('Tab')
  await expect(skip).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(canvas).toBeFocused()

  // The skip link intentionally moves past the editor chrome. Reload before
  // auditing the complete header-first tab order from the document start.
  await page.reload()
  await expect(canvas).toBeVisible()

  const file = page.getByRole('button', { name: 'File', exact: true })
  await tabTo(page, file)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menu')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(file).toBeFocused()

  const elements = page.getByRole('navigation', { name: 'Editor tools' })
    .getByRole('button', { name: 'Elements', exact: true })
  await tabTo(page, elements)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('complementary', { name: 'Elements' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(elements).toBeFocused()

  const ai = page.getByRole('navigation', { name: 'Editor tools' })
    .getByRole('button', { name: 'AI', exact: true })
  await tabTo(page, ai)
  await page.keyboard.press('Enter')
  const composer = page.getByRole('textbox', { name: 'Message Mona AI' })
  await expect(composer).toBeFocused()
  await page.keyboard.type('Create an editable summary')
  await page.keyboard.press('Control+Enter')
  await expect(page.getByRole('button', { name: 'Apply edit' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(ai).toBeFocused()

  const exportButton = page.getByRole('button', { name: 'Export', exact: true })
  await tabTo(page, exportButton, 80, 'Shift+Tab')
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Export' })
  await expect(dialog).toBeVisible()
  for (let step = 0; step < 12; step += 1) {
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(exportButton).toBeFocused()
})

test('moves keyboard focus through contextual, filmstrip, and grid workspaces', async ({ page }) => {
  await page.goto('/?developmentFixture=editor-interactions')
  const canvas = page.getByRole('application', { name: 'Editable slide canvas' })
  await expect(canvas).toBeVisible()

  await page.getByRole('button', { name: 'Select shape fixture-radial-shape' }).click()
  const contextual = page.getByRole('toolbar', { name: 'Inspector' })
  await page.keyboard.press('Control+F1')
  await expect.poll(() => contextual.evaluate(element => element.contains(document.activeElement))).toBe(true)
  const firstContextualControl = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent)
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => page.evaluate(previous => (
    (document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent) !== previous
  ), firstContextualControl)).toBe(true)

  const firstFilmstripPage = page.getByRole('button', { name: 'Show slide 1' })
  await firstFilmstripPage.focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('button', { name: 'Show slide 2' })).toBeFocused()

  await page.getByRole('button', { name: 'Grid view' }).click()
  const firstGridPage = page.getByRole('option', { name: 'Show slide 2' })
  await expect(firstGridPage).toBeFocused()
  await page.keyboard.press('Home')
  await expect(page.getByRole('option', { name: 'Show slide 1' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(canvas).toBeFocused()
})

test('keeps compact desktop geometry bounded with both editor side surfaces active', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 720 })
  await page.goto('/?developmentFixture=slides')
  await page.getByRole('navigation', { name: 'Editor tools' }).getByRole('button', { name: 'Elements' }).click()
  await expect(page.getByRole('complementary', { name: 'Elements' })).toBeVisible()
  await page.getByRole('button', { name: 'Generate presentation with AI' }).click()
  await expect(page.getByRole('complementary', { name: 'Mona AI' })).toBeVisible()

  const geometry = await page.evaluate(() => {
    const drawer = document.querySelector<HTMLElement>('.mona-editor-drawer')
    const stage = document.querySelector<HTMLElement>('.mona-editor-stage')?.getBoundingClientRect()
    const agent = document.querySelector<HTMLElement>('.mona-agent-dock')?.getBoundingClientRect()
    const headerTargets = Array.from(document.querySelectorAll<HTMLElement>('.mona-editor-header button'))
      .filter(element => getComputedStyle(element).display !== 'none')
      .map(element => {
        const rect = element.getBoundingClientRect()
        return { height: rect.height, width: rect.width }
      })
    return {
      agentWidth: agent?.width ?? 0,
      drawerDisplay: drawer ? getComputedStyle(drawer).display : null,
      headerTargets,
      horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
      stageWidth: stage?.width ?? 0,
    }
  })
  expect(geometry.drawerDisplay).toBe('none')
  expect(geometry.horizontalOverflow).toBeLessThanOrEqual(1)
  expect(geometry.agentWidth).toBeGreaterThanOrEqual(280)
  expect(geometry.agentWidth).toBeLessThanOrEqual(520)
  expect(geometry.headerTargets.length).toBeGreaterThan(0)
  expect(Math.min(...geometry.headerTargets.map(target => target.height))).toBeGreaterThanOrEqual(40)
  expect(Math.min(...geometry.headerTargets.map(target => target.width))).toBeGreaterThanOrEqual(40)
  expect(geometry.stageWidth).toBeGreaterThan(300)
})

test('keeps every page-grid bulk action reachable beside the agent at compact width', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 720 })
  await page.goto('/?developmentFixture=slides')
  await page.getByRole('button', { name: 'Generate presentation with AI' }).click()
  await page.getByRole('button', { name: 'Grid view' }).click()

  const gridActions = page.locator('.mona-page-grid-actions')
  await expect(gridActions).toBeVisible()
  for (const name of ['Select all', 'Add slide', 'Show', 'Hide', 'Duplicate slide', 'Delete slide', 'Close grid view']) {
    const action = gridActions.getByRole('button', { name, exact: true })
    await action.focus()
    await expect(action).toBeFocused()
    await expect(action).toBeInViewport()
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
})

test('does not transiently shift selected content when guides and controls appear', async ({ page }) => {
  await page.goto('/?developmentFixture=editor-interactions')
  const element = page.locator('.mona-render-stage [data-element-id="fixture-radial-shape"]')
  const selectionTarget = page.getByRole('button', { name: 'Select shape fixture-radial-shape' })
  await expect(element).toBeVisible()

  await page.evaluate(() => {
    const target = document.querySelector<HTMLElement>('.mona-render-stage [data-element-id="fixture-radial-shape"]')
    const stage = document.querySelector<HTMLElement>('.mona-editor-slide-canvas')
    const samples: Array<{ element: DOMRect; stage: DOMRect }> = []
    Object.assign(window, { __monaLayoutSamples: samples })
    let remaining = 30
    const sample = () => {
      if (!target || !stage || remaining-- <= 0) return
      samples.push({ element: target.getBoundingClientRect(), stage: stage.getBoundingClientRect() })
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
  await selectionTarget.click()
  await page.waitForTimeout(520)
  const spread = await page.evaluate(() => {
    const samples = (window as typeof window & {
      __monaLayoutSamples: Array<{ element: DOMRect; stage: DOMRect }>
    }).__monaLayoutSamples
    const range = (values: number[]) => Math.max(...values) - Math.min(...values)
    return {
      elementHeight: range(samples.map(sample => sample.element.height)),
      elementLeft: range(samples.map(sample => sample.element.left)),
      elementTop: range(samples.map(sample => sample.element.top)),
      elementWidth: range(samples.map(sample => sample.element.width)),
      stageHeight: range(samples.map(sample => sample.stage.height)),
      stageLeft: range(samples.map(sample => sample.stage.left)),
      stageTop: range(samples.map(sample => sample.stage.top)),
      stageWidth: range(samples.map(sample => sample.stage.width)),
    }
  })
  for (const movement of Object.values(spread)) expect(movement).toBeLessThanOrEqual(1)
})
