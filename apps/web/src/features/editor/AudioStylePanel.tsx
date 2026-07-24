import { useTranslation } from 'react-i18next'

import type { PPTAudioElement } from '@mona/presentation-core/model'

import { InspectorColorButton, InspectorSwitch } from '@/features/editor/EditorInspectorPrimitives'
import type { EditorRuntime } from '@/features/editor/editor-runtime'

export function AudioStylePanel({ element, runtime }: { element: PPTAudioElement; runtime: EditorRuntime }) {
  const { t } = useTranslation()
  const update = (props: Partial<PPTAudioElement>) => runtime.commit('Update audio style', [{
    type: 'element.update',
    payload: { id: element.id, props },
  }])
  return (
    <div className="mona-audio-style-panel">
      <div className="flex w-full items-center mb-2.5">
        <div className="w-[48%] text-xs">{t('foundation.editor.media.iconColor')}</div>
        <div className="w-[52%] [&>*]:w-full">
          <InspectorColorButton ariaLabel={t('foundation.editor.media.iconColor')} color={element.color} onChange={color => update({ color })} />
        </div>
      </div>
      <div className="flex h-8 w-full items-center">
        <div className="w-[48%] text-xs">{t('foundation.editor.media.autoplay')}</div>
        <div className="w-[52%] text-right">
          <InspectorSwitch ariaLabel={t('foundation.editor.media.autoplay')} checked={element.autoplay} onChange={autoplay => update({ autoplay })} />
        </div>
      </div>
      <div className="flex h-8 w-full items-center">
        <div className="w-[48%] text-xs">{t('foundation.editor.media.loop')}</div>
        <div className="w-[52%] text-right">
          <InspectorSwitch ariaLabel={t('foundation.editor.media.loop')} checked={element.loop} onChange={loop => update({ loop })} />
        </div>
      </div>
    </div>
  )
}
