import { expect, test } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'

import type { PPTTextElement, StructuredTextBody } from '@mona/presentation-core'

import { ElementRenderer } from '@/features/presentation-renderer/ElementRenderer'

const theme = {
  backgroundColor: '#ffffff',
  fontColor: '#111111',
  fontName: 'Arial',
  outline: { color: '#111111', style: 'solid' as const, width: 1 },
  shadow: { blur: 0, color: '#000000', h: 0, v: 0 },
  themeColors: [],
}

const sentence = 'PowerPoint shrinks a normAutofit body until it fits the shape it was authored in. '
const overflowingContent = `<p data-ppt-paragraph-id="p0" data-ppt-level="0"><span data-ppt-run-id="p0.r0" style="font-size:24px">${sentence.repeat(6)}</span></p>`

const body = (type: 'none' | 'normal'): StructuredTextBody => ({
  bodyProperties: { autoFit: { type }, insets: [0, 0, 0, 0] },
  listStyle: [],
  paragraphs: [{
    level: 0,
    runs: [{ kind: 'text', properties: { fontSize: 24 }, sourceId: 'p0.r0', text: sentence.repeat(6) }],
    sourceId: 'p0',
  }],
  scale: 1,
  schemaVersion: 1,
})

const textElement = (type: 'none' | 'normal'): PPTTextElement => ({
  content: overflowingContent,
  defaultColor: '#111111',
  defaultFontName: 'Arial',
  fixedHeight: true,
  height: 90,
  id: `autofit-${type}`,
  inset: [0, 0, 0, 0],
  left: 0,
  lineHeight: 1,
  rotate: 0,
  structuredText: body(type),
  top: 0,
  type: 'text',
  width: 320,
})

const measure = (elementId: string) => {
  const frame = document.querySelector<HTMLElement>(`[data-element-id="${elementId}"] .mona-text-content`)!
  const content = frame.querySelector<HTMLElement>('.mona-text-autofit')
  const style = getComputedStyle(frame)
  const available = frame.clientHeight
    - Number.parseFloat(style.paddingTop)
    - Number.parseFloat(style.paddingBottom)
  const needed = (content ?? frame.querySelector<HTMLElement>('.mona-rich-text')!).getBoundingClientRect().height
  return { available, needed, zoom: Number(content?.style.zoom || '1') }
}

test('shrinks a normAutofit body by discrete steps until it fits its shape', async () => {
  void render(<ElementRenderer element={textElement('normal')} theme={theme} />)
  await expect.element(page.getByText(/PowerPoint shrinks/)).toBeVisible()

  await expect.poll(() => measure('autofit-normal').zoom).toBeLessThan(1)
  const { available, needed, zoom } = measure('autofit-normal')
  // The chosen factor is one of PowerPoint's own steps, not an arbitrary ratio.
  expect([0.925, 0.85, 0.775, 0.7, 0.65, 0.6, 0.55, 0.5, 0.45, 0.4, 0.35, 0.3, 0.25]).toContain(zoom)
  expect(needed).toBeLessThanOrEqual(available + 1)
})

test('leaves a body that does not autofit at its authored size', async () => {
  void render(<ElementRenderer element={textElement('none')} theme={theme} />)
  await expect.element(page.getByText(/PowerPoint shrinks/)).toBeVisible()

  expect(document.querySelector('.mona-text-autofit')).toBeNull()
  // noAutofit keeps the authored size and lets the text overflow, the way
  // PowerPoint renders it.
  const { available, needed } = measure('autofit-none')
  expect(needed).toBeGreaterThan(available)
})
