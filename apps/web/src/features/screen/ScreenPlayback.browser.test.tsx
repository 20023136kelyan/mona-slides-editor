import { useMemo, useState } from 'react'
import { beforeAll, expect, test } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'

import type { PresentationState } from '@mona/presentation-core'

import { ScreenSlideList } from '@/features/screen/ScreenSlideList'
import { resolveTurningModes } from '@/features/screen/screen-presentation'
import type { ScreenPresentationController } from '@/features/screen/screen-types'
import { useScreenPlayback } from '@/features/screen/use-screen-playback'
import { initializeI18n } from '@/i18n'

beforeAll(async () => {
  await initializeI18n()
})

const fixture: PresentationState = {
  slideIndex: 0,
  slides: [
    { id: 'one', durationMs: 1000, elements: [], turningMode: 'fade' },
    { id: 'two', elements: [], turningMode: 'slideX' },
  ],
  templates: [],
  theme: {
    backgroundColor: '#fff',
    fontColor: '#000',
    fontName: 'Arial',
    outline: { color: '#000', style: 'solid', width: 1 },
    shadow: { blur: 0, color: '#000', h: 0, v: 0 },
    themeColors: [],
  },
  title: 'Timed playback',
  viewportRatio: 0.5625,
  viewportSize: 1000,
}

function PlaybackHarness() {
  const [presentation, setPresentation] = useState(fixture)
  const controller = useMemo<ScreenPresentationController>(() => ({
    presentation,
    setSlideIndex: index => setPresentation(current => ({
      ...current,
      slideIndex: Math.max(0, Math.min(index, current.slides.length - 1)),
    })),
  }), [presentation])
  const playback = useScreenPlayback({ controller })
  return (
    <>
      <output aria-label="Current page">{presentation.slides[presentation.slideIndex]?.id}</output>
      <ScreenSlideList
        animationIndex={playback.animationIndex}
        manualExitFullscreen={() => {}}
        presentation={presentation}
        slideHeight={562.5}
        slideWidth={1000}
        turnSlideToId={playback.turnSlideToId}
      />
    </>
  )
}

test('uses authored transition modes and advances after the current page duration', async () => {
  expect(resolveTurningModes(fixture.slides).map(slide => slide.turningMode)).toEqual(['fade', 'slideX'])
  await render(<PlaybackHarness />)

  await expect.element(page.getByLabelText('Current page')).toHaveTextContent('one')
  expect(document.querySelector('[data-slide-id="one"]')?.classList.contains('turning-mode-fade')).toBe(true)

  await new Promise(resolve => setTimeout(resolve, 1100))
  await expect.element(page.getByLabelText('Current page')).toHaveTextContent('two')
  expect(document.querySelector('[data-slide-id="two"]')?.classList.contains('turning-mode-slideX')).toBe(true)
})
