import { useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import AddTextIcon from '~icons/icon-park-outline/add-text'
import AlignBothIcon from '~icons/icon-park-outline/align-text-both'
import AlignCenterIcon from '~icons/icon-park-outline/align-text-center'
import AlignLeftIcon from '~icons/icon-park-outline/align-text-left'
import AlignRightIcon from '~icons/icon-park-outline/align-text-right'
import FontSizeIcon from '~icons/icon-park-outline/font-size'
import HighlightIcon from '~icons/icon-park-outline/high-light'
import TextIcon from '~icons/icon-park-outline/text'
import type {
  LineStyleType,
  PPTElement,
  PPTElementOutline,
  TableCell,
  TableCellStyle,
} from '@mona/presentation-core/model'
import type { PresentationState } from '@mona/presentation-core'
import type { RichTextAction } from '@mona/rich-text'

import {
  InspectorButton,
  InspectorButtonGroup,
  InspectorColorButton,
  InspectorNumberInput,
  InspectorSelect,
} from '@/features/editor/EditorInspectorPrimitives'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { lineStyleOptions } from '@/features/editor/editor-style-options'

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

type MultiFontCommand = 'align' | 'backcolor' | 'color' | 'fontname' | 'fontsize' | 'fontsize-add' | 'fontsize-reduce'

function LinePreview({ type }: { type: LineStyleType }) {
  const dashArray = type === 'dashed' ? '10 5' : type === 'dotted' ? '3.6 3.2' : '0 0'
  return (
    <svg aria-hidden="true" className="mona-line-style-preview" height="100%" viewBox="0 0 100 10" width="100%">
      <line stroke="#333" strokeDasharray={dashArray} strokeWidth="2" x1="0" x2="100" y1="5" y2="5" />
    </svg>
  )
}

const cloneTableData = (data: readonly (readonly TableCell[])[]): TableCell[][] => (
  JSON.parse(JSON.stringify(data)) as TableCell[][]
)

export function MultiStylePanel({
  activeElementIds,
  presentation,
  runtime,
}: {
  activeElementIds: string[]
  presentation: PresentationState
  runtime: EditorRuntime
}) {
  const { t } = useTranslation()
  const [fill, setFill] = useState('#fff')
  const [outline, setOutline] = useState<PPTElementOutline>({
    width: 0,
    color: '#fff',
    style: 'solid',
  })
  const richText = useSyncExternalStore(
    runtime.richText.subscribe,
    runtime.richText.getSnapshot,
    runtime.richText.getSnapshot,
  )
  const attrs = richText.attrs
  const slide = presentation.slides[presentation.slideIndex]!
  const selectedIds = new Set(activeElementIds)
  const activeElements = slide.elements.filter(element => selectedIds.has(element.id))
  const commitElement = (id: string, props: Partial<PPTElement>) => runtime.commit('Update multiple element styles', [{
    type: 'element.update',
    payload: { id, props },
  }], { historyKey: 'multi-style-panel' })

  const updateFill = (value: string) => {
    for (const element of activeElements) {
      if (element.type === 'text' || element.type === 'shape' || element.type === 'chart') {
        commitElement(element.id, { fill: value })
      }
      if (element.type === 'table') {
        const data = cloneTableData(element.data)
        for (const row of data) {
          for (const cell of row) cell.style = { ...(cell.style || {}), backcolor: value }
        }
        commitElement(element.id, { data })
      }
      if (element.type === 'audio') commitElement(element.id, { color: value })
    }
    setFill(value)
  }

  const updateOutline = (props: Partial<PPTElementOutline>) => {
    for (const element of activeElements) {
      if (
        element.type === 'text' ||
        element.type === 'image' ||
        element.type === 'shape' ||
        element.type === 'table' ||
        element.type === 'chart'
      ) {
        commitElement(element.id, {
          outline: { ...(element.outline || { width: 2, color: '#000', style: 'solid' }), ...props },
        })
      }
      if (element.type === 'line') commitElement(element.id, props)
    }
    setOutline(current => ({ ...current, ...props }))
  }

  const updateFontStyle = (command: MultiFontCommand, value: string) => {
    for (const element of activeElements) {
      if (element.type === 'text' || (element.type === 'shape' && element.text?.content)) {
        runtime.richText.execute(element.id, { command, value } as RichTextAction, `multi-style-rich-text-${element.id}`)
      }
      if (element.type === 'table') {
        const data = cloneTableData(element.data)
        for (const row of data) {
          for (const cell of row) {
            const style = { ...(cell.style || {}) } as TableCellStyle & Record<string, string>
            Object.assign(style, { [command]: value })
            cell.style = style
          }
        }
        commitElement(element.id, { data })
      }
      if (element.type === 'latex' && command === 'color') commitElement(element.id, { color: value })
    }
  }

  return (
    <div className="mona-multi-style-panel">
      <div className="flex w-full items-center mb-2.5">
        <div className="w-[48%] text-xs">{t('foundation.editor.multi.fillColor')}</div>
        <div className="w-[52%] [&>*]:w-full"><InspectorColorButton ariaLabel={t('foundation.editor.multi.fillColor')} color={fill} onChange={updateFill} /></div>
      </div>

      <div className="mona-panel-divider" />

      <div className="flex w-full items-center mb-2.5">
        <div className="w-[48%] text-xs">{t('foundation.editor.multi.borderStyle')}</div>
        <div className="w-[52%] [&>*]:w-full">
          <InspectorSelect<LineStyleType>
            ariaLabel={t('foundation.editor.multi.borderStyle')}
            onChange={style => updateOutline({ style })}
            options={lineStyleOptions}
            renderLabel={option => <LinePreview type={option?.value || 'solid'} />}
            renderOption={option => <LinePreview type={option.value} />}
            value={outline.style || 'solid'}
          />
        </div>
      </div>
      <div className="flex w-full items-center mb-2.5">
        <div className="w-[48%] text-xs">{t('foundation.editor.multi.borderColor')}</div>
        <div className="w-[52%] [&>*]:w-full"><InspectorColorButton ariaLabel={t('foundation.editor.multi.borderColor')} color={outline.color || '#000'} onChange={color => updateOutline({ color })} /></div>
      </div>
      <div className="flex w-full items-center mb-2.5">
        <div className="w-[48%] text-xs">{t('foundation.editor.multi.borderWidth')}</div>
        <div className="w-[52%] [&>*]:w-full"><InspectorNumberInput ariaLabel={t('foundation.editor.multi.borderWidth')} min={0} onChange={width => updateOutline({ width })} value={outline.width || 0} /></div>
      </div>

      <div className="mona-panel-divider" />

      <div className="mona-panel-select-group mona-multi-panel-row">
        <InspectorSelect
          ariaLabel={t('foundation.editor.text.fontFamily')}
          icon={<FontSizeIcon />}
          onChange={value => updateFontStyle('fontname', value)}
          options={[{ label: t('common.defaultFont'), value: '' }, ...fontOptions]}
          search
          searchLabel={t('foundation.editor.text.fontSearch')}
          style={{ width: '60%' }}
          value={attrs.fontname}
        />
        <InspectorSelect
          ariaLabel={t('foundation.editor.text.fontSize')}
          icon={<AddTextIcon />}
          onChange={value => updateFontStyle('fontsize', value)}
          options={fontSizeOptions}
          search
          searchLabel={t('foundation.editor.text.fontSizeSearch')}
          style={{ width: '40%' }}
          value={attrs.fontsize}
        />
      </div>
      <InspectorButtonGroup className="mona-multi-panel-row is-passive">
        <InspectorColorButton ariaLabel={t('foundation.editor.text.textColor')} color={attrs.color} icon={<TextIcon />} onChange={value => updateFontStyle('color', value)} style={{ width: '30%' }} />
        <InspectorColorButton ariaLabel={t('foundation.editor.text.highlight')} color={attrs.backcolor} icon={<HighlightIcon />} onChange={value => updateFontStyle('backcolor', value)} style={{ width: '30%' }} />
        <InspectorButton ariaLabel={t('foundation.editor.text.increaseFont')} className="mona-font-size-button" onClick={() => updateFontStyle('fontsize-add', '2')} style={{ width: '20%' }}><FontSizeIcon />+</InspectorButton>
        <InspectorButton ariaLabel={t('foundation.editor.text.decreaseFont')} className="mona-font-size-button" onClick={() => updateFontStyle('fontsize-reduce', '2')} style={{ width: '20%' }}><FontSizeIcon />-</InspectorButton>
      </InspectorButtonGroup>
      <InspectorButtonGroup className="mona-multi-panel-row">
        <InspectorButton active={attrs.align === 'left'} ariaLabel={t('foundation.editor.multi.alignLeft')} onClick={() => updateFontStyle('align', 'left')} style={{ flex: 1 }}><AlignLeftIcon /></InspectorButton>
        <InspectorButton active={attrs.align === 'center'} ariaLabel={t('foundation.editor.multi.alignCenter')} onClick={() => updateFontStyle('align', 'center')} style={{ flex: 1 }}><AlignCenterIcon /></InspectorButton>
        <InspectorButton active={attrs.align === 'right'} ariaLabel={t('foundation.editor.multi.alignRight')} onClick={() => updateFontStyle('align', 'right')} style={{ flex: 1 }}><AlignRightIcon /></InspectorButton>
        <InspectorButton active={attrs.align === 'justify'} ariaLabel={t('foundation.editor.multi.justify')} onClick={() => updateFontStyle('align', 'justify')} style={{ flex: 1 }}><AlignBothIcon /></InspectorButton>
      </InspectorButtonGroup>
    </div>
  )
}
