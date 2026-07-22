import { useEffect, useRef } from 'react'
import Sortable from 'sortablejs'

import { selectPresentation } from '@mona/editor-state'

import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { useEditorSelector } from '@/features/editor/use-editor-selector'
import { useMobileSlidesLoad } from '@/features/mobile/use-mobile-slides-load'
import { ScaledSlide } from '@/features/presentation-renderer/ScaledSlide'

export function MobileThumbnails({ className = '', runtime }: {
  className?: string
  runtime: EditorRuntime
}) {
  const presentation = useEditorSelector(runtime.store, selectPresentation)
  const slidesLoadLimit = useMobileSlidesLoad(presentation.slides.length)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return undefined
    const sortable = Sortable.create(root, {
      animation: 200,
      scroll: true,
      scrollSensitivity: 50,
      delayOnTouchOnly: true,
      delay: 800,
      onEnd: event => {
        if (event.oldIndex === undefined || event.newIndex === undefined || event.oldIndex === event.newIndex) return
        runtime.reorderSlide(event.oldIndex, event.newIndex)
      },
    })
    return () => sortable.destroy()
  }, [runtime])

  return (
    <div className={`mona-mobile-thumbnails${className ? ` ${className}` : ''}`} ref={rootRef}>
      {presentation.slides.map((slide, index) => (
        <button
          className={`mona-mobile-thumbnail-item${presentation.slideIndex === index ? ' is-active' : ''}`}
          data-slide-id={slide.id}
          key={slide.id}
          onClick={() => runtime.focusSlide(index)}
          type="button"
        >
          <span className="mona-mobile-thumbnail-label">{index + 1}</span>
          <ScaledSlide
            fixedWidth={120}
            slide={slide}
            theme={presentation.theme}
            thumbnail
            viewportRatio={presentation.viewportRatio}
            viewportSize={presentation.viewportSize}
            visible={index < slidesLoadLimit}
          />
        </button>
      ))}
    </div>
  )
}
