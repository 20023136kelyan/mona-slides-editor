import { useTranslation } from 'react-i18next'

import CheckIcon from '~icons/icon-park-outline/check'
import { SLIDE_ANIMATIONS } from '@mona/presentation-core/animation-config'
import type { TurningMode } from '@mona/presentation-core/model'
import { selectPresentation } from '@mona/editor-state'

import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { InspectorButton } from '@/features/editor/EditorInspectorPrimitives'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { useEditorApplication } from '@/features/editor/services/editor-application'
import { useEditorSelector } from '@/features/editor/use-editor-selector'

export function SlideAnimationPanel({ runtime }: { runtime: EditorRuntime }) {
  const { t } = useTranslation()
  const { notifications } = useEditorApplication()
  const presentation = useEditorSelector(runtime.store, selectPresentation)
  const slide = presentation.slides[presentation.slideIndex]!
  const currentTurningMode = slide.turningMode || 'slideY'
  const historyKey = 'slide-animation-panel'

  const updateTurningMode = (mode: TurningMode) => {
    if (mode === currentTurningMode) return
    runtime.commit('Update slide transition', [{ type: 'slide.update', props: { turningMode: mode } }], { historyKey })
  }

  const applyAll = () => {
    const slides = structuredClone(presentation.slides).map(candidate => {
      if (slide.turningMode) candidate.turningMode = slide.turningMode
      else delete candidate.turningMode
      return candidate
    })
    runtime.commit('Apply slide transition to all slides', [{ type: 'presentation.slides.replace', slides }], { historyKey })
    notifications.notify({ text: t('animationPanel.appliedAll'), type: 'success' })
  }

  return (
    <div className="mona-slide-transition-panel">
      <ToggleGroup className="mona-slide-transition-pool" onValueChange={value => {
        if (value) updateTurningMode(value as TurningMode)
      }} spacing={0} type="single" value={currentTurningMode}>
        {SLIDE_ANIMATIONS.map(item => (
          <ToggleGroupItem
            className="mona-slide-transition-item"
            key={item.value}
            value={item.value}
          >
            <span className={`mona-slide-transition-block is-${item.value}`}>P</span>
            <span className="mona-slide-transition-text">{t(`slideTransitions.${item.value}`)}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <InspectorButton ariaLabel={t('animationPanel.applyAll')} onClick={applyAll} style={{ width: '100%' }}>
        <CheckIcon /> {t('animationPanel.applyAll')}
      </InspectorButton>
    </div>
  )
}
