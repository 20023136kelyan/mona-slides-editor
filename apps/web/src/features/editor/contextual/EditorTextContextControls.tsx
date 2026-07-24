import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import AlignBothIcon from '~icons/icon-park-outline/align-text-both'
import AlignCenterIcon from '~icons/icon-park-outline/align-text-center'
import AlignLeftIcon from '~icons/icon-park-outline/align-text-left'
import AlignRightIcon from '~icons/icon-park-outline/align-text-right'
import FormatIcon from '~icons/icon-park-outline/format'
import ListIcon from '~icons/icon-park-outline/list'
import OrderedListIcon from '~icons/icon-park-outline/ordered-list'
import StrikethroughIcon from '~icons/icon-park-outline/strikethrough'
import TextIcon from '~icons/icon-park-outline/text'
import TextBoldIcon from '~icons/icon-park-outline/text-bold'
import TextItalicIcon from '~icons/icon-park-outline/text-italic'
import TextUnderlineIcon from '~icons/icon-park-outline/text-underline'
import tinycolor from 'tinycolor2'
import type { PPTTextElement } from '@mona/presentation-core/model'
import type { RichTextAction } from '@mona/rich-text'

import { Button } from '@/components/ui/button'
import { Toggle } from '@/components/ui/toggle'
import { EditorColorPicker } from '@/features/editor/EditorColorPicker'
import {
  InspectorPopoverButton,
  InspectorSelect,
} from '@/features/editor/EditorInspectorPrimitives'
import {
  contextualControlIcon,
  contextualControlRow,
  contextualControlsShell,
  contextualControlTextColor,
  contextualDivider,
  contextualGhostSelect,
  contextualTextColorBar,
  contextualTextColorBarWhite,
  contextualToggleActive,
} from '@/features/editor/contextual/contextual-control-styles'
import { cn } from '@/lib/utils'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { editorFontOptions, editorFontSizeOptions } from '@/features/editor/editor-text-options'

export function EditorRichTextContextControls({
  elementId,
  runtime,
}: {
  elementId: string
  runtime: EditorRuntime
}) {
  const { t } = useTranslation()
  const richText = useSyncExternalStore(
    runtime.richText.subscribe,
    runtime.richText.getSnapshot,
    runtime.richText.getSnapshot,
  )
  const attrs = richText.attrs
  const textColor = tinycolor(attrs.color).toRgb()
  const isOpaqueWhite = textColor.r === 255
    && textColor.g === 255
    && textColor.b === 255
    && textColor.a === 1
  const execute = (action: RichTextAction) => runtime.richText.execute(elementId, action)

  return (
    <>
      <InspectorSelect
        ariaLabel={t('foundation.editor.text.fontFamily')}
        className={`${contextualGhostSelect} w-[110px] mr-px`}
        onChange={value => execute({ command: 'fontname', value })}
        options={[{ label: t('common.defaultFont'), value: '' }, ...editorFontOptions]}
        search
        searchLabel={t('foundation.editor.text.fontSearch')}
        value={attrs.fontname}
      />
      <InspectorSelect
        ariaLabel={t('foundation.editor.text.fontSize')}
        className={`${contextualGhostSelect} w-[80px]`}
        onChange={value => execute({ command: 'fontsize', value })}
        options={editorFontSizeOptions}
        search
        searchLabel={t('foundation.editor.text.fontSizeSearch')}
        value={attrs.fontsize}
      />
      <div className={contextualDivider} />
      <InspectorPopoverButton
        ariaLabel={t('foundation.editor.text.textColor')}
        className={contextualControlTextColor}
        content={<EditorColorPicker onChange={value => execute({ command: 'color', value })} value={attrs.color} />}
      >
        <TextIcon />
        <span className={cn(contextualTextColorBar, isOpaqueWhite && contextualTextColorBarWhite)}>
          <span style={{ backgroundColor: attrs.color }} />
        </span>
      </InspectorPopoverButton>
      {([
        ['bold', TextBoldIcon, 'bold'],
        ['em', TextItalicIcon, 'italic'],
        ['underline', TextUnderlineIcon, 'underline'],
        ['strikethrough', StrikethroughIcon, 'strikethrough'],
      ] as const).map(([command, CommandIcon, label]) => (
        <Toggle
          aria-label={t(`foundation.editor.text.${label}`)}
          className={`${contextualControlIcon} ${contextualToggleActive}`}
          key={command}
          onPressedChange={() => execute({ command })}
          pressed={Boolean(attrs[command])}
        ><CommandIcon /></Toggle>
      ))}
      <div className={contextualDivider} />
      {([
        ['left', AlignLeftIcon, 'alignLeft'],
        ['center', AlignCenterIcon, 'alignCenter'],
        ['right', AlignRightIcon, 'alignRight'],
        ['justify', AlignBothIcon, 'justify'],
      ] as const).map(([value, AlignmentIcon, label]) => (
        <Toggle
          aria-label={t(`foundation.editor.text.${label}`)}
          className={`${contextualControlIcon} ${contextualToggleActive}`}
          key={value}
          onPressedChange={() => execute({ command: 'align', value })}
          pressed={attrs.align === value}
        ><AlignmentIcon /></Toggle>
      ))}
      <div className={contextualDivider} />
      <Toggle
        aria-label={t('foundation.editor.text.bullets')}
        className={`${contextualControlIcon} ${contextualToggleActive}`}
        onPressedChange={() => execute({ command: 'bulletList' })}
        pressed={attrs.bulletList}
      ><ListIcon /></Toggle>
      <Toggle
        aria-label={t('foundation.editor.text.numbering')}
        className={`${contextualControlIcon} ${contextualToggleActive}`}
        onPressedChange={() => execute({ command: 'orderedList' })}
        pressed={attrs.orderedList}
      ><OrderedListIcon /></Toggle>
      <Button
        aria-label={t('foundation.editor.text.clear')}
        className={contextualControlIcon}
        onClick={() => execute({ command: 'clear' })}
        size="editor-icon"
        type="button"
        variant="ghost"
      ><FormatIcon /></Button>
    </>
  )
}

export function EditorTextContextControls({
  element,
  runtime,
}: {
  element: PPTTextElement
  runtime: EditorRuntime
}) {
  return (
    <div className={cn('mona-contextual-text-controls', contextualControlsShell)}>
      <div className={contextualControlRow}>
        <EditorRichTextContextControls elementId={element.id} runtime={runtime} />
      </div>
    </div>
  )
}
