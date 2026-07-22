import { useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'

import AlignBothIcon from '~icons/icon-park-outline/align-text-both'
import AlignCenterIcon from '~icons/icon-park-outline/align-text-center'
import AlignLeftIcon from '~icons/icon-park-outline/align-text-left'
import AlignRightIcon from '~icons/icon-park-outline/align-text-right'
import FormatIcon from '~icons/icon-park-outline/format'
import TextIcon from '~icons/icon-park-outline/text'
import TextBoldIcon from '~icons/icon-park-outline/text-bold'
import TextItalicIcon from '~icons/icon-park-outline/text-italic'
import TextUnderlineIcon from '~icons/icon-park-outline/text-underline'
import tinycolor from 'tinycolor2'
import type { PPTTextElement } from '@mona/presentation-core/model'
import type { RichTextAction } from '@mona/rich-text'

import { EditorColorPicker } from '@/features/editor/EditorColorPicker'
import {
  InspectorPopoverButton,
  InspectorSelect,
} from '@/features/editor/EditorInspectorPrimitives'
import { getElementBounds } from '@/features/editor/editor-geometry'
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

export function EditorFloatingRichTextControls({ elementId, runtime }: { elementId: string; runtime: EditorRuntime }) {
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
        className="mona-floating-font-select"
        onChange={value => execute({ command: 'fontname', value })}
        options={[{ label: t('common.defaultFont'), value: '' }, ...fontOptions]}
        search
        searchLabel={t('foundation.editor.text.fontSearch')}
        value={attrs.fontname}
      />
      <InspectorSelect
        ariaLabel={t('foundation.editor.text.fontSize')}
        className="mona-floating-fontsize-select"
        onChange={value => execute({ command: 'fontsize', value })}
        options={fontSizeOptions}
        search
        searchLabel={t('foundation.editor.text.fontSizeSearch')}
        value={attrs.fontsize}
      />
      <div className="mona-floating-divider" />
      <div className="mona-floating-popover-wrapper">
        <InspectorPopoverButton
          ariaLabel={t('foundation.editor.text.textColor')}
          className="mona-floating-toolbar-button is-text-color"
          content={<EditorColorPicker onChange={value => execute({ command: 'color', value })} value={attrs.color} />}
        >
          <TextIcon />
          <span className={`mona-floating-text-color${isOpaqueWhite ? ' is-white' : ''}`}>
            <span style={{ backgroundColor: attrs.color }} />
          </span>
        </InspectorPopoverButton>
      </div>
      {([
        ['bold', TextBoldIcon],
        ['em', TextItalicIcon],
        ['underline', TextUnderlineIcon],
      ] as const).map(([command, CommandIcon]) => (
        <button
          aria-label={t(`foundation.editor.text.${command === 'em' ? 'italic' : command}`)}
          aria-pressed={Boolean(attrs[command])}
          className={`mona-floating-toolbar-button${attrs[command] ? ' is-active' : ''}`}
          key={command}
          onClick={() => execute({ command })}
          type="button"
        ><CommandIcon /></button>
      ))}
      <div className="mona-floating-divider" />
      {([
        ['left', AlignLeftIcon, 'alignLeft'],
        ['center', AlignCenterIcon, 'alignCenter'],
        ['right', AlignRightIcon, 'alignRight'],
        ['justify', AlignBothIcon, 'justify'],
      ] as const).map(([value, AlignmentIcon, label]) => (
        <button
          aria-label={t(`foundation.editor.text.${label}`)}
          aria-pressed={attrs.align === value}
          className={`mona-floating-toolbar-button${attrs.align === value ? ' is-active' : ''}`}
          key={value}
          onClick={() => execute({ command: 'align', value })}
          type="button"
        ><AlignmentIcon /></button>
      ))}
      <div className="mona-floating-divider" />
      <button aria-label={t('foundation.editor.text.clear')} className="mona-floating-toolbar-button" onClick={() => execute({ command: 'clear' })} type="button"><FormatIcon /></button>
    </>
  )
}

export function EditorFloatingTextToolbar({
  element,
  frameRef,
  runtime,
  scale,
  stageRef,
}: {
  element: PPTTextElement
  frameRef: RefObject<HTMLDivElement | null>
  runtime: EditorRuntime
  scale: number
  stageRef: RefObject<HTMLElement | null>
}) {
  const toolbarRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current
    const frame = frameRef.current
    const stage = stageRef.current
    if (!toolbar || !frame || !stage) return undefined
    const update = () => {
      const range = getElementBounds(element)
      const stageRect = stage.getBoundingClientRect()
      const frameRect = frame.getBoundingClientRect()
      const availableTop = stageRect.top - frameRect.top
      const availableBottom = stageRect.bottom - frameRect.top
      const availableLeft = stageRect.left - frameRect.left
      const availableRight = stageRect.right - frameRect.left
      const minLeft = availableLeft + 10
      const maxLeft = availableRight - toolbar.clientWidth - 10
      const requestedLeft = range.minX * scale
      const left = maxLeft < minLeft ? minLeft : Math.min(Math.max(requestedLeft, minLeft), maxLeft)
      const bottomTop = range.maxY * scale + 10
      const topPlacement = stageRect.height && bottomTop + 40 > availableBottom
      const requestedTop = topPlacement ? range.minY * scale - 80 : bottomTop
      const top = Math.max(availableTop + 10, requestedTop)
      setPosition(current => current?.left === left && current.top === top ? current : { left, top })
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(toolbar)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [element, frameRef, scale, stageRef])

  return (
    <div
      className="mona-floating-toolbar mona-floating-text-toolbar"
      onPointerDown={event => event.stopPropagation()}
      ref={toolbarRef}
      style={position || { visibility: 'hidden' }}
    >
      <div className="mona-floating-toolbar-content">
        <EditorFloatingRichTextControls elementId={element.id} runtime={runtime} />
      </div>
    </div>
  )
}
