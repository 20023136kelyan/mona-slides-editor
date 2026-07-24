import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { InspectorNumberInput } from '@/features/editor/EditorInspectorPrimitives'

export function EditorTableGenerator({
  onInsert,
}: {
  onInsert: (rows: number, columns: number) => void
}) {
  const { t } = useTranslation()
  const [hovered, setHovered] = useState<[number, number] | null>(null)
  const [activeCell, setActiveCell] = useState<[number, number]>([1, 1])
  const [custom, setCustom] = useState(false)
  const [rows, setRows] = useState(3)
  const [columns, setColumns] = useState(3)
  const gridRef = useRef<HTMLTableElement>(null)
  const focusCell = (nextRows: number, nextColumns: number) => {
    const next: [number, number] = [
      Math.min(10, Math.max(1, nextRows)),
      Math.min(10, Math.max(1, nextColumns)),
    ]
    setActiveCell(next)
    setHovered(next)
    requestAnimationFrame(() => {
      gridRef.current
        ?.querySelector<HTMLButtonElement>(`[data-table-row="${next[0]}"][data-table-column="${next[1]}"]`)
        ?.focus()
    })
  }
  const handleCellKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, row: number, column: number) => {
    const command = event.key
    if (!['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'End', 'Home'].includes(command)) return
    event.preventDefault()
    if (command === 'ArrowDown') focusCell(row + 1, column)
    else if (command === 'ArrowUp') focusCell(row - 1, column)
    else if (command === 'ArrowRight') focusCell(row, column + 1)
    else if (command === 'ArrowLeft') focusCell(row, column - 1)
    else if (command === 'Home') focusCell(event.ctrlKey || event.metaKey ? 1 : row, 1)
    else focusCell(event.ctrlKey || event.metaKey ? 10 : row, 10)
  }
  return (
    <div className="mona-table-generator">
      <div className="flex h-7 items-center justify-between -mx-3 -mt-3 mb-2.5 bg-[#f9f9f9] px-3.5 text-xs leading-7 select-none">
        <div>{hovered ? t('foundation.editor.table.dimensions', { rows: hovered[0], columns: hovered[1] }) : t('foundation.editor.canvasTool.table')}</div>
        <Button onClick={() => setCustom(value => !value)} size="xs" type="button" variant="ghost">{t(custom ? 'foundation.editor.table.back' : 'foundation.editor.table.custom')}</Button>
      </div>
      {!custom ? (
        <table
          aria-label={t('foundation.editor.table.generator')}
          ref={gridRef}
        >
          <tbody>
            {Array.from({ length: 10 }, (_row, rowIndex) => (
              <tr key={rowIndex}>
                {Array.from({ length: 10 }, (_column, columnIndex) => (
                  <td key={columnIndex}>
                    <Button
                      aria-label={t('foundation.editor.table.dimensions', { rows: rowIndex + 1, columns: columnIndex + 1 })}
                      className={hovered && rowIndex < hovered[0] && columnIndex < hovered[1] ? 'is-active' : ''}
                      data-table-column={columnIndex + 1}
                      data-table-row={rowIndex + 1}
                      onBlur={event => {
                        if (!gridRef.current?.contains(event.relatedTarget)) setHovered(null)
                      }}
                      onClick={() => onInsert(rowIndex + 1, columnIndex + 1)}
                      onFocus={() => {
                        setActiveCell([rowIndex + 1, columnIndex + 1])
                        setHovered([rowIndex + 1, columnIndex + 1])
                      }}
                      onKeyDown={event => handleCellKeyDown(event, rowIndex + 1, columnIndex + 1)}
                      onMouseEnter={() => setHovered([rowIndex + 1, columnIndex + 1])}
                      onMouseLeave={event => {
                        if (event.currentTarget !== document.activeElement) setHovered(null)
                      }}
                      size="icon"
                      tabIndex={activeCell[0] === rowIndex + 1 && activeCell[1] === columnIndex + 1 ? 0 : -1}
                      type="button"
                      variant="ghost"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="w-[230px]">
          <div className="flex items-center">
            <div className="w-1/4">{t('foundation.editor.table.rows')}</div>
            <InspectorNumberInput ariaLabel={t('foundation.editor.table.rows')} max={20} min={1} onChange={setRows} style={{ width: '75%' }} value={rows} />
          </div>
          <div className="flex items-center mt-2.5">
            <div className="w-1/4">{t('foundation.editor.table.columns')}</div>
            <InspectorNumberInput ariaLabel={t('foundation.editor.table.columns')} max={20} min={1} onChange={setColumns} style={{ width: '75%' }} value={columns} />
          </div>
          <div className="flex justify-end gap-2.5 mt-2.5">
            <Button onClick={() => onInsert(rows, columns)} size="editor" type="button">{t('foundation.editor.table.confirm')}</Button>
          </div>
        </div>
      )}
    </div>
  )
}
