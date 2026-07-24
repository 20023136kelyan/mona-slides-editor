import { useRef, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ImageUp, Music2, Play, Repeat2, Video } from 'lucide-react'

import type { PPTAudioElement, PPTVideoElement } from '@mona/presentation-core/model'

import { Button } from '@/components/ui/button'
import { Toggle } from '@/components/ui/toggle'
import {
  contextualControlLabeled,
  contextualToggleFlat,
} from '@/features/editor/contextual/contextual-control-styles'
import { EditorColorPicker } from '@/features/editor/EditorColorPicker'
import { InspectorPopoverButton } from '@/features/editor/EditorInspectorPrimitives'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { fileToDataUrl } from '@/features/editor/editor-image'

type MediaElement = PPTAudioElement | PPTVideoElement

export function EditorMediaContextControls({ element, runtime }: {
  element: MediaElement
  runtime: EditorRuntime
}) {
  const { t } = useTranslation()
  const fileRef = useRef<HTMLInputElement>(null)
  const update = (props: Partial<MediaElement>, label: string) => runtime.commit(label, [{
    type: 'element.update',
    payload: { id: element.id, props },
  }], { historyKey: `media-context-${element.id}` })
  const replace = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const ext = file.name.includes('.') ? file.name.split('.').pop()?.toLocaleLowerCase() : undefined
    update({ src: await fileToDataUrl(file), ext }, 'Replace media')
  }

  return (
    <div className="mona-contextual-controls mona-contextual-media-controls">
      <div className="mona-contextual-control-row">
        <span aria-hidden="true" className="mona-contextual-kind-icon">{element.type === 'audio' ? <Music2 /> : <Video />}</span>
        <input
          accept={element.type === 'audio' ? 'audio/*' : 'video/*'}
          aria-hidden="true"
          hidden
          onChange={event => void replace(event)}
          ref={fileRef}
          tabIndex={-1}
          type="file"
        />
        <Button className={contextualControlLabeled} onClick={() => fileRef.current?.click()} size="editor" type="button" variant="ghost">
          <ImageUp /><span>{t('foundation.editor.contextual.replace')}</span>
        </Button>
        {element.type === 'audio' ? (
          <InspectorPopoverButton
            ariaLabel={t('foundation.editor.media.iconColor')}
            className={contextualControlLabeled}
            content={<EditorColorPicker onChange={color => update({ color }, 'Update audio icon color')} value={element.color} />}
          >
            <span
              className="inline-block box-border size-4 flex-none rounded-[var(--radius-control)]"
              style={{ backgroundColor: element.color, border: '1px solid rgb(16 18 25 / 35%)' }}
            />
            <span>{t('foundation.editor.media.iconColor')}</span>
          </InspectorPopoverButton>
        ) : null}
        <Toggle
          aria-label={t('foundation.editor.media.autoplay')}
          className={`${contextualControlLabeled} ${contextualToggleFlat}`}
          onPressedChange={autoplay => update({ autoplay }, 'Update media autoplay')}
          pressed={element.autoplay}
        >
          <Play /><span>{t('foundation.editor.media.autoplay')}</span>
        </Toggle>
        {element.type === 'audio' ? (
          <Toggle
            aria-label={t('foundation.editor.media.loop')}
            className={`${contextualControlLabeled} ${contextualToggleFlat}`}
            onPressedChange={loop => update({ loop }, 'Update audio loop')}
            pressed={element.loop}
          >
            <Repeat2 /><span>{t('foundation.editor.media.loop')}</span>
          </Toggle>
        ) : null}
      </div>
    </div>
  )
}
