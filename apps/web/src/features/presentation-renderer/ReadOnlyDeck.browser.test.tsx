import { beforeAll, expect, test } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'

import type { PresentationState } from '@mona/presentation-core'

import { ReadOnlyDeck } from '@/features/presentation-renderer/ReadOnlyDeck'
import { initializeI18n } from '@/i18n'

beforeAll(async () => {
  await initializeI18n()
})

const presentation: PresentationState = {
  title: 'Renderer test',
  slides: [
    {
      id: 'slide-1',
      elements: [{
        id: 'text-1',
        type: 'text',
        left: 20,
        top: 20,
        width: 200,
        height: 50,
        rotate: 0,
        content: '<p>First slide</p>',
        defaultFontName: 'Arial',
        defaultColor: '#000',
      }],
    },
    {
      id: 'slide-2',
      elements: [{
        id: 'shape-1',
        type: 'shape',
        left: 20,
        top: 20,
        width: 200,
        height: 100,
        rotate: 0,
        fixedRatio: false,
        viewBox: [200, 100],
        path: 'M0 0 H200 V100 H0 Z',
        fill: '#d14424',
      }],
    },
  ],
  slideIndex: 0,
  viewportSize: 1000,
  viewportRatio: 0.5625,
  theme: {
    themeColors: [],
    fontColor: '#000',
    fontName: 'Arial',
    backgroundColor: '#fff',
    shadow: { h: 3, v: 3, blur: 2, color: '#808080' },
    outline: { width: 2, color: '#525252', style: 'solid' },
  },
  templates: [],
}

test('selects slides without exposing editing controls', async () => {
  await render(<div style={{ height: 700, width: 1200 }}><ReadOnlyDeck presentation={presentation} /></div>)

  expect(document.querySelector('.mona-render-stage [data-slide-id="slide-1"]')).not.toBeNull()
  await page.getByRole('button', { name: 'Show slide 2' }).click()
  expect(document.querySelector('.mona-render-stage [data-slide-id="slide-2"]')).not.toBeNull()
  await expect.element(page.getByRole('textbox')).not.toBeInTheDocument()
  expect(document.querySelectorAll('[data-element-type="shape"]').length).toBe(2)
})
