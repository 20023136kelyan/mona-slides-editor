import { beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'

import { EditorPanelSearchProvider } from '@/features/editor/panel/editor-panel-search'
import { PanelSearchBar } from '@/features/editor/panel/EditorPanelPrimitives'

import { EditorChartsPanel } from '@/features/editor/EditorChartsPanel'
import { initializeI18n, setLocale } from '@/i18n'

beforeAll(async () => {
  await initializeI18n()
})

beforeEach(async () => {
  await setLocale('en-US')
})

test('keeps chart catalog browse and see-all inside the panel', async () => {
  const onInsertChart = vi.fn()
  await render(
    <div style={{ height: 640, width: 352 }}>
      <EditorPanelSearchProvider mode="submit" route="charts">
        <PanelSearchBar label="Search" placeholder="Search charts" />
        <EditorChartsPanel onInsertChart={onInsertChart} />
      </EditorPanelSearchProvider>
    </div>,
  )

  await expect.element(page.getByPlaceholder('Search charts')).toBeVisible()
  await expect.element(page.getByRole('button', { name: 'Start with data' })).toBeVisible()
  await expect.element(page.getByRole('heading', { name: 'Bar charts' })).toBeVisible()
  expect(document.querySelector('[role="dialog"]')).toBeNull()

  await page.getByRole('button', { name: 'See all' }).first().click()
  await expect.element(page.getByRole('button', { name: 'Back to charts' })).toBeVisible()
  await expect.element(page.getByRole('heading', { name: 'Bar charts' })).toBeVisible()

  await page.getByRole('button', { name: 'Stacked column' }).click()
  expect(onInsertChart).toHaveBeenCalledWith({
    chartType: 'bar',
    options: { stack: true },
    seriesCount: 2,
  })

  await page.getByRole('button', { name: 'Back to charts' }).click()
  await page.getByRole('button', { name: 'Start with data' }).click()
  expect(onInsertChart).toHaveBeenCalledWith({
    chartType: 'bar',
    seriesCount: 2,
    openDataEditor: true,
  })
})
