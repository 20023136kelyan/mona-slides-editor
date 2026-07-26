import { expect, test } from 'vitest'
import { render } from 'vitest-browser-react'

import { AgentStateOrb } from '@/features/editor/agent/AgentStateOrb'

/** Waits for the orb to paint at least one frame onto its canvas. */
const paintedCanvas = async (): Promise<HTMLCanvasElement> => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise(resolve => requestAnimationFrame(() => resolve(null)))
    const canvas = document.body.querySelector('canvas')
    if (canvas && canvas.width > 0 && drawnPixels(canvas).length > 0) return canvas
  }
  throw new Error('The orb never painted anything')
}

/** Every pixel the orb actually drew, ignoring the transparent background. */
const drawnPixels = (canvas: HTMLCanvasElement): number[][] => {
  const context = canvas.getContext('2d')
  if (!context) return []
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
  const pixels: number[][] = []
  for (let index = 0; index < data.length; index += 4) {
    // Faint anti-aliasing carries little colour information, so only clearly
    // painted pixels are judged.
    if ((data[index + 3] ?? 0) > 140) {
      pixels.push([data[index] ?? 0, data[index + 1] ?? 0, data[index + 2] ?? 0])
    }
  }
  return pixels
}

test('the orb draws dark ink, so it stays visible on the light editor', async () => {
  // The theme is pinned to light because the app has no dark mode: `auto` would
  // fall back to prefers-color-scheme and paint pale ink on light chrome for
  // anyone whose system is dark, leaving the loader all but invisible.
  render(<AgentStateOrb activity="reasoning" />)
  const canvas = await paintedCanvas()
  const pixels = drawnPixels(canvas)

  const luminance = pixels
    .map(([r = 0, g = 0, b = 0]) => 0.2126 * r + 0.7152 * g + 0.0722 * b)
    .reduce((total, value) => total + value, 0) / pixels.length

  expect(luminance).toBeLessThan(128)
})

test('the theme is pinned, so a stray dark ancestor cannot wash the orb out', async () => {
  // This is the regression guard for the pin itself. The package resolves
  // `auto` from a `dark` ancestor class, so under one of those `auto` would
  // switch to pale ink - invisible on our light chrome. Pinned, it stays dark.
  // Asserting only "dark ink" would pass either way in a light-scheme browser.
  render(
    <div className="dark">
      <AgentStateOrb activity="looking" />
    </div>,
  )
  const canvas = await paintedCanvas()
  const pixels = drawnPixels(canvas)

  const luminance = pixels
    .map(([r = 0, g = 0, b = 0]) => 0.2126 * r + 0.7152 * g + 0.0722 * b)
    .reduce((total, value) => total + value, 0) / pixels.length

  expect(luminance).toBeLessThan(128)
})

test('the orb is decorative, so it never competes with the text beside it', async () => {
  render(<AgentStateOrb activity="waiting" />)
  await paintedCanvas()

  // Its own role="img" label would otherwise be read out alongside the row's
  // text, and inside a button would fold into that button's accessible name.
  expect(document.body.querySelector('canvas')?.getAttribute('aria-hidden')).toBe('true')
})
