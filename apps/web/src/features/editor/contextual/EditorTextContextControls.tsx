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
import type { EditorRuntime } from '@/features/editor/editor-runtime'

const fontOptions = [
  { label: '思源黑体', value: 'SourceHanSans' },
  { label: '思源宋体', value: 'SourceHanSerif' },
  { label: '文鼎PL楷体', value: 'WenDingPLKaiTi' },
  { label: '文鼎PL宋体', value: 'WenDingPLSongTi' },
  { label: '朱雀仿宋', value: 'ZhuQueFangSong' },
  { label: '霞鹜文楷', value: 'LXGWWenKai' },
  { label: '霞鹜新致宋', value: 'LXGWNeoZhiSong' },
  { label: '霞鹜新晰黑', value: 'LXGWNeoXiHei' },
  { label: '阿里巴巴普惠体', value: 'AlibabaPuHuiTi' },
  { label: '得意黑', value: 'DeYiHei' },
  { label: 'MiSans', value: 'MiSans' },
  { label: 'Source Serif 4', value: 'SourceSerif4' },
  { label: 'JetBrains Mono', value: 'JetBrainsMono' },
  { label: 'Literata', value: 'Literata' },
  { label: 'Inter', value: 'Inter' },
  { label: 'Roboto', value: 'Roboto' },
  { label: 'Open Sans', value: 'OpenSans' },
  { label: 'Montserrat', value: 'Montserrat' },
  { label: 'Source Sans Pro', value: 'SourceSansPro' },
  { label: 'Merriweather', value: 'Merriweather' },
  { label: 'Lato', value: 'Lato' },
] as const

const fontSizeOptions = [
  '12px', '14px', '16px', '18px', '20px', '22px', '24px', '28px', '32px',
  '36px', '40px', '44px', '48px', '54px', '60px', '66px', '72px', '76px',
  '80px', '88px', '96px', '104px', '112px', '120px',
].map(value => ({ label: value, value }))

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
        className="mona-contextual-font-select"
        onChange={value => execute({ command: 'fontname', value })}
        options={[{ label: t('common.defaultFont'), value: '' }, ...fontOptions]}
        search
        searchLabel={t('foundation.editor.text.fontSearch')}
        value={attrs.fontname}
      />
      <InspectorSelect
        ariaLabel={t('foundation.editor.text.fontSize')}
        className="mona-contextual-fontsize-select"
        onChange={value => execute({ command: 'fontsize', value })}
        options={fontSizeOptions}
        search
        searchLabel={t('foundation.editor.text.fontSizeSearch')}
        value={attrs.fontsize}
      />
      <div className="mona-contextual-divider" />
      <InspectorPopoverButton
        ariaLabel={t('foundation.editor.text.textColor')}
        className="mona-contextual-control is-text-color"
        content={<EditorColorPicker onChange={value => execute({ command: 'color', value })} value={attrs.color} />}
      >
        <TextIcon />
        <span className={`mona-contextual-text-color${isOpaqueWhite ? ' is-white' : ''}`}>
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
          className={`mona-contextual-control${attrs[command] ? ' is-active' : ''}`}
          key={command}
          onPressedChange={() => execute({ command })}
          pressed={Boolean(attrs[command])}
        ><CommandIcon /></Toggle>
      ))}
      <div className="mona-contextual-divider" />
      {([
        ['left', AlignLeftIcon, 'alignLeft'],
        ['center', AlignCenterIcon, 'alignCenter'],
        ['right', AlignRightIcon, 'alignRight'],
        ['justify', AlignBothIcon, 'justify'],
      ] as const).map(([value, AlignmentIcon, label]) => (
        <Toggle
          aria-label={t(`foundation.editor.text.${label}`)}
          className={`mona-contextual-control${attrs.align === value ? ' is-active' : ''}`}
          key={value}
          onPressedChange={() => execute({ command: 'align', value })}
          pressed={attrs.align === value}
        ><AlignmentIcon /></Toggle>
      ))}
      <div className="mona-contextual-divider" />
      <Toggle
        aria-label={t('foundation.editor.text.bullets')}
        className={`mona-contextual-control${attrs.bulletList ? ' is-active' : ''}`}
        onPressedChange={() => execute({ command: 'bulletList' })}
        pressed={attrs.bulletList}
      ><ListIcon /></Toggle>
      <Toggle
        aria-label={t('foundation.editor.text.numbering')}
        className={`mona-contextual-control${attrs.orderedList ? ' is-active' : ''}`}
        onPressedChange={() => execute({ command: 'orderedList' })}
        pressed={attrs.orderedList}
      ><OrderedListIcon /></Toggle>
      <Button
        aria-label={t('foundation.editor.text.clear')}
        className="mona-contextual-control"
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
    <div className="mona-contextual-controls mona-contextual-text-controls">
      <div className="mona-contextual-control-row">
        <EditorRichTextContextControls elementId={element.id} runtime={runtime} />
      </div>
    </div>
  )
}
