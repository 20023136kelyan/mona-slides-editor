import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'

import AddIcon from '~icons/icon-park-outline/add'
import FillIcon from '~icons/icon-park-outline/fill'
import ReduceIcon from '~icons/icon-park-outline/reduce'
import SelectedIcon from '~icons/icon-park-outline/selected'
import type { PresentationState } from '@mona/presentation-core'
import type { LineStyleType, PPTTableElement } from '@mona/presentation-core/model'

import { EditorColorPicker } from '@/features/editor/EditorColorPicker'
import {
  InspectorColorButton,
  InspectorNumberInput,
  InspectorPopoverButton,
  InspectorSelect,
} from '@/features/editor/EditorInspectorPrimitives'
import { LinePreview, PropertyRow } from '@/features/editor/ElementStyleCommons'
import { executeTableCommand, updateTableCellStyles, type TableCommand, type TableCommandPosition } from '@/features/editor/editor-table'
import { getElementBounds } from '@/features/editor/editor-geometry'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { lineStyleOptions } from '@/features/editor/editor-style-options'

export function EditorFloatingTableToolbar({
  element,
  frameRef,
  presentation,
  runtime,
  scale,
  selectedCells,
  stageRef,
}: {
  element: PPTTableElement
  frameRef: RefObject<HTMLDivElement | null>
  presentation: PresentationState
  runtime: EditorRuntime
  scale: number
  selectedCells: readonly string[]
  stageRef: RefObject<HTMLElement | null>
}) {
  const { t } = useTranslation()
  const toolbarRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const [borderOpen, setBorderOpen] = useState(false)
  useLayoutEffect(() => {
    const toolbar = toolbarRef.current
    const frame = frameRef.current
    const stage = stageRef.current
    if (!toolbar || !frame || !stage) return undefined
    const update = () => {
      const range = getElementBounds(element)
      const stageRect = stage.getBoundingClientRect()
      const frameRect = frame.getBoundingClientRect()
      const minLeft = stageRect.left - frameRect.left + 10
      const maxLeft = stageRect.right - frameRect.left - toolbar.clientWidth - 10
      const requestedLeft = range.minX * scale
      const left = maxLeft < minLeft ? minLeft : Math.min(Math.max(requestedLeft, minLeft), maxLeft)
      const bottomTop = range.maxY * scale + 10
      const placeAbove = stageRect.height > 0 && bottomTop + 40 > stageRect.bottom - frameRect.top
      const requestedTop = placeAbove ? range.minY * scale - 80 : bottomTop
      const top = Math.max(stageRect.top - frameRect.top + 10, requestedTop)
      setPosition(current => current?.left === left && current.top === top ? current : { left, top })
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(toolbar)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [element, frameRef, scale, stageRef])

  const commit = (props: Partial<PPTTableElement>, label: string) => runtime.commit(label, [{ type: 'element.update', payload: { id: element.id, props } }], { historyKey: `table-floating-${element.id}` })
  const command = (name: TableCommand, commandPosition?: TableCommandPosition) => {
    const next = executeTableCommand(element, selectedCells, name, commandPosition)
    if (next !== element) commit({ data: next.data, width: next.width, colWidths: next.colWidths }, 'Edit table from floating toolbar')
    else if (name === 'delete-row' || name === 'delete-col') {
      window.dispatchEvent(new CustomEvent('mona:notice', {
        detail: {
          text: t(`foundation.editor.tableEditing.${name === 'delete-row' ? 'keepOneRow' : 'keepOneColumn'}`),
          type: 'warning',
        },
      }))
    }
  }
  const updateOutline = (props: Partial<PPTTableElement['outline']>) => commit({ outline: { ...(element.outline || presentation.theme.outline), ...props } }, 'Update table border')
  const firstSelected = selectedCells[0]?.split('_').map(Number) ?? [0, 0]
  const fill = element.data[firstSelected[0]]?.[firstSelected[1]]?.style?.backcolor || ''

  return (
    <div className="mona-floating-toolbar mona-floating-table-toolbar" onPointerDown={event => event.stopPropagation()} ref={toolbarRef} style={position || { visibility: 'hidden' }}>
      <div className="mona-floating-toolbar-content">
        <InspectorPopoverButton ariaLabel={t('foundation.editor.table.fill')} className="mona-floating-toolbar-button is-labeled" content={<EditorColorPicker onChange={backcolor => commit({ data: updateTableCellStyles(element, selectedCells, { backcolor }) }, 'Update table cell fill')} value={fill || '#ffffff'} />}><FillIcon /><span>{t('foundation.editor.table.fill')}</span></InspectorPopoverButton>
        <InspectorPopoverButton ariaLabel={t('foundation.editor.table.border')} asDiv className="mona-floating-toolbar-button is-labeled is-border" content={<div className="mona-floating-border-panel">
          <PropertyRow label={t('foundation.editor.text.borderStyle')}><InspectorSelect<LineStyleType> ariaLabel={t('foundation.editor.text.borderStyle')} onChange={style => {
            updateOutline({ style }); setBorderOpen(false) 
          }} options={lineStyleOptions} renderLabel={option => <LinePreview type={option?.value || 'solid'} />} renderOption={option => <LinePreview type={option.value} />} value={element.outline.style || 'solid'} /></PropertyRow>
          <PropertyRow label={t('foundation.editor.text.borderColor')}><InspectorColorButton ariaLabel={t('foundation.editor.text.borderColor')} color={element.outline.color || '#000'} onChange={color => {
            updateOutline({ color }); setBorderOpen(false) 
          }} /></PropertyRow>
          <PropertyRow label={t('foundation.editor.text.borderWidth')}><InspectorNumberInput ariaLabel={t('foundation.editor.text.borderWidth')} onChange={width => updateOutline({ width })} value={element.outline.width || 0} /></PropertyRow>
        </div>} onOpenChange={setBorderOpen} open={borderOpen}><SelectedIcon /><span>{t('foundation.editor.table.border')}</span></InspectorPopoverButton>
        <div className="mona-floating-divider" />
        <InspectorPopoverButton ariaLabel={t('foundation.editor.table.add')} className="mona-floating-toolbar-button is-labeled" content={<div className="mona-table-command-menu">
          <button onClick={() => command('insert-row', 'before')} type="button">{t('foundation.editor.table.insertRowAbove')}</button>
          <button onClick={() => command('insert-row', 'after')} type="button">{t('foundation.editor.table.insertRowBelow')}</button>
          <button onClick={() => command('insert-col', 'before')} type="button">{t('foundation.editor.table.insertColumnLeft')}</button>
          <button onClick={() => command('insert-col', 'after')} type="button">{t('foundation.editor.table.insertColumnRight')}</button>
        </div>}><AddIcon /><span>{t('foundation.editor.table.add')}</span></InspectorPopoverButton>
        <InspectorPopoverButton ariaLabel={t('foundation.editor.table.delete')} className="mona-floating-toolbar-button is-labeled" content={<div className="mona-table-command-menu">
          <button onClick={() => command('delete-row')} type="button">{t('foundation.editor.table.deleteRow')}</button>
          <button onClick={() => command('delete-col')} type="button">{t('foundation.editor.table.deleteColumn')}</button>
        </div>}><ReduceIcon /><span>{t('foundation.editor.table.delete')}</span></InspectorPopoverButton>
      </div>
    </div>
  )
}
