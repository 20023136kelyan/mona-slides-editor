import { expect, test as base, type Page } from '@playwright/test'

interface MonaTestWindow extends Window {
  __MONA_TEST__?: {
    isReady: () => boolean
    getState: () => unknown
  }
}

export const waitForReferenceEditor = async (page: Page) => {
  await expect(page.locator('.pptist-editor')).toBeVisible()
  await page.waitForFunction(() => (window as MonaTestWindow).__MONA_TEST__?.isReady() === true)
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  await expect(page.getByText('Slide 1 of 3', { exact: true })).toBeVisible()
}

export const test = base.extend({
  page: async ({ page }, use) => {
    const browserMessages: string[] = []

    page.on('console', message => {
      if (message.type() === 'error' || message.type() === 'warning') {
        browserMessages.push(`${message.type()}: ${message.text()}`)
      }
    })
    page.on('pageerror', error => browserMessages.push(`pageerror: ${error.message}`))

    await page.addInitScript(() => {
      localStorage.setItem('mona:ui-locale', 'en-US')
    })

    await use(page)
    expect(browserMessages, 'reference page emitted browser warnings/errors').toEqual([])
  },
})

export { expect } from '@playwright/test'
