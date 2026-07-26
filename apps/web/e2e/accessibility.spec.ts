import { expect, isMacChrome, openApp, resizeWindow, test, type Locator, type Page } from './electron-fixture'

test.beforeEach(async ({ app, page }) => {
  await page.addInitScript(() => localStorage.setItem('mona:ui-locale', 'en-US'))
})

const tabTo = async (page: Page, target: Locator, limit = 160, key = 'Tab') => {
  for (let step = 0; step < limit; step += 1) {
    if (await target.evaluate(element => element === document.activeElement).catch(() => false)) return
    await page.keyboard.press(key)
  }
  throw new Error(`Keyboard focus did not reach ${await target.getAttribute('aria-label') ?? await target.textContent()}`)
}

test('supports a keyboard-only editor, panel, agent, and modal walkthrough', async ({ app, page }) => {
  await openApp(page, '?developmentFixture=slides')
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

  // The rail spans the full height and precedes the header in the DOM, so this
  // walk follows that order: rail first, then the header's controls.
  const elements = page.getByRole('navigation', { name: 'Editor tools' })
    .getByRole('button', { name: 'Shape', exact: true })
  await tabTo(page, elements)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('complementary', { name: 'Elements' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(elements).toBeFocused()
  // The drawer now sits between the rail and the header, so every control it
  // holds is in the tab path. Collapse it from the focused rail button before
  // walking on, or the shape pool alone outruns the step budget.
  const elementsPanel = page.getByRole('complementary', { name: 'Elements' })
  if (await elementsPanel.isVisible()) await page.keyboard.press('Enter')
  await expect(elementsPanel).toBeHidden()

  // Only where the menus are in the window. On macOS they are in the system
  // menu bar, which the operating system makes keyboard-reachable itself and
  // which nothing in the window can tab to — the walk would spend its whole
  // step budget looking for a button that is not there.
  if (!isMacChrome) {
    const file = page.getByRole('button', { name: 'File', exact: true })
    await tabTo(page, file)
    await page.keyboard.press('Enter')
    await expect(page.getByRole('menu')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(file).toBeFocused()
  }

  // The AI panel is opened from the top bar; it's no longer a tool-rail item.
  const ai = page.getByRole('button', { name: 'Generate presentation with AI' })
  await tabTo(page, ai, 80)
  await page.keyboard.press('Enter')
  const composer = page.getByRole('textbox', { name: 'Message Mona AI' })
  await expect(composer).toBeFocused()
  // Typing is asserted; sending is not. A turn needs a model, and the edit it
  // used to preview behind an "Apply edit" button is not how the agent works
  // any more — it applies one transaction of its own accord. What this walk is
  // for is the keyboard contract around the dock, and that is all here.
  await page.keyboard.type('Create an editable summary')
  await expect(composer).toHaveValue('Create an editable summary')
  await page.keyboard.press('Escape')
  await expect(ai).toBeFocused()

  // A popover is not a modal, so the contract is: it takes focus on open, and
  // Escape returns it to the trigger — not that focus is trapped inside.
  const shareButton = page.getByRole('button', { name: 'Share', exact: true })
  await tabTo(page, shareButton, 20)
  await page.keyboard.press('Enter')
  const sharePanel = page.getByRole('dialog', { name: 'Share' })
  await expect(sharePanel).toBeVisible()
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(sharePanel).toHaveCount(0)
  await expect(shareButton).toBeFocused()
})

test('moves keyboard focus through contextual, filmstrip, and grid workspaces', async ({ app, page }) => {
  await openApp(page, '?developmentFixture=editor-interactions')
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

test('keeps compact desktop geometry bounded with both editor side surfaces active', async ({ app, page }) => {
  await resizeWindow(app, 1024, 720)
  await openApp(page, '?developmentFixture=slides')
  await page.getByRole('navigation', { name: 'Editor tools' }).getByRole('button', { name: 'Shape' }).click()
  await expect(page.getByRole('complementary', { name: 'Elements' })).toBeVisible()
  await page.getByRole('button', { name: 'Generate presentation with AI' }).click()
  await expect(page.getByRole('complementary', { name: 'Mona AI' })).toBeVisible()

  const geometry = await page.evaluate(() => {
    // The compact layout collapses the drawer's animating region (which also
    // removes the drawer from layout), so check the region's display.
    const drawer = document.querySelector<HTMLElement>('.mona-drawer-region')
    const stage = document.querySelector<HTMLElement>('.mona-editor-stage')?.getBoundingClientRect()
    const agent = document.querySelector<HTMLElement>('.mona-agent-dock')?.getBoundingClientRect()
    // Checking each element's own `display` is not enough: the header keeps a
    // hidden alternate menu, and its buttons still compute `inline-flex` inside
    // a `display: none` parent. Only count controls that actually render.
    const headerTargets = Array.from(document.querySelectorAll<HTMLElement>('.mona-editor-header button'))
      .filter(element => element.getClientRects().length > 0)
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
  // The header runs a deliberate 28px control scale, so the bar is WCAG 2.2 AA
  // target size (24x24) — the same threshold EditorHeader.browser.test.tsx
  // asserts. The grouped Present control is 26px tall (h-7 less its borders).
  expect(Math.min(...geometry.headerTargets.map(target => target.height))).toBeGreaterThanOrEqual(24)
  expect(Math.min(...geometry.headerTargets.map(target => target.width))).toBeGreaterThanOrEqual(24)
  expect(geometry.stageWidth).toBeGreaterThan(300)
})

test('keeps every page-grid bulk action reachable beside the agent at compact width', async ({ app, page }) => {
  await resizeWindow(app, 1024, 720)
  await openApp(page, '?developmentFixture=slides')
  await page.getByRole('button', { name: 'Generate presentation with AI' }).click()
  // Wait for the dock before opening the grid: it takes width from the grid,
  // and measuring the row while it is still arriving measures the wrong layout.
  await expect(page.getByRole('complementary', { name: 'Mona AI' })).toBeVisible()
  await page.getByRole('button', { name: 'Grid view' }).click()

  const gridActions = page.locator('.mona-page-grid-actions')
  await expect(gridActions).toBeVisible()
  for (const name of ['Select all', 'Add slide', 'Show', 'Hide', 'Duplicate slide', 'Delete slide', 'Close grid view']) {
    const action = gridActions.getByRole('button', { name, exact: true })
    await action.focus()
    await expect(action).toBeFocused()
    // The row scrolls horizontally by design; reachable means it can be brought
    // into view, not that it already is. The page not scrolling is asserted
    // once, below, which is the thing compact width could actually break.
    await action.scrollIntoViewIfNeeded()
    // Geometry rather than `toBeInViewport`. That matcher asks an
    // IntersectionObserver, which reports nothing at all for a window the
    // compositor considers occluded — and running these in parallel stacks the
    // windows, so it failed on buttons measurably inside the window (left 86,
    // right 182, of 1024). What the test means is that the control fits within
    // the window at this width, and that is what a rectangle can say.
    expect(await action.evaluate(el => {
      const rect = el.getBoundingClientRect()
      return rect.left >= 0 && rect.top >= 0
        && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight
    })).toBe(true)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
})

test('keeps slideshow navigation, tools, and presenter controls keyboard-safe', async ({ app, page }) => {
  await openApp(page, '?developmentFixture=slides')
  const launch = page.getByRole('button', { name: 'Start slideshow (F5)' })
  await launch.focus()
  await launch.press('Enter')

  const next = page.getByRole('button', { name: 'Next slide' })
  const previous = page.getByRole('button', { name: 'Previous slide' })
  await expect(next).toBeFocused()
  await expect(previous).toBeDisabled()
  await next.press('Enter')
  await expect(page.getByRole('button', { name: 'View all slides' })).toHaveText('Slide 2 / 3')
  await expect(previous).toBeEnabled()

  const slideshowCanvas = page.getByRole('application', { name: 'Slideshow canvas' })
  await slideshowCanvas.focus()
  await slideshowCanvas.press('Shift+F10')
  const contextMenu = page.getByRole('menu').first()
  await expect(contextMenu.getByRole('menuitem', { name: /Previous slide/ })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(contextMenu.getByRole('menuitem', { name: /Next slide/ })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(contextMenu).toHaveCount(0)
  await expect(slideshowCanvas).toBeFocused()

  const timerTrigger = page.getByRole('button', { name: 'Timer', exact: true })
  await timerTrigger.focus()
  await page.waitForTimeout(250)
  await expect(timerTrigger).toBeInViewport()
  await timerTrigger.press('Enter')
  const timer = page.getByRole('dialog', { name: 'Timer' })
  await expect(timer).toBeVisible()
  const start = timer.getByRole('button', { name: 'Start' })
  await expect(start).toBeFocused()
  await start.press('Enter')
  await expect(timer.getByRole('button', { name: 'Pause' })).toBeFocused()
  await timer.getByRole('button', { name: 'Pause' }).press('Enter')
  const countdown = timer.getByRole('button', { name: 'Countdown' })
  await countdown.press('Enter')
  await expect(countdown).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'View all slides' })).toHaveText('Slide 2 / 3')

  const panelBefore = await timer.boundingBox()
  const movePanel = timer.getByRole('button', { name: /Move panel/ })
  await movePanel.focus()
  await movePanel.press('Shift+ArrowRight')
  await expect.poll(async () => (await timer.boundingBox())?.x).toBe((panelBefore?.x ?? 0) + 10)

  await timer.getByRole('button', { name: 'Close' }).press('Enter')
  await expect(timer).toHaveCount(0)
  await expect(timerTrigger).toBeFocused()

  const allSlidesTrigger = page.getByRole('button', { name: 'View all slides' })
  await allSlidesTrigger.press('Enter')
  const allSlides = page.getByRole('dialog', { name: 'View all slides' })
  await expect(allSlides.getByRole('button', { name: 'Close' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(allSlides).toHaveCount(0)
  await expect(allSlidesTrigger).toBeFocused()

  const penTrigger = page.getByRole('button', { name: 'Pen tools' })
  await penTrigger.press('Enter')
  const penTools = page.getByRole('dialog', { name: 'Pen tools' })
  const pen = penTools.getByRole('button', { name: 'Pen', exact: true })
  await expect(pen).toBeFocused()
  await pen.press('Enter')
  await expect(page.getByRole('slider', { name: 'Stroke width:' })).toBeVisible()
  await pen.press('Enter')
  await expect(page.getByRole('slider', { name: 'Stroke width:' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(penTools).toHaveCount(0)
  await expect(penTrigger).toBeFocused()

  const presenterTrigger = page.getByRole('button', { name: 'Presenter view' })
  await presenterTrigger.press('Enter')
  const presenter = page.locator('.mona-screen-presenter')
  await expect(presenter.getByRole('button', { name: 'Standard view' })).toBeFocused()
  const presenterTimer = presenter.getByRole('button', { name: 'Timer', exact: true })
  await presenterTimer.press('Enter')
  await expect(page.getByRole('dialog', { name: 'Timer' }).getByRole('button', { name: 'Start' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(presenterTimer).toBeFocused()

  await presenter.getByRole('button', { name: 'End slideshow' }).press('Enter')
  await expect(page.getByRole('application', { name: 'Editable slide canvas' })).toBeVisible()
  await expect(launch).toBeFocused()
})

test('does not transiently shift selected content when guides and controls appear', async ({ app, page }) => {
  await openApp(page, '?developmentFixture=editor-interactions')
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
