import { beforeAll, beforeEach, expect, test } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'

import type { PresentationState } from '@mona/presentation-core'

import { EditorDeck } from '@/features/editor/EditorDeck'
import { initializeI18n, setLocale } from '@/i18n'

beforeAll(async () => {
  await initializeI18n()
})

beforeEach(async () => {
  await setLocale('en-US')
})

const presentation: PresentationState = {
  title: 'Interaction fixture',
  slides: [{
    id: 'slide-1',
    elements: [{
      id: 'shape-1',
      type: 'shape',
      left: 100,
      top: 100,
      width: 200,
      height: 120,
      rotate: 0,
      fixedRatio: false,
      viewBox: [200, 120],
      path: 'M0 0 H200 V120 H0 Z',
      fill: '#d14424',
    }],
  }],
  slideIndex: 0,
  viewportSize: 1000,
  viewportRatio: 0.5625,
  theme: {
    themeColors: [],
    fontColor: '#000',
    fontName: 'Arial',
    backgroundColor: '#fff',
    shadow: { h: 0, v: 0, blur: 0, color: '#000' },
    outline: { width: 1, color: '#000', style: 'solid' },
  },
  templates: [],
}

test('selects rendered elements and exposes transform handles without replacing the renderer', async () => {
  await render(<div style={{ height: 700, width: 1200 }}><EditorDeck presentation={presentation} /></div>)

  await page.getByRole('button', { name: 'Select shape shape-1' }).click()
  expect(document.querySelector('[aria-label="1 selected element"]')).not.toBeNull()
  await expect.element(page.getByRole('button', { name: 'Resize bottom-right' })).toBeVisible()
  await expect.element(page.getByRole('button', { name: 'Rotate selection' })).toBeVisible()
  expect(document.querySelectorAll('[data-element-type="shape"]')).toHaveLength(2)
})

test('activates creation tools from the focused canvas keyboard surface', async () => {
  await render(<div style={{ height: 700, width: 1200 }}><EditorDeck presentation={presentation} /></div>)
  const canvas = document.querySelector<HTMLElement>('[aria-label="Editable slide canvas"]')!
  await page.getByRole('application', { name: 'Editable slide canvas' }).click({ position: { x: 20, y: 20 } })
  canvas.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'r' }))
  await expect.element(page.getByRole('application', { name: 'Editable slide canvas' })).toHaveAttribute('data-active-tool', 'shape')
  await expect.element(page.getByText('shape creation tool active')).toBeInTheDocument()
})
