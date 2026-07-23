import { useRef, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'

import FlipHorizontalIcon from '~icons/icon-park-outline/flip-horizontally'
import FlipVerticalIcon from '~icons/icon-park-outline/flip-vertically'
import TailoringIcon from '~icons/icon-park-outline/tailoring'
import TransformIcon from '~icons/icon-park-outline/transform'
import { Blend } from 'lucide-react'
import type { PPTImageElement } from '@mona/presentation-core/model'
import { editorActions } from '@mona/editor-state'

import { Button } from '@/components/ui/button'
import { Toggle } from '@/components/ui/toggle'
import { InspectorPopoverButton, InspectorSlider } from '@/features/editor/EditorInspectorPrimitives'
import { getReplacementImageCommands } from '@/features/editor/editor-image'
import type { EditorRuntime } from '@/features/editor/editor-runtime'

const getTransparency = (element: PPTImageElement) => {
  const opacity = Number.parseFloat(element.filters?.opacity || '100%')
  return Number.isFinite(opacity) ? Math.max(0, Math.min(100, 100 - opacity)) : 0
}

export function EditorImageContextControls({
  element,
  runtime,
}: {
  element: PPTImageElement
  runtime: EditorRuntime
}) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const transparency = getTransparency(element)
  const update = (props: Partial<PPTImageElement>, historyKey: string) => runtime.commit(
    'Update image',
    [{ type: 'element.update', payload: { id: element.id, props } }],
    { historyKey },
  )
  const replaceImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    runtime.commit('Replace image', await getReplacementImageCommands(element, file), { historyKey: `image-replace-${element.id}` })
  }

  return (
    <div className="mona-contextual-controls mona-contextual-image-controls">
      <div className="mona-contextual-control-row">
        <Button className="mona-contextual-control is-labeled" onClick={() => runtime.store.dispatch(editorActions.cropElementChanged(element.id))} size="editor" type="button" variant="ghost"><TailoringIcon /><span>{t('foundation.editor.image.crop')}</span></Button>
        <input accept="image/*" aria-label={t('foundation.editor.image.replaceImage')} className="mona-visually-hidden" onChange={replaceImage} ref={inputRef} type="file" />
        <Button className="mona-contextual-control is-labeled" onClick={() => inputRef.current?.click()} size="editor" type="button" variant="ghost"><TransformIcon /><span>{t('foundation.editor.image.replace')}</span></Button>
        <div className="mona-contextual-divider" />
        <Toggle aria-label={t('foundation.editor.shape.horizontalFlip')} className="mona-contextual-control" onPressedChange={() => update({ flipH: !element.flipH }, `image-flip-${element.id}`)} pressed={Boolean(element.flipH)}><FlipHorizontalIcon /></Toggle>
        <Toggle aria-label={t('foundation.editor.shape.verticalFlip')} className="mona-contextual-control" onPressedChange={() => update({ flipV: !element.flipV }, `image-flip-${element.id}`)} pressed={Boolean(element.flipV)}><FlipVerticalIcon /></Toggle>
        <InspectorPopoverButton
          ariaLabel={t('foundation.editor.contextual.transparencyLabel')}
          className="mona-contextual-control is-labeled"
          content={(
            <div className="mona-contextual-transparency-popover">
              <span>{transparency}%</span>
              <InspectorSlider
                ariaLabel={t('foundation.editor.contextual.transparencyLabel')}
                max={100}
                min={0}
                onChange={value => update({ filters: { ...element.filters, opacity: `${100 - value}%` } }, `image-transparency-${element.id}`)}
                value={transparency}
              />
            </div>
          )}
        ><Blend /><span>{t('foundation.editor.contextual.transparencyLabel')}</span></InspectorPopoverButton>
      </div>
    </div>
  )
}
