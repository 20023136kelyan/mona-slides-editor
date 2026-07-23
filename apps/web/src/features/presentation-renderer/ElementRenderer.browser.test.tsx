import { expect, test } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'

import type { PPTGroupElement, PPTOpaqueElement, SlideTheme } from '@mona/presentation-core/model'

import { ElementRenderer } from '@/features/presentation-renderer/ElementRenderer'

const theme: SlideTheme = {
  backgroundColor: '#ffffff',
  fontColor: '#111111',
  fontName: 'Arial',
  outline: { color: '#111111', style: 'solid', width: 1 },
  shadow: { blur: 0, color: '#000000', h: 0, v: 0 },
  themeColors: [],
}

test('renders nested group geometry in a retained local coordinate space', async () => {
  const group: PPTGroupElement = {
    coordinateHeight: 100,
    coordinateWidth: 200,
    elements: [{
      content: '<p>Nested native text</p>',
      defaultColor: '#111111',
      defaultFontName: 'Arial',
      height: 30,
      id: 'nested-text',
      left: 20,
      rotate: 0,
      top: 10,
      type: 'text',
      width: 120,
    }],
    flipH: true,
    height: 200,
    id: 'native-group',
    left: 40,
    rotate: 15,
    top: 60,
    type: 'group',
    width: 400,
  }

  await render(<ElementRenderer element={group} theme={theme} />)

  const root = page.getByRole('region', { name: 'PowerPoint group' })
  await expect.element(root).toBeVisible()
  await expect.element(page.getByText('Nested native text')).toBeVisible()
  await expect.element(root).toHaveStyle({ transform: 'rotate(15deg) scale(-1, 1)' })
  await expect.element(page.getByTestId('group-content-native-group')).toHaveStyle({ transform: 'scale(2, 2)' })
  await expect.element(page.getByText('Nested native text')).toBeVisible()
})

test('renders a neutral selectable placeholder for an opaque PowerPoint object', async () => {
  const opaque: PPTOpaqueElement = {
    height: 80,
    id: 'opaque-object',
    label: 'Embedded object',
    left: 10,
    opaqueType: 'http://schemas.openxmlformats.org/presentationml/2006/ole',
    reason: 'No semantic renderer is available',
    rotate: 5,
    top: 20,
    type: 'opaque',
    width: 160,
  }

  await render(<ElementRenderer element={opaque} theme={theme} />)

  const root = page.getByRole('figure', { name: 'Embedded object' })
  await expect.element(root).toBeVisible()
  await expect.element(page.getByText('Embedded object')).toBeVisible()
  await expect.element(root).toHaveAttribute('data-element-type', 'opaque')
  await expect.element(root).toHaveAttribute('title', 'No semantic renderer is available')
})
