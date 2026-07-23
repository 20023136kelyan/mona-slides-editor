import { createPresentationId } from '@mona/presentation-core'
import type {
  PPTTableElement,
  TableCell,
  TableCellStyle,
} from '@mona/presentation-core/model'

export type TableCommand = 'delete-col' | 'delete-row' | 'insert-col' | 'insert-row'
export type TableCommandPosition = 'after' | 'before'

const cloneData = (data: TableCell[][]): TableCell[][] => structuredClone(data)

export const tableCellKey = (row: number, column: number) => `${row}_${column}`

export function parseTableCellKey(key: string): [number, number] {
  const [row = 0, column = 0] = key.split('_').map(Number)
  return [row, column]
}

export function createTableCell(style?: TableCellStyle): TableCell {
  return {
    id: createPresentationId(10),
    colspan: 1,
    rowspan: 1,
    text: '',
    ...(style ? { style: { ...style } } : {}),
  }
}

export function createTableElement({
  columns,
  rows,
  themeColor,
  fontColor,
  fontName,
  viewportHeight,
  viewportWidth,
}: {
  columns: number
  fontColor: string
  fontName: string
  rows: number
  themeColor: string
  viewportHeight: number
  viewportWidth: number
}): PPTTableElement {
  const style: TableCellStyle = { color: fontColor, fontname: fontName }
  const data = Array.from({ length: rows }, () => (
    Array.from({ length: columns }, () => createTableCell(style))
  ))
  const width = columns * 100
  const height = rows * 36
  return {
    type: 'table',
    id: createPresentationId(10),
    width,
    height,
    colWidths: new Array<number>(columns).fill(1 / columns),
    rotate: 0,
    data,
    left: (viewportWidth - width) / 2,
    top: (viewportHeight - height) / 2,
    outline: { width: 2, style: 'solid', color: '#eeece1' },
    theme: {
      color: themeColor,
      rowHeader: true,
      rowFooter: false,
      colHeader: false,
      colFooter: false,
    },
    cellMinHeight: 36,
  }
}

export function getSelectedTableCells(
  data: TableCell[][],
  start: [number, number] | null,
  end: [number, number] | null,
): string[] {
  if (!start) return []
  if (!end || (start[0] === end[0] && start[1] === end[1])) return [tableCellKey(...start)]
  const minRow = Math.min(start[0], end[0])
  const maxRow = Math.max(start[0], end[0])
  const minColumn = Math.min(start[1], end[1])
  const maxColumn = Math.max(start[1], end[1])
  const selected: string[] = []
  for (let row = 0; row < data.length; row += 1) {
    for (let column = 0; column < (data[row]?.length ?? 0); column += 1) {
      if (row >= minRow && row <= maxRow && column >= minColumn && column <= maxColumn) {
        selected.push(tableCellKey(row, column))
      }
    }
  }
  return selected
}

export function getEffectiveSelectedTableCell(element: PPTTableElement, selectedCells: readonly string[]) {
  const hidden = getHiddenTableCellKeys(element.data)
  const key = selectedCells.find(cell => !hidden.has(cell))
  if (!key) return null
  const [rowIndex, colIndex] = parseTableCellKey(key)
  return { rowIndex, colIndex }
}

export function getHiddenTableCellKeys(data: TableCell[][]): Set<string> {
  const hidden = new Set<string>()
  for (let rowIndex = 0; rowIndex < data.length; rowIndex += 1) {
    const row = data[rowIndex] ?? []
    for (let colIndex = 0; colIndex < row.length; colIndex += 1) {
      const cell = row[colIndex]!
      if (cell.colspan <= 1 && cell.rowspan <= 1) continue
      for (let rowPos = rowIndex; rowPos < rowIndex + cell.rowspan; rowPos += 1) {
        for (let colPos = rowPos === rowIndex ? colIndex + 1 : colIndex; colPos < colIndex + cell.colspan; colPos += 1) {
          hidden.add(tableCellKey(rowPos, colPos))
        }
      }
    }
  }
  return hidden
}

export function updateTableCellStyles(
  element: PPTTableElement,
  selectedCells: readonly string[],
  props: Partial<TableCellStyle>,
): TableCell[][] {
  const data = cloneData(element.data)
  for (let row = 0; row < data.length; row += 1) {
    for (let column = 0; column < (data[row]?.length ?? 0); column += 1) {
      if (!selectedCells.length || selectedCells.includes(tableCellKey(row, column))) {
        const cell = data[row]![column]!
        cell.style = { ...(cell.style ?? {}), ...props }
      }
    }
  }
  return data
}

export function updateTableCellText(element: PPTTableElement, row: number, column: number, text: string): TableCell[][] {
  const data = cloneData(element.data)
  if (data[row]?.[column]) data[row]![column]!.text = text
  return data
}

export function clearTableCellText(element: PPTTableElement, selectedCells: readonly string[]): TableCell[][] {
  const data = cloneData(element.data)
  for (const key of selectedCells) {
    const [row, column] = parseTableCellKey(key)
    if (data[row]?.[column]) data[row]![column]!.text = ''
  }
  return data
}

export function insertTableRow(element: PPTTableElement, rowIndex: number): PPTTableElement {
  const data = cloneData(element.data)
  const columns = data[0]?.length ?? 0
  data.splice(rowIndex, 0, Array.from({ length: columns }, () => createTableCell()))
  return { ...element, data }
}

export function insertTableColumn(element: PPTTableElement, colIndex: number): PPTTableElement {
  const data = cloneData(element.data)
  for (const row of data) row.splice(colIndex, 0, createTableCell())
  const sizes = element.colWidths.map(width => width * element.width)
  sizes.splice(colIndex, 0, 100)
  const width = sizes.reduce((sum, size) => sum + size, 0)
  return { ...element, data, width, colWidths: sizes.map(size => size / width) }
}

export function deleteTableRow(element: PPTTableElement, rowIndex: number): PPTTableElement {
  const data = cloneData(element.data)
  const hidden = getHiddenTableCellKeys(element.data)
  const row = element.data[rowIndex] ?? []
  for (let column = 0; column < row.length; column += 1) {
    if (!hidden.has(tableCellKey(rowIndex, column))) continue
    for (let searchRow = rowIndex; searchRow >= 0; searchRow -= 1) {
      if (!hidden.has(tableCellKey(searchRow, column))) {
        const owner = data[searchRow]?.[column]
        if (owner) owner.rowspan -= 1
        break
      }
    }
  }
  data.splice(rowIndex, 1)
  return { ...element, data }
}

export function deleteTableColumn(element: PPTTableElement, colIndex: number): PPTTableElement {
  const data = cloneData(element.data)
  const hidden = getHiddenTableCellKeys(element.data)
  for (let row = 0; row < element.data.length; row += 1) {
    if (!hidden.has(tableCellKey(row, colIndex))) continue
    for (let searchColumn = colIndex; searchColumn >= 0; searchColumn -= 1) {
      if (!hidden.has(tableCellKey(row, searchColumn))) {
        const owner = data[row]?.[searchColumn]
        if (owner) owner.colspan -= 1
        break
      }
    }
  }
  for (const row of data) row.splice(colIndex, 1)
  const sizes = element.colWidths.map(width => width * element.width)
  sizes.splice(colIndex, 1)
  const width = sizes.reduce((sum, size) => sum + size, 0)
  return { ...element, data, width, colWidths: sizes.map(size => size / width) }
}

export function mergeTableCells(element: PPTTableElement, selectedCells: readonly string[]): PPTTableElement {
  if (selectedCells.length < 2) return element
  const positions = selectedCells.map(parseTableCellKey)
  const rows = positions.map(position => position[0])
  const columns = positions.map(position => position[1])
  const minRow = Math.min(...rows)
  const maxRow = Math.max(...rows)
  const minColumn = Math.min(...columns)
  const maxColumn = Math.max(...columns)
  const data = cloneData(element.data)
  const target = data[minRow]?.[minColumn]
  if (!target) return element
  target.rowspan = maxRow - minRow + 1
  target.colspan = maxColumn - minColumn + 1
  return { ...element, data }
}

export function splitTableCell(element: PPTTableElement, row: number, column: number): PPTTableElement {
  const data = cloneData(element.data)
  const cell = data[row]?.[column]
  if (!cell) return element
  cell.rowspan = 1
  cell.colspan = 1
  return { ...element, data }
}

export function canDeleteTableAxis(element: PPTTableElement) {
  return {
    row: element.data.length > 1,
    column: Math.max(0, ...element.data.map(row => row.length)) > 1,
  }
}

export function executeTableCommand(
  element: PPTTableElement,
  selectedCells: readonly string[],
  command: TableCommand,
  position?: TableCommandPosition,
): PPTTableElement {
  const target = getEffectiveSelectedTableCell(element, selectedCells)
  const before = position === 'before'
  if (command === 'insert-row') {
    const index = target ? (before ? target.rowIndex : target.rowIndex + 1) : (before ? 0 : element.data.length)
    return insertTableRow(element, index)
  }
  if (command === 'insert-col') {
    const count = element.data[0]?.length ?? 0
    const index = target ? (before ? target.colIndex : target.colIndex + 1) : (before ? 0 : count)
    return insertTableColumn(element, index)
  }
  const canDelete = canDeleteTableAxis(element)
  if (command === 'delete-row' && canDelete.row) {
    return deleteTableRow(element, target?.rowIndex ?? element.data.length - 1)
  }
  if (command === 'delete-col' && canDelete.column) {
    return deleteTableColumn(element, target?.colIndex ?? (element.data[0]?.length ?? 1) - 1)
  }
  return element
}

export function resizeTableColumn(element: PPTTableElement, column: number, size: number): PPTTableElement {
  const sizes = element.colWidths.map(width => width * element.width)
  sizes[column] = Math.max(50, Math.round(size))
  const width = sizes.reduce((sum, columnWidth) => sum + columnWidth, 0)
  return { ...element, width, colWidths: sizes.map(columnWidth => columnWidth / width) }
}

export function expandAndFillTable(
  element: PPTTableElement,
  startRow: number,
  startColumn: number,
  values: string[][],
): PPTTableElement {
  if (!values.length || !values[0]?.length) return element
  const data = cloneData(element.data)
  const requiredRows = startRow + values.length
  const requiredColumns = startColumn + values[0].length
  const oldColumns = data[0]?.length ?? 0
  while (data.length < requiredRows) data.push(Array.from({ length: oldColumns }, () => createTableCell()))
  const extraColumns = Math.max(0, requiredColumns - oldColumns)
  if (extraColumns) {
    for (const row of data) row.push(...Array.from({ length: extraColumns }, () => createTableCell()))
  }
  for (let row = 0; row < values.length; row += 1) {
    for (let column = 0; column < (values[row]?.length ?? 0); column += 1) {
      if (data[startRow + row]?.[startColumn + column]) {
        data[startRow + row]![startColumn + column]!.text = values[row]![column]!
      }
    }
  }
  if (!extraColumns) return { ...element, data }
  const sizes = element.colWidths.map(width => width * element.width)
  sizes.push(...new Array<number>(extraColumns).fill(100))
  const width = sizes.reduce((sum, columnWidth) => sum + columnWidth, 0)
  return { ...element, data, width, colWidths: sizes.map(columnWidth => columnWidth / width) }
}

export function parsePlainTableClipboard(text: string): string[][] | null {
  const lines = text.split('\r\n')
  if (lines.at(-1) === '') lines.pop()
  let columns = -1
  const data: string[][] = []
  for (const line of lines) {
    const row = line.split('\t')
    if (row.length === 1) return null
    if (columns === -1) columns = row.length
    else if (columns !== row.length) return null
    data.push(row)
  }
  return data
}

export function parseHtmlTableClipboard(html: string): string[][] | null {
  const document = new DOMParser().parseFromString(html, 'text/html')
  const table = document.querySelector('table')
  if (!table) return []
  return [...table.querySelectorAll('tr')].map(row => {
    const values: string[] = []
    for (const cell of row.querySelectorAll('td, th')) {
      const text = cell.textContent?.trim() ?? ''
      const colspan = Number.parseInt(cell.getAttribute('colspan') || '1', 10)
      for (let index = 0; index < colspan; index += 1) values.push(text)
    }
    return values
  })
}
