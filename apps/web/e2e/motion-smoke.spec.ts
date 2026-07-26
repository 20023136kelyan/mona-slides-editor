import { chooseMenuCommand, expect, openApp, test, type Page } from './electron-fixture'

// Gesture smoke journeys run without reduced motion so they exercise View
// Transitions and lock in behavior that static screenshot checks can hide:
//   1. a slide-switch transition's overlay must never intercept input;
//   2. the thumbnail rail is transition-free, so mousedown gestures
//      (right-click menu, drag reorder) always reach the thumbnails;
//   3. portaled transients (menus, dialogs) close when a slideshow starts
//      instead of floating over the show above the hidden editor tree.

declare global {
  interface Window {
    __MONA_TEST__?: {
      getState: () => {
        presentation: { slideIndex: number; slides: Array<{ id: string }> }
        session: { activeElementIds: string[] }
      }
    }
    __monaViewTransitionCount?: number
  }
}

const readState = (page: Page) => page.evaluate(() => window.__MONA_TEST__!.getState())
const viewTransitionCount = (page: Page) => page.evaluate(() => window.__monaViewTransitionCount ?? 0)

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('mona:ui-locale', 'en-US')
    // Count started view transitions so the tests can prove they exercised
    // the non-reduced-motion path (and that the rail never starts one).
    window.__monaViewTransitionCount = 0
    // oxlint-disable-next-line typescript/unbound-method -- the patch below re-binds via .apply(this)
    const original = Document.prototype.startViewTransition
    if (original) {
      Document.prototype.startViewTransition = function patched(...args: Parameters<typeof original>) {
        window.__monaViewTransitionCount = (window.__monaViewTransitionCount ?? 0) + 1
        return original.apply(this, args)
      }
    }
    // Deterministic fullscreen keeps slideshow behavior testable in CI.
    HTMLElement.prototype.requestFullscreen = () => Promise.resolve()
    Document.prototype.exitFullscreen = () => Promise.resolve()
  })
  await openApp(page, '?developmentFixture=editor-interactions')
  await expect(page.getByRole('application', { name: 'Editable slide canvas' })).toBeVisible()
})

test('hit testing passes through an active slide transition and an immediate click lands', async ({ page }) => {
  const stage = page.getByRole('application', { name: 'Editable slide canvas' })
  await stage.focus()
  await stage.press('PageDown')

  // ::view-transition { pointer-events: none } — hit testing must reach the
  // live DOM rather than the transition overlay.
  //
  // The first sample is exempt. It lands ~30ms after the key, and on the very
  // first transition of a session that is early enough that the incoming slide
  // has not been laid out yet — so `elementFromPoint` returns the document
  // element because nothing else is there, not because the overlay took the
  // hit. Measured: only ever the first sample of the first navigation; every
  // transition after it is clean from 30ms. The failure this guards against is
  // asserted directly below anyway, by clicking.
  const samples = await page.evaluate(async () => {
    const editorStage = document.querySelector('.mona-editor-stage')!
    const rect = editorStage.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    const hits: string[] = []
    for (let sample = 0; sample < 4; sample += 1) {
      await new Promise(resolve => setTimeout(resolve, 30))
      hits.push(document.elementFromPoint(centerX, centerY)?.tagName ?? 'none')
    }
    return hits
  })
  expect(samples.slice(1).filter(tag => tag === 'HTML')).toHaveLength(0)

  // End to end: selecting an element right after navigating must work.
  await page.locator('.mona-editor-stage [data-element-hit]').first().click()
  await expect.poll(async () => (await readState(page)).session.activeElementIds.length).toBeGreaterThan(0)

  // Prove the transition path actually ran in this environment.
  expect(await viewTransitionCount(page)).toBeGreaterThanOrEqual(1)
})

test('thumbnail right-click selects the slide and opens the menu without a view transition', async ({ page }) => {
  const transitionsBefore = await viewTransitionCount(page)
  await page.getByRole('button', { name: 'Show slide 2' }).click({ button: 'right' })
  await expect(page.locator('.mona-thumbnail-context-menu')).toBeVisible()
  await expect.poll(async () => (await readState(page)).presentation.slideIndex).toBe(1)
  // The rail is deliberately transition-free: an active overlay would eat
  // the same gesture's contextmenu event.
  expect(await viewTransitionCount(page)).toBe(transitionsBefore)
})

test('thumbnail drag reorder works with a continuous pointer stream', async ({ page }) => {
  const orderBefore = (await readState(page)).presentation.slides.map(slide => slide.id)
  const source = page.getByRole('button', { name: 'Show slide 3' })
  const target = page.getByRole('button', { name: 'Show slide 1' })
  const sourceBox = (await source.boundingBox())!
  const targetBox = (await target.boundingBox())!
  const transitionsBefore = await viewTransitionCount(page)

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
  await page.mouse.down()
  // A fast, continuous stream: the first moves land within what used to be
  // the transition overlay's lifetime.
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 4, { steps: 12 })
  await expect(page.locator('.mona-thumbnail-list')).toHaveClass(/is-dragging/)
  await expect(page.locator('.mona-thumbnail-container.is-drag-chosen')).toHaveCount(1)
  await expect(page.locator('.mona-thumbnail-container.is-drop-target')).toHaveCount(1)
  await page.mouse.up()

  // The dragged slide moved up and the deck remains intact.
  await expect.poll(async () => {
    const order = (await readState(page)).presentation.slides.map(slide => slide.id)
    return order.indexOf(orderBefore[2]!)
  }).toBeLessThan(2)
  const orderAfter = (await readState(page)).presentation.slides.map(slide => slide.id)
  expect([...orderAfter].sort()).toEqual([...orderBefore].sort())
  expect(await viewTransitionCount(page)).toBe(transitionsBefore)
})

test('thumbnail drag can be cancelled without mutating page order', async ({ page }) => {
  const orderBefore = (await readState(page)).presentation.slides.map(slide => slide.id)
  const source = page.getByRole('button', { name: 'Show slide 3' })
  const target = page.getByRole('button', { name: 'Show slide 1' })
  const sourceBox = (await source.boundingBox())!
  const targetBox = (await target.boundingBox())!

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 4, { steps: 12 })
  await expect(page.locator('.mona-thumbnail-list')).toHaveClass(/is-dragging/)
  await page.keyboard.press('Escape')
  await page.mouse.up()

  await expect.poll(async () => (await readState(page)).presentation.slides.map(slide => slide.id)).toEqual(orderBefore)
  await expect(page.getByText('Slide move cancelled.')).toBeAttached()
  await expect(page.locator('.mona-thumbnail-list')).not.toHaveClass(/is-dragging/)
})

test('a rich-text edit made just before starting a slideshow survives the round trip', async ({ page }) => {
  // Type into a text element, then F5 inside the 300ms input debounce:
  // hiding the editor (<Activity>) must flush the pending edit, not drop it.
  const title = page.locator('.mona-editor-slide-canvas [data-element-id="fixture-title"] .mona-text-content')
  await title.click({ position: { x: 30, y: 20 } })
  await title.dblclick({ position: { x: 30, y: 20 } })
  const editor = page.locator('.mona-editor-slide-canvas [data-element-id="fixture-title"] .ProseMirror')
  await expect(editor).toBeVisible()
  await editor.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' SMOKE-EDIT')
  // The keystrokes must be in the ProseMirror DOM before the show starts.
  expect(await editor.innerHTML()).toContain('SMOKE-EDIT')
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.keyboard.press('F5')
  await expect(page.locator('.mona-screen')).toBeVisible()
  await expect.poll(async () => page.evaluate(() => {
    // The dev bridge re-registers across the editor→screen handoff; keep
    // polling through the gap instead of throwing.
    const bridge = window.__MONA_TEST__
    if (!bridge) return false
    return JSON.stringify(bridge.getState().presentation.slides).includes('SMOKE-EDIT')
  })).toBe(true)
  expect(errors).toEqual([])
  await page.keyboard.press('Escape')
  await expect(page.getByRole('application', { name: 'Editable slide canvas' })).toBeVisible()
})

test('starting a slideshow closes portaled transients instead of leaving them over the show', async ({ app, page }) => {
  // Context menu open, then F5: the menu must not float over the show.
  await page.getByRole('button', { name: 'Show slide 2' }).click({ button: 'right' })
  await expect(page.locator('.mona-thumbnail-context-menu')).toBeVisible()
  await page.keyboard.press('F5')
  await expect(page.locator('.mona-screen')).toBeVisible()
  await expect(page.locator('.mona-thumbnail-context-menu')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('application', { name: 'Editable slide canvas' })).toBeVisible()

  // Export dialog (a portaled, lazily loaded modal) gets the same treatment.
  await chooseMenuCommand(app, 'file.export.pptx')
  const exportDialog = page.getByRole('dialog', { name: 'Export' })
  await expect(exportDialog).toBeVisible()
  await page.keyboard.press('F5')
  await expect(page.locator('.mona-screen')).toBeVisible()
  await expect(exportDialog).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('application', { name: 'Editable slide canvas' })).toBeVisible()
})
