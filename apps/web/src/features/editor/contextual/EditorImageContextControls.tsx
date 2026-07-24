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
import {
  contextualControlIcon,
  contextualControlLabeled,
  contextualControlRow,
  contextualControlsShell,
  contextualDivider,
  contextualToggleFlat,
  contextualTransparencyPopover,
} from '@/features/editor/contextual/contextual-control-styles'
import { cn } from '@/lib/utils'
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
    <div className={cn('mona-contextual-image-controls', contextualControlsShell)}>
      <div className={contextualControlRow}>
        <Button className={contextualControlLabeled} onClick={() => runtime.store.dispatch(editorActions.cropElementChanged(element.id))} size="editor" type="button" variant="ghost"><TailoringIcon /><span>{t('foundation.editor.image.crop')}</span></Button>
        <input accept="image/*" aria-hidden="true" hidden onChange={replaceImage} ref={inputRef} tabIndex={-1} type="file" />
        <Button className={contextualControlLabeled} onClick={() => inputRef.current?.click()} size="editor" type="button" variant="ghost"><TransformIcon /><span>{t('foundation.editor.image.replace')}</span></Button>
        <div className={contextualDivider} />
        <Toggle aria-label={t('foundation.editor.shape.horizontalFlip')} className={`${contextualControlIcon} ${contextualToggleFlat}`} onPressedChange={() => update({ flipH: !element.flipH }, `image-flip-${element.id}`)} pressed={Boolean(element.flipH)}><FlipHorizontalIcon /></Toggle>
        <Toggle aria-label={t('foundation.editor.shape.verticalFlip')} className={`${contextualControlIcon} ${contextualToggleFlat}`} onPressedChange={() => update({ flipV: !element.flipV }, `image-flip-${element.id}`)} pressed={Boolean(element.flipV)}><FlipVerticalIcon /></Toggle>
        <InspectorPopoverButton
          ariaLabel={t('foundation.editor.contextual.transparencyLabel')}
          className={contextualControlLabeled}
          content={(
            <div className={contextualTransparencyPopover}>
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
