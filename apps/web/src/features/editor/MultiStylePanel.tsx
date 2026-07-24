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

import { InspectorButton, InspectorButtonGroup, InspectorColorButton, InspectorNumberInput, InspectorSelect, inspectorDividerClass, inspectorSelectGroupClass } from '@/features/editor/EditorInspectorPrimitives'
import { LinePreview, PropertyRow } from '@/features/editor/ElementStyleCommons'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { lineStyleOptions } from '@/features/editor/editor-style-options'
import { editorFontOptions, editorFontSizeOptions } from '@/features/editor/editor-text-options'

type MultiFontCommand = 'align' | 'backcolor' | 'color' | 'fontname' | 'fontsize' | 'fontsize-add' | 'fontsize-reduce'

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
      <PropertyRow label={t('foundation.editor.multi.fillColor')}>
        <InspectorColorButton ariaLabel={t('foundation.editor.multi.fillColor')} color={fill} onChange={updateFill} />
      </PropertyRow>

      <div className={inspectorDividerClass} />

      <PropertyRow label={t('foundation.editor.multi.borderStyle')}>
        <InspectorSelect<LineStyleType>
          ariaLabel={t('foundation.editor.multi.borderStyle')}
          onChange={style => updateOutline({ style })}
          options={lineStyleOptions}
          renderLabel={option => <LinePreview type={option?.value || 'solid'} />}
          renderOption={option => <LinePreview type={option.value} />}
          value={outline.style || 'solid'}
        />
      </PropertyRow>
      <PropertyRow label={t('foundation.editor.multi.borderColor')}>
        <InspectorColorButton ariaLabel={t('foundation.editor.multi.borderColor')} color={outline.color || '#000'} onChange={color => updateOutline({ color })} />
      </PropertyRow>
      <PropertyRow label={t('foundation.editor.multi.borderWidth')}>
        <InspectorNumberInput ariaLabel={t('foundation.editor.multi.borderWidth')} min={0} onChange={width => updateOutline({ width })} value={outline.width || 0} />
      </PropertyRow>

      <div className={inspectorDividerClass} />

      <div className={`${inspectorSelectGroupClass} mona-multi-panel-row`}>
        <InspectorSelect
          ariaLabel={t('foundation.editor.text.fontFamily')}
          icon={<FontSizeIcon />}
          onChange={value => updateFontStyle('fontname', value)}
          options={[{ label: t('common.defaultFont'), value: '' }, ...editorFontOptions]}
          search
          searchLabel={t('foundation.editor.text.fontSearch')}
          style={{ width: '60%' }}
          value={attrs.fontname}
        />
        <InspectorSelect
          ariaLabel={t('foundation.editor.text.fontSize')}
          icon={<AddTextIcon />}
          onChange={value => updateFontStyle('fontsize', value)}
          options={editorFontSizeOptions}
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
