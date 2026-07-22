/* oxlint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/control-has-associated-label, jsx-a11y/no-noninteractive-element-interactions -- PPTist's table/td generator interaction and DOM geometry are preserved for parity; the containing table has an accessible name. */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { InspectorNumberInput } from '@/features/editor/EditorInspectorPrimitives'

export function EditorTableGenerator({
  onClose,
  onInsert,
}: {
  onClose: () => void
  onInsert: (rows: number, columns: number) => void
}) {
  const { t } = useTranslation()
  const [hovered, setHovered] = useState<[number, number] | null>(null)
  const [custom, setCustom] = useState(false)
  const [rows, setRows] = useState(3)
  const [columns, setColumns] = useState(3)
  return (
    <div className="mona-table-generator">
      <div className="mona-table-generator-title">
        <div>{hovered ? t('foundation.editor.table.dimensions', { rows: hovered[0], columns: hovered[1] }) : t('foundation.editor.canvasTool.table')}</div>
        <button onClick={() => setCustom(value => !value)} type="button">{t(custom ? 'foundation.editor.table.back' : 'foundation.editor.table.custom')}</button>
      </div>
      {!custom ? (
        <table
          aria-label={t('foundation.editor.table.generator')}
          onClick={() => {
            if (hovered) onInsert(...hovered)
          }}
          onMouseLeave={() => setHovered(null)}
        >
          <tbody>
            {Array.from({ length: 10 }, (_row, rowIndex) => (
              <tr key={rowIndex}>
                {Array.from({ length: 10 }, (_column, columnIndex) => (
                  <td key={columnIndex} onMouseEnter={() => setHovered([rowIndex + 1, columnIndex + 1])}>
                    <div className={hovered && rowIndex < hovered[0] && columnIndex < hovered[1] ? 'is-active' : ''} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="mona-table-generator-custom">
          <div className="mona-table-generator-row">
            <div>{t('foundation.editor.table.rows')}</div>
            <InspectorNumberInput ariaLabel={t('foundation.editor.table.rows')} max={20} min={1} onChange={setRows} value={rows} />
          </div>
          <div className="mona-table-generator-row">
            <div>{t('foundation.editor.table.columns')}</div>
            <InspectorNumberInput ariaLabel={t('foundation.editor.table.columns')} max={20} min={1} onChange={setColumns} value={columns} />
          </div>
          <div className="mona-table-generator-actions">
            <button onClick={onClose} type="button">{t('foundation.editor.table.cancel')}</button>
            <button className="is-primary" onClick={() => onInsert(rows, columns)} type="button">{t('foundation.editor.table.confirm')}</button>
          </div>
        </div>
      )}
    </div>
  )
}
