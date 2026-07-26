import { useTranslation } from 'react-i18next'
import { ImageUp, Music2, Play, Repeat2, Video } from 'lucide-react'

import type { PPTAudioElement, PPTVideoElement } from '@mona/presentation-core/model'

import { Button } from '@/components/ui/button'
import { Toggle } from '@/components/ui/toggle'
import {
  contextualControlLabeled,
  contextualControlRow,
  contextualControlsShell,
  contextualKindIcon,
  contextualToggleFlat,
} from '@/features/editor/contextual/contextual-control-styles'
import { cn } from '@/lib/utils'
import { EditorColorPicker } from '@/features/editor/EditorColorPicker'
import { InspectorPopoverButton } from '@/features/editor/EditorInspectorPrimitives'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { fileToDataUrl } from '@/features/editor/editor-image'
import { pickFile } from '@/features/editor/editor-files'

type MediaElement = PPTAudioElement | PPTVideoElement

export function EditorMediaContextControls({ element, runtime }: {
  element: MediaElement
  runtime: EditorRuntime
}) {
  const { t } = useTranslation()
  const update = (props: Partial<MediaElement>, label: string) => runtime.commit(label, [{
    type: 'element.update',
    payload: { id: element.id, props },
  }], { historyKey: `media-context-${element.id}` })
  const replace = async () => {
    const file = await pickFile(element.type === 'audio'
      ? [{ extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg'], name: 'Audio' }]
      : [{ extensions: ['mp4', 'webm', 'mov', 'm4v'], name: 'Video' }])
    if (!file) return
    const ext = file.name.includes('.') ? file.name.split('.').pop()?.toLocaleLowerCase() : undefined
    update({ src: await fileToDataUrl(file), ext }, 'Replace media')
  }

  return (
    <div className={cn('mona-contextual-media-controls', contextualControlsShell)}>
      <div className={contextualControlRow}>
        <span aria-hidden="true" className={contextualKindIcon}>{element.type === 'audio' ? <Music2 /> : <Video />}</span>
        <Button className={contextualControlLabeled} onClick={() => { void replace() }} size="editor" type="button" variant="ghost">
          <ImageUp /><span>{t('foundation.editor.contextual.replace')}</span>
        </Button>
        {element.type === 'audio' ? (
          <InspectorPopoverButton
            ariaLabel={t('foundation.editor.media.iconColor')}
            className={contextualControlLabeled}
            content={<EditorColorPicker onChange={color => update({ color }, 'Update audio icon color')} value={element.color} />}
          >
            <span
              className="inline-block box-border size-4 flex-none rounded-control"
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
