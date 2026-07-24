import { useTranslation } from 'react-i18next'

import type { PPTAudioElement } from '@mona/presentation-core/model'

import { InspectorColorButton, InspectorSwitch } from '@/features/editor/EditorInspectorPrimitives'
import { PropertyRow } from '@/features/editor/ElementStyleCommons'
import type { EditorRuntime } from '@/features/editor/editor-runtime'

export function AudioStylePanel({ element, runtime }: { element: PPTAudioElement; runtime: EditorRuntime }) {
  const { t } = useTranslation()
  const update = (props: Partial<PPTAudioElement>) => runtime.commit('Update audio style', [{
    type: 'element.update',
    payload: { id: element.id, props },
  }])
  return (
    <div className="mona-audio-style-panel">
      <PropertyRow label={t('foundation.editor.media.iconColor')}>
        <InspectorColorButton ariaLabel={t('foundation.editor.media.iconColor')} color={element.color} onChange={color => update({ color })} />
      </PropertyRow>
      <PropertyRow label={t('foundation.editor.media.autoplay')}>
        <div className="w-full text-right">
          <InspectorSwitch ariaLabel={t('foundation.editor.media.autoplay')} checked={element.autoplay} onChange={autoplay => update({ autoplay })} />
        </div>
      </PropertyRow>
      <PropertyRow label={t('foundation.editor.media.loop')}>
        <div className="w-full text-right">
          <InspectorSwitch ariaLabel={t('foundation.editor.media.loop')} checked={element.loop} onChange={loop => update({ loop })} />
        </div>
      </PropertyRow>
    </div>
  )
}
