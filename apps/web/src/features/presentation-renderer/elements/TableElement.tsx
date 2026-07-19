import type { PPTTableElement } from '@mona/presentation-core/model'

import {
  formatTableText,
  getHiddenTableCells,
  getTableCellStyle,
  getTableTextStyle,
  getTableThemeColors,
  type SlideCSSProperties,
} from '@/features/presentation-renderer/render-utils'

export function TableElement({ element }: { element: PPTTableElement }) {
  const hiddenCells = getHiddenTableCells(element.data)
  const [subThemeColor1, subThemeColor2] = getTableThemeColors(element.theme?.color)
  const tableStyle: SlideCSSProperties = {
    '--themeColor': element.theme?.color || '#5b9bd5',
    '--subThemeColor1': subThemeColor1 || '#5b9bd5',
    '--subThemeColor2': subThemeColor2 || '#5b9bd5',
  }
  const themeClasses = [
    element.theme ? 'has-theme' : '',
    element.theme?.rowHeader ? 'has-row-header' : '',
    element.theme?.rowFooter ? 'has-row-footer' : '',
    element.theme?.colHeader ? 'has-col-header' : '',
    element.theme?.colFooter ? 'has-col-footer' : '',
  ].filter(Boolean).join(' ')

  return (
    <div
      className="mona-element mona-table-element"
      data-element-id={element.id}
      data-element-type="table"
      style={{ top: element.top, left: element.left, width: element.width }}
    >
      <div className="mona-rotate-wrapper" style={{ transform: `rotate(${element.rotate}deg)` }}>
        <div className="mona-table-content">
          <div className="mona-static-table" style={{ width: element.width }}>
            <table className={themeClasses} style={tableStyle}>
              <colgroup>
                {element.colWidths.map((width, index) => <col key={`${index}-${width}`} span={1} style={{ width: width * element.width }} />)}
              </colgroup>
              <tbody>
                {element.data.map((row, rowIndex) => (
                  <tr key={row.map(cell => cell.id).join('-')} style={{ height: element.cellMinHeight }}>
                    {row.map((cell, columnIndex) => {
                      if (hiddenCells.has(`${rowIndex}_${columnIndex}`)) return null
                      const markup = { __html: formatTableText(cell.text) }
                      return (
                        <td
                          aria-label={cell.text}
                          className="mona-table-cell"
                          colSpan={cell.colspan}
                          key={cell.id}
                          rowSpan={cell.rowspan}
                          style={getTableCellStyle(element.outline, cell.style)}
                        >
                          <div className="mona-table-cell-text" dangerouslySetInnerHTML={markup} style={getTableTextStyle(element.cellMinHeight, cell.style)} />
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
