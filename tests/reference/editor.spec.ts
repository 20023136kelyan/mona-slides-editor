import { expect, test, waitForReferenceEditor } from './fixtures'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await waitForReferenceEditor(page)
})

test('loads the complete desktop editor shell', async ({ page }) => {
  await expect(page).toHaveTitle('PPTist - 在线演示文稿')
  await expect(page.locator('.editor-header')).toBeVisible()
  await expect(page.locator('.thumbnails')).toBeVisible()
  await expect(page.locator('.canvas')).toBeVisible()
  await expect(page.locator('.viewport-wrapper')).toBeVisible()
  await expect(page.locator('.layout-content-right')).toBeVisible()
  await expect(page.locator('.thumbnail-item')).toHaveCount(3)
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible()
})

test('opens and closes settings without changing presentation content', async ({ page }) => {
  const settingsButton = page.getByRole('button', { name: 'Settings', exact: true })

  await settingsButton.click()
  await expect(page.locator('.settings-menu')).toBeVisible()
  await expect(page.getByText('Language', { exact: true })).toBeVisible()
  await expect(page.locator('.locale-switcher')).toContainText('English')
  await expect(page.locator('.settings-menu')).toHaveScreenshot('settings-menu.png')

  await settingsButton.click()
  await expect(page.locator('.settings-menu')).toBeHidden()
  await expect(page.getByText('Slide 1 of 3', { exact: true })).toBeVisible()
})

test('navigates between slide thumbnails', async ({ page }) => {
  const thumbnails = page.locator('.thumbnail-item')
  await expect(thumbnails).toHaveCount(3)

  await thumbnails.nth(1).click()

  await expect(page.getByText('Slide 2 of 3', { exact: true })).toBeVisible()
  await expect(page.locator('.thumbnail-item.active .label')).toHaveText('02')
  await expect(page).toHaveScreenshot('slide-2-selected.png', { fullPage: true })
})

test('edits the presentation title as native document state', async ({ page }) => {
  const nextTitle = 'Mona parity reference'

  await page.locator('.title-text').click()
  const titleInput = page.locator('.title-input input')
  await expect(titleInput).toBeFocused()
  await titleInput.fill(nextTitle)
  await titleInput.press('Tab')

  await expect(page.locator('.title-text')).toHaveText(nextTitle)
  const title = await page.evaluate(() => window.__MONA_TEST__?.getState().presentation.title)
  expect(title).toBe(nextTitle)
})

test('creates an editable slide and selects it', async ({ page }) => {
  await page.locator('.add-slide .btn').click()

  await expect(page.locator('.thumbnail-item')).toHaveCount(4)
  await expect(page.getByText('Slide 2 of 4', { exact: true })).toBeVisible()

  const state = await page.evaluate(() => window.__MONA_TEST__?.getState())
  expect(state?.presentation.slides).toHaveLength(4)
  expect(state?.presentation.slideIndex).toBe(1)
})

test('matches the initial visual oracle', async ({ page }) => {
  await expect(page).toHaveScreenshot('editor-initial.png', { fullPage: true })
})
