import { expect, test } from 'vitest'
import { render } from 'vitest-browser-react'

import type { PPTShapeElement, SlideTheme } from '@mona/presentation-core/model'

import { ElementRenderer } from '@/features/presentation-renderer/ElementRenderer'

const theme: SlideTheme = {
  backgroundColor: '#ffffff',
  fontColor: '#111111',
  fontName: 'Arial',
  outline: { color: '#111111', style: 'solid', width: 1 },
  shadow: { blur: 0, color: '#000000', h: 0, v: 0 },
  themeColors: [],
}

const picture = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

const shape = (elementId: string, patternFit?: PPTShapeElement['patternFit']): PPTShapeElement => ({
  fill: '',
  fixedRatio: false,
  height: 200,
  id: elementId,
  left: 0,
  path: 'M 0 0 L 400 0 L 400 200 L 0 200 Z',
  pattern: picture,
  ...(patternFit ? { patternFit } : {}),
  rotate: 0,
  top: 0,
  type: 'shape',
  viewBox: [400, 200],
  width: 400,
})

const patternImage = async (elementId: string) => {
  const select = () => document.querySelector<SVGImageElement>(
    `[data-element-id="${elementId}"] pattern image`,
  )
  await expect.poll(() => Boolean(select())).toBe(true)
  return select()!
}

test('stretches an imported picture fill to its shape instead of cropping it', async () => {
  const element = shape('fit-stretch', { mode: 'stretch', rect: { b: 0, l: 0, r: 0, t: 0 } })
  void render(<ElementRenderer element={element} theme={theme} />)

  const image = await patternImage(element.id)
  // `a:stretch` fits the picture to the shape and distorts it when the aspect
  // ratios differ. A cover-crop would hide part of the artwork.
  expect(image.getAttribute('preserveAspectRatio')).toBe('none')
  expect(Number(image.getAttribute('width'))).toBeCloseTo(400)
  expect(Number(image.getAttribute('height'))).toBeCloseTo(200)
  expect(Number(image.getAttribute('x'))).toBeCloseTo(0)
  expect(Number(image.getAttribute('y'))).toBeCloseTo(0)
})

test('lets a negative fill rect push the picture outside the shape so it crops', async () => {
  // Canva writes crops this way: the destination reaches past the shape and
  // the shape clips it.
  const element = shape('fit-crop', { mode: 'stretch', rect: { b: -0.25, l: -0.5, r: 0, t: 0 } })
  void render(<ElementRenderer element={element} theme={theme} />)

  const image = await patternImage(element.id)
  expect(Number(image.getAttribute('x'))).toBeCloseTo(-200)
  expect(Number(image.getAttribute('width'))).toBeCloseTo(600)
  expect(Number(image.getAttribute('height'))).toBeCloseTo(250)
})

test('keeps the editor cover-crop for a pattern with no imported fill mode', async () => {
  const element = shape('fit-legacy')
  void render(<ElementRenderer element={element} theme={theme} />)

  const image = await patternImage(element.id)
  expect(image.getAttribute('preserveAspectRatio')).toBe('xMidYMid slice')
})
