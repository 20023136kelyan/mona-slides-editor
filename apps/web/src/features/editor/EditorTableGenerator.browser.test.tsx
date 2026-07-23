import { beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'

import { EditorTableGenerator } from '@/features/editor/EditorTableGenerator'
import { initializeI18n, setLocale } from '@/i18n'

beforeAll(async () => {
  await initializeI18n()
})

beforeEach(async () => {
  await setLocale('en-US')
})

test('makes the dimension grid keyboard operable with one roving tab stop', async () => {
  const onInsert = vi.fn<(rows: number, columns: number) => void>()
  await render(<EditorTableGenerator onInsert={onInsert} />)

  const first = document.querySelector<HTMLButtonElement>('[aria-label="Table 1 × 1"]')!
  first.focus()
  first.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }))
  await new Promise(resolve => requestAnimationFrame(resolve))
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Table 1 × 2')
  document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }))
  await new Promise(resolve => requestAnimationFrame(resolve))
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Table 2 × 2')
  await page.getByRole('button', { name: 'Table 2 × 2' }).click()

  expect(onInsert).toHaveBeenCalledWith(2, 2)
  expect(document.querySelectorAll('.mona-table-generator > table button[tabindex="0"]')).toHaveLength(1)
})
