import { describe, expect, it } from 'vitest'

import type { PPTTableElement, TableCell } from '@mona/presentation-core/model'

import {
  executeTableCommand,
  getHiddenTableCellKeys,
  mergeTableCells,
  splitTableCell,
} from '@/features/editor/editor-table'

const cell = (id: string): TableCell => ({
  id,
  colspan: 1,
  rowspan: 1,
  text: id,
})

const table = (data: TableCell[][] = [
  [cell('a'), cell('b')],
  [cell('c'), cell('d')],
]): PPTTableElement => ({
  type: 'table',
  id: 'table',
  left: 0,
  top: 0,
  width: 200,
  height: 80,
  rotate: 0,
  outline: { color: '#000', style: 'solid', width: 1 },
  colWidths: [0.5, 0.5],
  cellMinHeight: 40,
  data,
})

describe('editor table structural contracts', () => {
  it('merges a rectangular selection and restores every cell on split', () => {
    const original = table()
    const merged = mergeTableCells(original, ['0_0', '0_1', '1_0', '1_1'])

    expect(merged).not.toBe(original)
    expect(merged.data[0]![0]).toMatchObject({ colspan: 2, rowspan: 2 })
    expect([...getHiddenTableCellKeys(merged.data)].sort()).toEqual(['0_1', '1_0', '1_1'])
    expect(original.data[0]![0]).toMatchObject({ colspan: 1, rowspan: 1 })

    const split = splitTableCell(merged, 0, 0)
    expect(split.data[0]![0]).toMatchObject({ colspan: 1, rowspan: 1 })
    expect(getHiddenTableCellKeys(split.data).size).toBe(0)
  })

  it('executes row and column commands relative to the selected cell without mutating the source', () => {
    const original = table()
    const withRow = executeTableCommand(original, ['0_0'], 'insert-row', 'after')
    expect(withRow.data).toHaveLength(3)
    expect(withRow.data[1]).toHaveLength(2)

    const withColumn = executeTableCommand(original, ['0_0'], 'insert-col', 'after')
    expect(withColumn.data[0]).toHaveLength(3)
    expect(withColumn.width).toBe(300)
    expect(withColumn.colWidths).toEqual([1 / 3, 1 / 3, 1 / 3])

    expect(original.data).toHaveLength(2)
    expect(original.data[0]).toHaveLength(2)
    expect(original.width).toBe(200)
  })

  it('allows deletion through a fully merged table and shrinks the surviving span', () => {
    const merged = mergeTableCells(table(), ['0_0', '0_1', '1_0', '1_1'])
    const deletedRow = executeTableCommand(merged, ['1_0'], 'delete-row')

    expect(deletedRow.data).toHaveLength(1)
    expect(deletedRow.data[0]![0]).toMatchObject({ colspan: 2, rowspan: 1 })
    expect([...getHiddenTableCellKeys(deletedRow.data)]).toEqual(['0_1'])

    const deletedColumn = executeTableCommand(merged, ['0_1'], 'delete-col')
    expect(deletedColumn.data[0]).toHaveLength(1)
    expect(deletedColumn.data[0]![0]).toMatchObject({ colspan: 1, rowspan: 2 })
    expect([...getHiddenTableCellKeys(deletedColumn.data)]).toEqual(['1_0'])
  })

  it('refuses to delete the final effective row or column', () => {
    const oneCell = table([[cell('only')]])
    oneCell.width = 100
    oneCell.colWidths = [1]

    expect(executeTableCommand(oneCell, ['0_0'], 'delete-row')).toBe(oneCell)
    expect(executeTableCommand(oneCell, ['0_0'], 'delete-col')).toBe(oneCell)
  })
})
