import { useState } from 'react'

import type { PresentationState } from '@mona/presentation-core'

import { ScaledSlide } from '@/features/presentation-renderer/ScaledSlide'

export function ReadOnlyDeck({ presentation }: { presentation: PresentationState }) {
  const [slideIndex, setSlideIndex] = useState(presentation.slideIndex)
  const currentSlide = presentation.slides[slideIndex] || presentation.slides[0]
  if (!currentSlide) return <div className="mona-empty-deck">No slides</div>

  return (
    <main className="mona-readonly-deck" data-testid="readonly-deck">
      <aside aria-label="Slides" className="mona-thumbnail-rail">
        {presentation.slides.map((slide, index) => (
          <button
            aria-label={`Show slide ${index + 1}`}
            aria-pressed={index === slideIndex}
            className="mona-thumbnail-button"
            key={slide.id}
            onClick={() => setSlideIndex(index)}
            type="button"
          >
            <span className="mona-thumbnail-number">{String(index + 1).padStart(2, '0')}</span>
            <ScaledSlide
              fixedWidth={120}
              slide={slide}
              sourcePackages={presentation.sourcePackages}
              theme={presentation.theme}
              thumbnail
              viewportRatio={presentation.viewportRatio}
              viewportSize={presentation.viewportSize}
            />
          </button>
        ))}
      </aside>
      <section aria-label="Read-only slide canvas" className="mona-render-stage">
        <ScaledSlide
          key={currentSlide.id}
          slide={currentSlide}
          sourcePackages={presentation.sourcePackages}
          theme={presentation.theme}
          viewportRatio={presentation.viewportRatio}
          viewportSize={presentation.viewportSize}
        />
      </section>
      <aside aria-label="Inspector" className="mona-render-inspector" />
    </main>
  )
}
