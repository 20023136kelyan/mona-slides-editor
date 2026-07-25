import JSZip from 'jszip'

import { readXmlFile } from './readXmlFile'
import { getTextByPathList, resolvePackageTarget } from './utils'

/**
 * Reads ranges out of a chart's embedded workbook.
 *
 * A chart's numbers are a cache of a workbook range, and the workbook is a
 * whole package nested inside the presentation. This opens it read-only and
 * resolves the ranges a chart names — enough to check a cache against its
 * source and to give an edit somewhere to start — without rewriting a byte of
 * it, so the retained part stays exactly as the deck shipped it.
 */

const asArray = value => (value === undefined || value === null ? [] : Array.isArray(value) ? value : [value])

const first = value => (Array.isArray(value) ? value[0] : value)

const textOf = value => {
  if (typeof value === 'string') return value
  if (typeof value?.value === 'string') return value.value
  return undefined
}

/** Converts a column name to its zero-based index: A -> 0, AA -> 26. */
const columnIndex = name => {
  let index = 0
  for (const character of name) index = index * 26 + (character.charCodeAt(0) - 64)
  return index - 1
}

const CELL_PATTERN = /^([A-Z]+)(\d+)$/

/**
 * Splits `Sheet1!$B$2:$B$5` into its sheet and its corner cells. A sheet name
 * containing a space or a punctuation mark arrives single-quoted, with any
 * embedded quote doubled.
 */
export const parseRangeFormula = formula => {
  if (typeof formula !== 'string' || !formula) return undefined
  const separator = formula.lastIndexOf('!')
  if (separator < 0) return undefined
  let sheet = formula.slice(0, separator)
  if (sheet.startsWith("'") && sheet.endsWith("'")) sheet = sheet.slice(1, -1).replace(/''/g, "'")
  const cells = formula.slice(separator + 1).replace(/\$/g, '').split(':')
  const start = CELL_PATTERN.exec(cells[0] ?? '')
  if (!start) return undefined
  const end = CELL_PATTERN.exec(cells[1] ?? cells[0] ?? '')
  if (!end) return undefined
  return {
    end: { column: columnIndex(end[1]), row: Number(end[2]) - 1 },
    sheet,
    start: { column: columnIndex(start[1]), row: Number(start[2]) - 1 },
  }
}

const readSharedStrings = async zip => {
  const content = await readXmlFile(zip, 'xl/sharedStrings.xml')
  const items = asArray(getTextByPathList(content, ['sst', 'si']))
  return items.map(item => {
    const direct = textOf(item?.['t'])
    if (direct !== undefined) return direct
    // A rich-text entry splits one string across formatted runs.
    return asArray(item?.['r']).map(run => textOf(run?.['t']) ?? '').join('')
  })
}

const readSheetCells = (sheet, sharedStrings) => {
  const cells = new Map()
  for (const row of asArray(getTextByPathList(sheet, ['worksheet', 'sheetData', 'row']))) {
    for (const cell of asArray(row?.['c'])) {
      const reference = getTextByPathList(cell, ['attrs', 'r'])
      const match = reference ? CELL_PATTERN.exec(reference) : undefined
      if (!match) continue
      const type = getTextByPathList(cell, ['attrs', 't'])
      let value
      if (type === 'inlineStr') value = textOf(getTextByPathList(cell, ['is', 't']))
      else {
        const raw = textOf(cell?.['v'])
        if (raw === undefined) value = undefined
        else if (type === 's') value = sharedStrings[Number(raw)]
        else if (type === 'str' || type === 'e') value = raw
        else if (type === 'b') value = raw !== '0'
        else {
          const parsed = Number(raw)
          value = Number.isFinite(parsed) ? parsed : raw
        }
      }
      if (value === undefined) continue
      cells.set(`${columnIndex(match[1])}:${Number(match[2]) - 1}`, value)
    }
  }
  return cells
}

/**
 * Opens an embedded workbook for reading.
 *
 * `bytes` is the workbook part exactly as retained; nothing is written back.
 */
export async function openEmbeddedWorkbook(bytes) {
  const zip = await JSZip.loadAsync(bytes)
  const book = await readXmlFile(zip, 'xl/workbook.xml')
  const relationships = await readXmlFile(zip, 'xl/_rels/workbook.xml.rels')
  const targets = {}
  for (const relationship of asArray(getTextByPathList(relationships, ['Relationships', 'Relationship']))) {
    const attrs = relationship?.['attrs']
    if (attrs?.['Id'] && attrs['Target']) {
      targets[attrs['Id']] = resolvePackageTarget('xl/workbook.xml', attrs['Target'])
    }
  }

  const sheetPaths = new Map()
  const sheetNames = []
  for (const sheet of asArray(getTextByPathList(book, ['workbook', 'sheets', 'sheet']))) {
    const name = getTextByPathList(sheet, ['attrs', 'name'])
    const relationshipId = getTextByPathList(sheet, ['attrs', 'r:id'])
    if (!name || !targets[relationshipId]) continue
    sheetNames.push(name)
    sheetPaths.set(name, targets[relationshipId])
  }

  const sharedStrings = await readSharedStrings(zip)
  const loaded = new Map()
  const cellsFor = async name => {
    if (loaded.has(name)) return loaded.get(name)
    const path = sheetPaths.get(name)
    if (!path) return undefined
    const sheet = await readXmlFile(zip, path)
    const cells = sheet ? readSheetCells(sheet, sharedStrings) : undefined
    loaded.set(name, cells)
    return cells
  }

  return {
    sheetNames,
    /**
     * Resolves a range in reading order, left to right then top to bottom.
     * A cell the workbook never stored comes back `undefined` rather than
     * shifting the values that follow it.
     */
    async readRange(formula) {
      const range = parseRangeFormula(formula)
      if (!range) return undefined
      // A single-sheet workbook is the common case, and some producers name
      // the range for a sheet that no longer exists under that name.
      const cells = await cellsFor(range.sheet)
        ?? (sheetNames.length === 1 ? await cellsFor(sheetNames[0]) : undefined)
      if (!cells) return undefined
      const values = []
      for (let row = Math.min(range.start.row, range.end.row); row <= Math.max(range.start.row, range.end.row); row += 1) {
        for (let column = Math.min(range.start.column, range.end.column); column <= Math.max(range.start.column, range.end.column); column += 1) {
          values.push(cells.get(`${column}:${row}`))
        }
      }
      return values
    },
  }
}
