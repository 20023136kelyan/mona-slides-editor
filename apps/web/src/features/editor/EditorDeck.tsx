import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { selectPresentation } from '@mona/editor-state'
import type { PresentationState } from '@mona/presentation-core'

import { EditorCanvas } from '@/features/editor/EditorCanvas'
import { createEditorRuntime } from '@/features/editor/editor-runtime'
import { useEditorSelector } from '@/features/editor/use-editor-selector'
import { ScaledSlide } from '@/features/presentation-renderer/ScaledSlide'

export function EditorDeck({ presentation: initialPresentation }: { presentation: PresentationState }) {
  const { t } = useTranslation()
  const [runtime] = useState(() => createEditorRuntime(initialPresentation))
  const presentation = useEditorSelector(runtime.store, selectPresentation)

  return (
    <main className="mona-readonly-deck mona-editor-deck" data-testid="editor-deck">
      <aside aria-label={t('foundation.editor.slides')} className="mona-thumbnail-rail">
        {presentation.slides.map((slide, index) => (
          <button
            aria-label={t('foundation.editor.showSlide', { number: index + 1 })}
            aria-pressed={index === presentation.slideIndex}
            className="mona-thumbnail-button"
            key={slide.id}
            onClick={() => runtime.focusSlide(index)}
            type="button"
          >
            <span className="mona-thumbnail-number">{String(index + 1).padStart(2, '0')}</span>
            <ScaledSlide
              fixedWidth={120}
              slide={slide}
              theme={presentation.theme}
              thumbnail
              viewportRatio={presentation.viewportRatio}
              viewportSize={presentation.viewportSize}
            />
          </button>
        ))}
      </aside>
      <EditorCanvas runtime={runtime} />
      <aside aria-label={t('foundation.editor.inspector')} className="mona-render-inspector" />
    </main>
  )
}
