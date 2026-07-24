import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import AddIcon from '~icons/icon-park-outline/add'
import FillIcon from '~icons/icon-park-outline/fill'
import ReduceIcon from '~icons/icon-park-outline/reduce'
import SelectedIcon from '~icons/icon-park-outline/selected'
import type { PresentationState } from '@mona/presentation-core'
import type { LineStyleType, PPTTableElement } from '@mona/presentation-core/model'

import { Button } from '@/components/ui/button'
import { EditorColorPicker } from '@/features/editor/EditorColorPicker'
import {
  InspectorColorButton,
  InspectorNumberInput,
  InspectorPopoverButton,
  InspectorSelect,
} from '@/features/editor/EditorInspectorPrimitives'
import {
  contextualControlLabeled,
  contextualControlLabeledBorder,
} from '@/features/editor/contextual/contextual-control-styles'
import { LinePreview, PropertyRow } from '@/features/editor/ElementStyleCommons'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { lineStyleOptions } from '@/features/editor/editor-style-options'
import { useEditorApplication } from '@/features/editor/services/editor-application'
import {
  executeTableCommand,
  updateTableCellStyles,
  type TableCommand,
  type TableCommandPosition,
} from '@/features/editor/editor-table'

export function EditorTableContextControls({
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
  const [borderOpen, setBorderOpen] = useState(false)
  const commit = (props: Partial<PPTTableElement>, label: string) => runtime.commit(
    label,
    [{ type: 'element.update', payload: { id: element.id, props } }],
    { historyKey: `table-contextual-${element.id}` },
  )
  const command = (name: TableCommand, commandPosition?: TableCommandPosition) => {
    const next = executeTableCommand(element, selectedCells, name, commandPosition)
    if (next !== element) {
      commit({ data: next.data, width: next.width, colWidths: next.colWidths }, 'Edit table')
    }
    else if (name === 'delete-row' || name === 'delete-col') {
      notifications.notify({
        text: t(`foundation.editor.tableEditing.${name === 'delete-row' ? 'keepOneRow' : 'keepOneColumn'}`),
        type: 'warning',
      })
    }
  }
  const updateOutline = (props: Partial<PPTTableElement['outline']>) => commit({
    outline: { ...(element.outline || presentation.theme.outline), ...props },
  }, 'Update table border')
  const firstSelected = selectedCells[0]?.split('_').map(Number) ?? [0, 0]
  const fill = element.data[firstSelected[0]]?.[firstSelected[1]]?.style?.backcolor || ''

  return (
    <div className="mona-contextual-controls mona-contextual-table-controls">
      <div className="mona-contextual-control-row">
        <InspectorPopoverButton ariaLabel={t('foundation.editor.table.fill')} className={contextualControlLabeled} content={<EditorColorPicker onChange={backcolor => commit({ data: updateTableCellStyles(element, selectedCells, { backcolor }) }, 'Update table cell fill')} value={fill || '#ffffff'} />}><FillIcon /><span>{t('foundation.editor.table.fill')}</span></InspectorPopoverButton>
        <InspectorPopoverButton
          ariaLabel={t('foundation.editor.table.border')}
          className={contextualControlLabeledBorder}
          content={(
            <div className="mona-contextual-border-panel">
              <PropertyRow label={t('foundation.editor.text.borderStyle')}><InspectorSelect<LineStyleType> ariaLabel={t('foundation.editor.text.borderStyle')} onChange={style => updateOutline({ style })} options={lineStyleOptions} renderLabel={option => <LinePreview type={option?.value || 'solid'} />} renderOption={option => <LinePreview type={option.value} />} value={element.outline.style || 'solid'} /></PropertyRow>
              <PropertyRow label={t('foundation.editor.text.borderColor')}><InspectorColorButton ariaLabel={t('foundation.editor.text.borderColor')} color={element.outline.color || '#000'} onChange={color => updateOutline({ color })} /></PropertyRow>
              <PropertyRow label={t('foundation.editor.text.borderWidth')}><InspectorNumberInput ariaLabel={t('foundation.editor.text.borderWidth')} onChange={width => updateOutline({ width })} value={element.outline.width || 0} /></PropertyRow>
            </div>
          )}
          onOpenChange={setBorderOpen}
          open={borderOpen}
        ><SelectedIcon /><span>{t('foundation.editor.table.border')}</span></InspectorPopoverButton>
        <div className="mona-contextual-divider" />
        <InspectorPopoverButton
          ariaLabel={t('foundation.editor.table.add')}
          className={contextualControlLabeled}
          content={(
            <div className="mona-table-command-menu">
              <Button onClick={() => command('insert-row', 'before')} size="editor" type="button" variant="ghost">{t('foundation.editor.table.insertRowAbove')}</Button>
              <Button onClick={() => command('insert-row', 'after')} size="editor" type="button" variant="ghost">{t('foundation.editor.table.insertRowBelow')}</Button>
              <Button onClick={() => command('insert-col', 'before')} size="editor" type="button" variant="ghost">{t('foundation.editor.table.insertColumnLeft')}</Button>
              <Button onClick={() => command('insert-col', 'after')} size="editor" type="button" variant="ghost">{t('foundation.editor.table.insertColumnRight')}</Button>
            </div>
          )}
        ><AddIcon /><span>{t('foundation.editor.table.add')}</span></InspectorPopoverButton>
        <InspectorPopoverButton
          ariaLabel={t('foundation.editor.table.delete')}
          className={contextualControlLabeled}
          content={(
            <div className="mona-table-command-menu">
              <Button onClick={() => command('delete-row')} size="editor" type="button" variant="ghost">{t('foundation.editor.table.deleteRow')}</Button>
              <Button onClick={() => command('delete-col')} size="editor" type="button" variant="ghost">{t('foundation.editor.table.deleteColumn')}</Button>
            </div>
          )}
        ><ReduceIcon /><span>{t('foundation.editor.table.delete')}</span></InspectorPopoverButton>
      </div>
    </div>
  )
}
