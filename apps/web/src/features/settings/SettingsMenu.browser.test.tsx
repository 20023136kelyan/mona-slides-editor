import { beforeAll, beforeEach, expect, test } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'

import { SettingsMenu } from '@/features/settings/SettingsMenu'
import { initializeI18n, setLocale } from '@/i18n'

beforeAll(async () => {
  await initializeI18n()
})

beforeEach(async () => {
  localStorage.setItem('mona:ui-locale', 'en-US')
  await setLocale('en-US')
})

test('opens settings and changes the shared UI locale', async () => {
  await render(<SettingsMenu />)

  await page.getByRole('button', { name: 'Settings' }).click()
  await expect.element(page.getByText('Language', { exact: true })).toBeVisible()

  await page.getByRole('combobox', { name: 'Language' }).click()
  await page.getByRole('option', { name: 'Simplified Chinese' }).click()

  await expect.element(page.getByRole('button', { name: '设置' })).toBeVisible()
  expect(document.documentElement.lang).toBe('zh-CN')
  expect(localStorage.getItem('mona:ui-locale')).toBe('zh-CN')
})
