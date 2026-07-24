import { useTranslation } from 'react-i18next'

import AddTextIcon from '~icons/icon-park-outline/add-text'
import AlignBothIcon from '~icons/icon-park-outline/align-text-both'
import AlignBottomIcon from '~icons/icon-park-outline/align-text-bottom-one'
import AlignCenterIcon from '~icons/icon-park-outline/align-text-center'
import AlignLeftIcon from '~icons/icon-park-outline/align-text-left'
import AlignMiddleIcon from '~icons/icon-park-outline/align-text-middle-one'
import AlignRightIcon from '~icons/icon-park-outline/align-text-right'
import AlignTopIcon from '~icons/icon-park-outline/align-text-top-one'
import DownIcon from '~icons/icon-park-outline/down'
import FillIcon from '~icons/icon-park-outline/fill'
import FontSizeIcon from '~icons/icon-park-outline/font-size'
import StrikethroughIcon from '~icons/icon-park-outline/strikethrough'
import TextIcon from '~icons/icon-park-outline/text'
import TextBoldIcon from '~icons/icon-park-outline/text-bold'
import TextItalicIcon from '~icons/icon-park-outline/text-italic'
import TextUnderlineIcon from '~icons/icon-park-outline/text-underline'
import type { PresentationState } from '@mona/presentation-core'
import type { PPTTableElement, TableCellStyle, TableTheme, TextAlign, TextAlignVertical } from '@mona/presentation-core/model'

import { Button } from '@/components/ui/button'
import { tableCommandMenu } from '@/features/editor/contextual/contextual-control-styles'
import {
  InspectorButton,
  InspectorButtonGroup,
  InspectorCheckbox,
  InspectorColorButton,
  InspectorPopoverButton,
  InspectorSelect,
  InspectorSwitch,
  inspectorDividerClass,
  inspectorRowClass,
  inspectorSelectGroupClass,
} from '@/features/editor/EditorInspectorPrimitives'
import { ElementOutlineControls, PropertyRow } from '@/features/editor/ElementStyleCommons'
import { editorFontOptions, editorFontSizeOptions } from '@/features/editor/editor-text-options'
import { executeTableCommand, parseTableCellKey, updateTableCellStyles, type TableCommand, type TableCommandPosition } from '@/features/editor/editor-table'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { useEditorApplication } from '@/features/editor/services/editor-application'

const fontSizeOptions = editorFontSizeOptions.slice(0, 9)

export function TableStylePanel({
  element,
  presentation,
  runtime,
  selectedCells,
}: {
  element: PPTTableElement
  presentation: PresentationState
  runtime: EditorRuntime
  selectedCells: readonly string[]
}) {
  const { t } = useTranslation()
  const { notifications } = useEditorApplication()
  const [row, column] = selectedCells.length ? parseTableCellKey(selectedCells[0]!) : [0, 0]
  const style = element.data[row]?.[column]?.style ?? {}
  const attrs = {
    bold: !!style.bold,
    em: !!style.em,
    underline: !!style.underline,
    strikethrough: !!style.strikethrough,
    color: style.color || '#000',
    backcolor: style.backcolor || '',
    fontsize: style.fontsize || '12px',
    fontname: style.fontname || '',
    align: style.align || 'left',
    vAlign: style.vAlign || 'top',
  } satisfies Required<TableCellStyle>
  const commit = (props: Partial<PPTTableElement>, label = 'Update table style') => runtime.commit(label, [{ type: 'element.update', payload: { id: element.id, props } }], { historyKey: `table-style-${element.id}` })
  const updateText = (props: Partial<TableCellStyle>) => commit({ data: updateTableCellStyles(element, selectedCells, props) })
  const command = (name: TableCommand, position?: TableCommandPosition) => {
    const next = executeTableCommand(element, selectedCells, name, position)
    if (next === element) {
      if (name === 'delete-row' || name === 'delete-col') {
        notifications.notify({
          text: t(`foundation.editor.tableEditing.${name === 'delete-row' ? 'keepOneRow' : 'keepOneColumn'}`),
          type: 'warning',
        })
      }
      return
    }
    commit({ data: next.data, width: next.width, colWidths: next.colWidths }, 'Edit table structure')
  }
  const updateTheme = (props: Partial<TableTheme>) => {
    if (element.theme) commit({ theme: { ...element.theme, ...props } })
  }
  return (
    <div className="mona-table-style-panel">
      <div className={`${inspectorSelectGroupClass} ${inspectorRowClass}`}>
        <InspectorSelect ariaLabel={t('foundation.editor.text.fontFamily')} icon={<FontSizeIcon />} onChange={fontname => updateText({ fontname })} options={[{ label: t('common.defaultFont'), value: '' }, ...editorFontOptions]} search searchLabel={t('foundation.editor.text.fontSearch')} style={{ width: '50%' }} value={attrs.fontname} />
        <InspectorSelect ariaLabel={t('foundation.editor.text.fontSize')} icon={<AddTextIcon />} onChange={fontsize => updateText({ fontsize })} options={fontSizeOptions} search searchLabel={t('foundation.editor.text.fontSizeSearch')} style={{ width: '50%' }} value={attrs.fontsize} />
      </div>
      <InspectorButtonGroup className={`${inspectorRowClass} mona-table-color-row`}>
        <InspectorColorButton ariaLabel={t('foundation.editor.table.textColor')} color={attrs.color} icon={<TextIcon />} onChange={color => updateText({ color })} style={{ width: '50%' }} />
        <InspectorColorButton ariaLabel={t('foundation.editor.table.cellFill')} color={attrs.backcolor} icon={<FillIcon />} onChange={backcolor => updateText({ backcolor })} style={{ width: '50%' }} />
      </InspectorButtonGroup>
      <InspectorButtonGroup className="flex w-full items-center mb-2.5">
        <InspectorButton active={attrs.bold} ariaLabel={t('foundation.editor.text.bold')} onClick={() => updateText({ bold: !attrs.bold })} style={{ flex: 1 }}><TextBoldIcon /></InspectorButton>
        <InspectorButton active={attrs.em} ariaLabel={t('foundation.editor.text.italic')} onClick={() => updateText({ em: !attrs.em })} style={{ flex: 1 }}><TextItalicIcon /></InspectorButton>
        <InspectorButton active={attrs.underline} ariaLabel={t('foundation.editor.text.underline')} onClick={() => updateText({ underline: !attrs.underline })} style={{ flex: 1 }}><TextUnderlineIcon /></InspectorButton>
        <InspectorButton active={attrs.strikethrough} ariaLabel={t('foundation.editor.text.strikethrough')} onClick={() => updateText({ strikethrough: !attrs.strikethrough })} style={{ flex: 1 }}><StrikethroughIcon /></InspectorButton>
      </InspectorButtonGroup>
      <InspectorButtonGroup className="flex w-full items-center mb-2.5">
        {([
          ['left', AlignLeftIcon, 'alignLeft'],
          ['center', AlignCenterIcon, 'alignCenter'],
          ['right', AlignRightIcon, 'alignRight'],
          ['justify', AlignBothIcon, 'justify'],
        ] as const).map(([value, Icon, label]) => <InspectorButton active={attrs.align === value} ariaLabel={t(`foundation.editor.table.${label}`)} key={value} onClick={() => updateText({ align: value as TextAlign })} style={{ flex: 1 }}><Icon /></InspectorButton>)}
      </InspectorButtonGroup>
      <InspectorButtonGroup className="flex w-full items-center mb-2.5">
        {([
          ['top', AlignTopIcon, 'alignTop'],
          ['middle', AlignMiddleIcon, 'alignMiddle'],
          ['bottom', AlignBottomIcon, 'alignBottom'],
        ] as const).map(([value, Icon, label]) => <InspectorButton active={attrs.vAlign === value} ariaLabel={t(`foundation.editor.table.${label}`)} key={value} onClick={() => updateText({ vAlign: value as TextAlignVertical })} style={{ flex: 1 }}><Icon /></InspectorButton>)}
      </InspectorButtonGroup>
      <div className={inspectorDividerClass} />
      <ElementOutlineControls element={element} fixed presentation={presentation} runtime={runtime} />
      <div className={inspectorDividerClass} />
      <PropertyRow label={t('foundation.editor.tableStyle.rowActions')}>
        <InspectorButtonGroup>
          <InspectorButton ariaLabel={t('foundation.editor.tableStyle.addRow')} onClick={() => command('insert-row', 'after')} style={{ flex: 1 }}>{t('foundation.editor.tableStyle.addRow')}</InspectorButton>
          <InspectorPopoverButton ariaLabel={t('foundation.editor.tableStyle.rowActions')} className="mona-table-action-menu-trigger" content={<div className={tableCommandMenu}>
            <Button onClick={() => command('insert-row', 'before')} size="editor" type="button" variant="ghost">{t('foundation.editor.tableStyle.addAbove')}</Button>
            <Button onClick={() => command('insert-row', 'after')} size="editor" type="button" variant="ghost">{t('foundation.editor.tableStyle.addBelow')}</Button>
            <Button onClick={() => command('delete-row')} size="editor" type="button" variant="ghost">{t('foundation.editor.table.deleteRow')}</Button>
          </div>}><DownIcon /></InspectorPopoverButton>
        </InspectorButtonGroup>
      </PropertyRow>
      <PropertyRow label={t('foundation.editor.tableStyle.columnActions')}>
        <InspectorButtonGroup>
          <InspectorButton ariaLabel={t('foundation.editor.tableStyle.addColumn')} onClick={() => command('insert-col', 'after')} style={{ flex: 1 }}>{t('foundation.editor.tableStyle.addColumn')}</InspectorButton>
          <InspectorPopoverButton ariaLabel={t('foundation.editor.tableStyle.columnActions')} className="mona-table-action-menu-trigger" content={<div className={tableCommandMenu}>
            <Button onClick={() => command('insert-col', 'before')} size="editor" type="button" variant="ghost">{t('foundation.editor.tableStyle.addLeft')}</Button>
            <Button onClick={() => command('insert-col', 'after')} size="editor" type="button" variant="ghost">{t('foundation.editor.tableStyle.addRight')}</Button>
            <Button onClick={() => command('delete-col')} size="editor" type="button" variant="ghost">{t('foundation.editor.table.deleteColumn')}</Button>
          </div>}><DownIcon /></InspectorPopoverButton>
        </InspectorButtonGroup>
      </PropertyRow>
      <div className={inspectorDividerClass} />
      <PropertyRow label={t('foundation.editor.tableStyle.enableTheme')}>
        <div className="w-full text-right"><InspectorSwitch ariaLabel={t('foundation.editor.tableStyle.enableTheme')} checked={!!element.theme} onChange={checked => checked
          ? commit({ theme: { color: presentation.theme.themeColors[0]!, rowHeader: true, rowFooter: false, colHeader: false, colFooter: false } })
          : runtime.commit('Disable table theme', [{ type: 'element.properties.remove', payload: { id: element.id, property: 'theme' } }], { historyKey: `table-style-${element.id}` })} /></div>
      </PropertyRow>
      {element.theme ? <>
        <div className="mona-table-theme-options">
          <InspectorCheckbox className="mona-panel-checkbox" checked={element.theme.rowHeader} onChange={rowHeader => updateTheme({ rowHeader })}>{t('foundation.editor.tableStyle.headerRow')}</InspectorCheckbox>
          <InspectorCheckbox className="mona-panel-checkbox" checked={element.theme.rowFooter} onChange={rowFooter => updateTheme({ rowFooter })}>{t('foundation.editor.tableStyle.totalRow')}</InspectorCheckbox>
        </div>
        <div className="mona-table-theme-options">
          <InspectorCheckbox className="mona-panel-checkbox" checked={element.theme.colHeader} onChange={colHeader => updateTheme({ colHeader })}>{t('foundation.editor.tableStyle.firstColumn')}</InspectorCheckbox>
          <InspectorCheckbox className="mona-panel-checkbox" checked={element.theme.colFooter} onChange={colFooter => updateTheme({ colFooter })}>{t('foundation.editor.tableStyle.lastColumn')}</InspectorCheckbox>
        </div>
        <PropertyRow label={t('foundation.editor.tableStyle.themeColor')}><InspectorColorButton ariaLabel={t('foundation.editor.tableStyle.themeColor')} color={element.theme.color} onChange={color => updateTheme({ color })} /></PropertyRow>
      </> : null}
    </div>
  )
}
