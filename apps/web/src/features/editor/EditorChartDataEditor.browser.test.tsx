import { beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'

import type { PPTChartElement } from '@mona/presentation-core/model'

import { EditorChartDataEditor } from '@/features/editor/EditorChartDataEditor'
import { initializeI18n, setLocale } from '@/i18n'

const chart: PPTChartElement = {
  type: 'chart',
  id: 'chart',
  left: 0,
  top: 0,
  width: 500,
  height: 300,
  rotate: 0,
  chartType: 'bar',
  data: {
    labels: ['Category 1', 'Category 2'],
    legends: ['Series 1', 'Series 2'],
    series: [[12, 18], [7, 11]],
  },
  themeColors: ['#111111', '#777777'],
}

beforeAll(async () => {
  await initializeI18n()
})

beforeEach(async () => {
  await setLocale('en-US')
})

test('edits named chart cells and saves the selected chart type as native data', async () => {
  const onClose = vi.fn<() => void>()
  const onSave = vi.fn<Parameters<typeof EditorChartDataEditor>[0]['onSave']>()
  await render(<EditorChartDataEditor element={chart} onClose={onClose} onSave={onSave} />)

  await expect.element(page.getByRole('dialog', { name: 'Edit chart' })).toBeVisible()
  await page.getByRole('textbox', { exact: true, name: 'Chart data cell B1' }).fill('Revenue')
  await page.getByRole('textbox', { exact: true, name: 'Chart data cell B2' }).fill('42')
  await page.getByRole('button', { name: 'Click to change' }).click()
  await page.getByRole('button', { name: 'Line chart' }).click()
  const confirm = Array.from(document.querySelectorAll<HTMLButtonElement>('.mona-chart-editor-buttons-right button'))
    .find(button => button.textContent === 'Confirm')!
  confirm.click()

  expect(onSave).toHaveBeenCalledWith({
    type: 'line',
    data: {
      labels: ['Category 1', 'Category 2'],
      legends: ['Revenue', 'Series 2'],
      series: [[42, 18], [7, 11]],
    },
  })
  expect(onClose).not.toHaveBeenCalled()
})
