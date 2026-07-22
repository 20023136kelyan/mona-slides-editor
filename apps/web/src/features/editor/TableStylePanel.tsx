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

import {
  InspectorButton,
  InspectorButtonGroup,
  InspectorColorButton,
  InspectorPopoverButton,
  InspectorSelect,
  InspectorSwitch,
} from '@/features/editor/EditorInspectorPrimitives'
import { ElementOutlineControls, PropertyRow } from '@/features/editor/ElementStyleCommons'
import { executeTableCommand, parseTableCellKey, updateTableCellStyles, type TableCommand, type TableCommandPosition } from '@/features/editor/editor-table'
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

const fontSizeOptions = ['12px', '14px', '16px', '18px', '20px', '22px', '24px', '28px', '32px'].map(value => ({ label: value, value }))

function InspectorCheckbox({ checked, children, onChange }: { checked: boolean; children: string; onChange: (value: boolean) => void }) {
  return (
    <label className="mona-panel-checkbox">
      <input checked={checked} onChange={event => onChange(event.target.checked)} type="checkbox" />
      <span className="mona-panel-checkbox-control" />
      <span>{children}</span>
    </label>
  )
}

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
        window.dispatchEvent(new CustomEvent('mona:notice', {
          detail: {
            text: t(`foundation.editor.tableEditing.${name === 'delete-row' ? 'keepOneRow' : 'keepOneColumn'}`),
            type: 'warning',
          },
        }))
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
      <div className="mona-panel-select-group mona-panel-row-full">
        <InspectorSelect ariaLabel={t('foundation.editor.text.fontFamily')} icon={<FontSizeIcon />} onChange={fontname => updateText({ fontname })} options={[{ label: t('common.defaultFont'), value: '' }, ...fontOptions]} search searchLabel={t('foundation.editor.text.fontSearch')} style={{ width: '50%' }} value={attrs.fontname} />
        <InspectorSelect ariaLabel={t('foundation.editor.text.fontSize')} icon={<AddTextIcon />} onChange={fontsize => updateText({ fontsize })} options={fontSizeOptions} search searchLabel={t('foundation.editor.text.fontSizeSearch')} style={{ width: '50%' }} value={attrs.fontsize} />
      </div>
      <InspectorButtonGroup className="mona-panel-row-full mona-table-color-row">
        <InspectorColorButton ariaLabel={t('foundation.editor.table.textColor')} color={attrs.color} icon={<TextIcon />} onChange={color => updateText({ color })} style={{ width: '50%' }} />
        <InspectorColorButton ariaLabel={t('foundation.editor.table.cellFill')} color={attrs.backcolor} icon={<FillIcon />} onChange={backcolor => updateText({ backcolor })} style={{ width: '50%' }} />
      </InspectorButtonGroup>
      <InspectorButtonGroup className="mona-panel-row-full">
        <InspectorButton active={attrs.bold} ariaLabel={t('foundation.editor.text.bold')} onClick={() => updateText({ bold: !attrs.bold })} style={{ flex: 1 }}><TextBoldIcon /></InspectorButton>
        <InspectorButton active={attrs.em} ariaLabel={t('foundation.editor.text.italic')} onClick={() => updateText({ em: !attrs.em })} style={{ flex: 1 }}><TextItalicIcon /></InspectorButton>
        <InspectorButton active={attrs.underline} ariaLabel={t('foundation.editor.text.underline')} onClick={() => updateText({ underline: !attrs.underline })} style={{ flex: 1 }}><TextUnderlineIcon /></InspectorButton>
        <InspectorButton active={attrs.strikethrough} ariaLabel={t('foundation.editor.text.strikethrough')} onClick={() => updateText({ strikethrough: !attrs.strikethrough })} style={{ flex: 1 }}><StrikethroughIcon /></InspectorButton>
      </InspectorButtonGroup>
      <InspectorButtonGroup className="mona-panel-row-full">
        {([
          ['left', AlignLeftIcon, 'alignLeft'],
          ['center', AlignCenterIcon, 'alignCenter'],
          ['right', AlignRightIcon, 'alignRight'],
          ['justify', AlignBothIcon, 'justify'],
        ] as const).map(([value, Icon, label]) => <InspectorButton active={attrs.align === value} ariaLabel={t(`foundation.editor.table.${label}`)} key={value} onClick={() => updateText({ align: value as TextAlign })} style={{ flex: 1 }}><Icon /></InspectorButton>)}
      </InspectorButtonGroup>
      <InspectorButtonGroup className="mona-panel-row-full">
        {([
          ['top', AlignTopIcon, 'alignTop'],
          ['middle', AlignMiddleIcon, 'alignMiddle'],
          ['bottom', AlignBottomIcon, 'alignBottom'],
        ] as const).map(([value, Icon, label]) => <InspectorButton active={attrs.vAlign === value} ariaLabel={t(`foundation.editor.table.${label}`)} key={value} onClick={() => updateText({ vAlign: value as TextAlignVertical })} style={{ flex: 1 }}><Icon /></InspectorButton>)}
      </InspectorButtonGroup>
      <div className="mona-inspector-divider" />
      <ElementOutlineControls element={element} fixed presentation={presentation} runtime={runtime} />
      <div className="mona-inspector-divider" />
      <PropertyRow label={t('foundation.editor.tableStyle.rowActions')}>
        <InspectorButtonGroup>
          <InspectorButton ariaLabel={t('foundation.editor.tableStyle.addRow')} onClick={() => command('insert-row', 'after')} style={{ flex: 1 }}>{t('foundation.editor.tableStyle.addRow')}</InspectorButton>
          <InspectorPopoverButton ariaLabel={t('foundation.editor.tableStyle.rowActions')} className="mona-table-action-menu-trigger" content={<div className="mona-table-command-menu">
            <button onClick={() => command('insert-row', 'before')} type="button">{t('foundation.editor.tableStyle.addAbove')}</button>
            <button onClick={() => command('insert-row', 'after')} type="button">{t('foundation.editor.tableStyle.addBelow')}</button>
            <button onClick={() => command('delete-row')} type="button">{t('foundation.editor.table.deleteRow')}</button>
          </div>}><DownIcon /></InspectorPopoverButton>
        </InspectorButtonGroup>
      </PropertyRow>
      <PropertyRow label={t('foundation.editor.tableStyle.columnActions')}>
        <InspectorButtonGroup>
          <InspectorButton ariaLabel={t('foundation.editor.tableStyle.addColumn')} onClick={() => command('insert-col', 'after')} style={{ flex: 1 }}>{t('foundation.editor.tableStyle.addColumn')}</InspectorButton>
          <InspectorPopoverButton ariaLabel={t('foundation.editor.tableStyle.columnActions')} className="mona-table-action-menu-trigger" content={<div className="mona-table-command-menu">
            <button onClick={() => command('insert-col', 'before')} type="button">{t('foundation.editor.tableStyle.addLeft')}</button>
            <button onClick={() => command('insert-col', 'after')} type="button">{t('foundation.editor.tableStyle.addRight')}</button>
            <button onClick={() => command('delete-col')} type="button">{t('foundation.editor.table.deleteColumn')}</button>
          </div>}><DownIcon /></InspectorPopoverButton>
        </InspectorButtonGroup>
      </PropertyRow>
      <div className="mona-inspector-divider" />
      <div className="mona-panel-row mona-table-theme-switch">
        <div className="mona-panel-row-label">{t('foundation.editor.tableStyle.enableTheme')}</div>
        <div className="mona-panel-row-control mona-panel-switch-wrapper"><InspectorSwitch ariaLabel={t('foundation.editor.tableStyle.enableTheme')} checked={!!element.theme} onChange={checked => checked
          ? commit({ theme: { color: presentation.theme.themeColors[0]!, rowHeader: true, rowFooter: false, colHeader: false, colFooter: false } })
          : runtime.commit('Disable table theme', [{ type: 'element.properties.remove', payload: { id: element.id, property: 'theme' } }], { historyKey: `table-style-${element.id}` })} /></div>
      </div>
      {element.theme ? <>
        <div className="mona-table-theme-options">
          <InspectorCheckbox checked={element.theme.rowHeader} onChange={rowHeader => updateTheme({ rowHeader })}>{t('foundation.editor.tableStyle.headerRow')}</InspectorCheckbox>
          <InspectorCheckbox checked={element.theme.rowFooter} onChange={rowFooter => updateTheme({ rowFooter })}>{t('foundation.editor.tableStyle.totalRow')}</InspectorCheckbox>
        </div>
        <div className="mona-table-theme-options">
          <InspectorCheckbox checked={element.theme.colHeader} onChange={colHeader => updateTheme({ colHeader })}>{t('foundation.editor.tableStyle.firstColumn')}</InspectorCheckbox>
          <InspectorCheckbox checked={element.theme.colFooter} onChange={colFooter => updateTheme({ colFooter })}>{t('foundation.editor.tableStyle.lastColumn')}</InspectorCheckbox>
        </div>
        <PropertyRow label={t('foundation.editor.tableStyle.themeColor')}><InspectorColorButton ariaLabel={t('foundation.editor.tableStyle.themeColor')} color={element.theme.color} onChange={color => updateTheme({ color })} /></PropertyRow>
      </> : null}
    </div>
  )
}
