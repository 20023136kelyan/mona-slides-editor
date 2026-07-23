/* oxlint-disable jsx-a11y/interactive-supports-focus, jsx-a11y/no-static-element-interactions, jsx-a11y/prefer-tag-over-role -- editable table cells and the transparent edit mask are direct-manipulation surfaces. */
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type CSSProperties,
} from 'react'
import { useTranslation } from 'react-i18next'

import type { PPTTableElement, TableCell } from '@mona/presentation-core/model'

import {
  clearTableCellText,
  expandAndFillTable,
  getHiddenTableCellKeys,
  getSelectedTableCells,
  insertTableColumn,
  insertTableRow,
  parseHtmlTableClipboard,
  parsePlainTableClipboard,
  parseTableCellKey,
  resizeTableColumn,
  tableCellKey,
  updateTableCellText,
} from '@/features/editor/editor-table'
import { parseCustomEditorClipboard } from '@/features/editor/editor-clipboard'
import {
  formatTableText,
  getTableCellStyle,
  getTableTextStyle,
  getTableThemeColors,
  type SlideCSSProperties,
} from '@/features/presentation-renderer/render-utils'

export interface TableElementEditor {
  editable: boolean
  isHandle: boolean
  scale: number
  selectedCells: readonly string[]
  onContextMenu: (event: ReactMouseEvent<HTMLElement>, row: number, column: number) => void
  onElementChange: (element: PPTTableElement, label: string) => void
  onHeightChange: (height: number) => void
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
  onSelectedCellsChange: (cells: string[]) => void
  onStartEdit: () => void
}

const EMPTY_TABLE_SELECTION: readonly string[] = []

function EditableCellText({
  cell,
  onInput,
  onPasteData,
  style,
}: {
  cell: TableCell
  onInput: (value: string) => void
  onPasteData: (data: string[][]) => void
  style: CSSProperties
}) {
  const ref = useRef<HTMLDivElement>(null)
  const focusedRef = useRef(false)
  useEffect(() => {
    if (!focusedRef.current && ref.current && ref.current.innerHTML !== cell.text) ref.current.innerHTML = cell.text
  }, [cell.text])
  return (
    <div
      className="mona-table-cell-text is-active"
      contentEditable
      onBlur={() => {
        focusedRef.current = false
      }}
      onFocus={() => {
        focusedRef.current = true
      }}
      onInput={event => onInput(event.currentTarget.innerHTML)}
      onPaste={event => {
        event.preventDefault()
        const item = event.clipboardData.items[0]
        if (!item || item.kind !== 'string') return
        if (item.type === 'text/plain') {
          item.getAsString(text => {
            // the source editor encrypts copied elements/slides into text/plain. A table
            // editor ignores those payloads instead of exposing ciphertext.
            if (typeof parseCustomEditorClipboard(text) === 'object') return
            const parsed = parsePlainTableClipboard(text)
            if (parsed) {
              onPasteData(parsed)
              if (ref.current) ref.current.innerHTML = parsed[0]?.[0] ?? ''
              return
            }
            document.execCommand('insertText', false, text)
          })
        }
        else if (item.type === 'text/html') {
          item.getAsString(html => {
            const parsed = parseHtmlTableClipboard(html)
            if (parsed?.length) {
              onPasteData(parsed)
              if (ref.current) ref.current.innerHTML = parsed[0]?.[0] ?? ''
            }
          })
        }
      }}
      ref={ref}
      style={style}
      suppressContentEditableWarning
    />
  )
}

const getCaretPosition = (element: HTMLDivElement) => {
  const selection = window.getSelection()
  if (!selection?.rangeCount) return null
  const range = selection.getRangeAt(0)
  const before = range.cloneRange()
  before.selectNodeContents(element)
  before.setEnd(range.startContainer, range.startOffset)
  const start = before.toString().length
  before.setEnd(range.endContainer, range.endOffset)
  return { start, end: before.toString().length, length: element.textContent?.length ?? 0 }
}

export function TableElement({ element, editor }: { element: PPTTableElement; editor?: TableElementEditor }) {
  const { t } = useTranslation()
  const rootRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef(editor)
  const elementRef = useRef(element)
  const inputTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingCellEditRef = useRef<{ row: number; column: number; value: string } | null>(null)
  const selectingRef = useRef(false)
  const [startCell, setStartCell] = useState<[number, number] | null>(null)
  const [columnSizePreview, setColumnSizePreview] = useState<number[] | null>(null)
  const hiddenCells = useMemo(() => getHiddenTableCellKeys(element.data), [element.data])
  const selectedCells = editor?.editable ? editor.selectedCells : EMPTY_TABLE_SELECTION
  const activeCell = selectedCells.length === 1 ? selectedCells[0] : null
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
  const columnSizes = columnSizePreview ?? element.colWidths.map(width => width * element.width)
  const displayWidth = columnSizes.reduce((sum, width) => sum + width, 0)
  const columnPositions = columnSizes.map((_width, index) => columnSizes.slice(0, index + 1).reduce((sum, width) => sum + width, 0))

  useEffect(() => {
    editorRef.current = editor
  }, [editor])

  useEffect(() => {
    elementRef.current = element
  }, [element])

  // Commits build from the latest element so a flush never overwrites a
  // sibling cell's already-committed text. Returns the flushed element so a
  // follow-up commit (paste) composes on top of it. Kept as a ref-backed
  // callback because it is invoked from JSX handlers and debounce timers,
  // where useEffectEvent is not allowed to be called.
  const flushPendingCellEdit = useCallback((): PPTTableElement => {
    if (inputTimerRef.current) {
      clearTimeout(inputTimerRef.current)
      inputTimerRef.current = null
    }
    const latest = elementRef.current
    const pending = pendingCellEditRef.current
    if (!pending) return latest
    pendingCellEditRef.current = null
    const updated = { ...latest, data: updateTableCellText(latest, pending.row, pending.column, pending.value) }
    editorRef.current?.onElementChange(updated, 'Edit table cell')
    return updated
  }, [])

  useEffect(() => () => {
    flushPendingCellEdit()
  }, [flushPendingCellEdit])

  const hasEditor = Boolean(editor)
  useEffect(() => {
    const mouseup = () => {
      selectingRef.current = false
    }
    document.addEventListener('mouseup', mouseup)
    return () => document.removeEventListener('mouseup', mouseup)
  }, [])

  const commitMeasuredHeight = useEffectEvent((height: number) => {
    if (height !== element.height) editor?.onHeightChange(height)
  })
  useEffect(() => {
    const root = rootRef.current
    if (!root || !hasEditor) return undefined
    let measurementFrame = 0
    let measuredHeight: number | undefined
    const flushHeight = () => {
      measurementFrame = 0
      // WebKit reports an undelivered-notification error when the measured
      // element is synchronously resized from inside its observer callback.
      // Defer the store write to the next frame while preserving the established editor's
      // measured content-box value.
      if (measuredHeight !== undefined) commitMeasuredHeight(measuredHeight)
    }
    const observer = new ResizeObserver(entries => {
      measuredHeight = entries[0]?.contentRect.height
      if (measuredHeight !== undefined && !measurementFrame) {
        measurementFrame = requestAnimationFrame(flushHeight)
      }
    })
    observer.observe(root)
    return () => {
      if (measurementFrame) cancelAnimationFrame(measurementFrame)
      observer.disconnect()
    }
  }, [hasEditor])

  useEffect(() => () => {
    if (inputTimerRef.current) clearTimeout(inputTimerRef.current)
  }, [])

  const focusActiveCell = useCallback(() => requestAnimationFrame(() => {
    rootRef.current?.querySelector<HTMLElement>('.mona-table-cell-text.is-active')?.focus()
  }), [])

  const selectSingleCell = useCallback((row: number, column: number) => {
    setStartCell([row, column])
    editor?.onSelectedCellsChange([tableCellKey(row, column)])
  }, [editor])

  useEffect(() => {
    if (!editor?.editable || !selectedCells.length) return undefined
    const moveActiveCell = (direction: 'DOWN' | 'LEFT' | 'RIGHT' | 'UP') => {
      if (!activeCell) return
      const [row, column] = parseTableCellKey(activeCell)
      const rowCount = element.data.length
      const columnCount = element.data[0]?.length ?? 0
      const effective = (position: [number, number]): [number, number] => {
        if (position[0] < 0 || position[1] < 0 || position[0] >= rowCount || position[1] >= columnCount) return [0, 0]
        if (!hiddenCells.has(tableCellKey(...position))) return position
        // Preserve the established editor's merged-cell traversal, including its orthogonal
        // fallback for hidden positions.
        return direction === 'UP' || direction === 'DOWN'
          ? effective([position[0], position[1] - 1])
          : effective([position[0] - 1, position[1]])
      }
      const next: [number, number] = direction === 'UP' ? [row - 1, column]
        : direction === 'DOWN' ? [row + 1, column]
          : direction === 'LEFT' ? [row, column - 1]
            : [row, column + 1]
      if (next[0] < 0 || next[1] < 0 || next[0] >= rowCount || next[1] >= columnCount) return
      selectSingleCell(...effective(next))
      focusActiveCell()
    }
    const keydown = (event: KeyboardEvent) => {
      const key = event.key.toUpperCase()
      if (selectedCells.length > 1) {
        if (key === 'DELETE') {
          event.preventDefault()
          editor.onElementChange({ ...element, data: clearTableCellText(element, selectedCells) }, 'Clear table cells')
        }
        return
      }
      const [row, column] = parseTableCellKey(selectedCells[0]!)
      if (key === 'TAB') {
        event.preventDefault()
        const findNext = (nextRow: number, nextColumn: number): [number, number] | null => {
          if (!element.data[nextRow]) return null
          if (!element.data[nextRow]![nextColumn]) return findNext(nextRow + 1, 0)
          if (hiddenCells.has(tableCellKey(nextRow, nextColumn))) return findNext(nextRow, nextColumn + 1)
          return [nextRow, nextColumn]
        }
        const next = findNext(row, column + 1)
        if (next) selectSingleCell(...next)
        else {
          const updated = insertTableRow(element, row + 1)
          editor.onElementChange(updated, 'Insert table row')
          selectSingleCell(row + 1, 0)
        }
        focusActiveCell()
        return
      }
      if (event.ctrlKey && ['ARROWUP', 'ARROWDOWN', 'ARROWLEFT', 'ARROWRIGHT'].includes(key)) {
        event.preventDefault()
        const updated = key === 'ARROWUP' ? insertTableRow(element, row)
          : key === 'ARROWDOWN' ? insertTableRow(element, row + 1)
            : key === 'ARROWLEFT' ? insertTableColumn(element, column)
              : insertTableColumn(element, column + 1)
        editor.onElementChange(updated, key.includes('UP') || key.includes('DOWN') ? 'Insert table row' : 'Insert table column')
        return
      }
      if (!['ARROWUP', 'ARROWDOWN', 'ARROWLEFT', 'ARROWRIGHT'].includes(key)) return
      const target = event.target
      if (!(target instanceof HTMLDivElement)) return
      const caret = getCaretPosition(target)
      if (!caret || caret.start !== caret.end) return
      const atBoundary = key === 'ARROWUP' || key === 'ARROWLEFT' ? caret.start === 0 : caret.start === caret.length
      if (atBoundary) moveActiveCell(key.slice(5) as 'DOWN' | 'LEFT' | 'RIGHT' | 'UP')
    }
    document.addEventListener('keydown', keydown)
    return () => document.removeEventListener('keydown', keydown)
  }, [activeCell, editor, element, focusActiveCell, hiddenCells, selectSingleCell, selectedCells])

  return (
    <div
      className="mona-element mona-table-element"
      data-element-id={element.id}
      data-element-type="table"
      ref={rootRef}
      style={{ top: element.top, left: element.left, width: element.width }}
    >
      <div className="mona-rotate-wrapper" style={{ transform: `rotate(${element.rotate}deg)` }}>
        <div className="mona-table-content">
          <div
            className={`mona-static-table${editor?.editable ? ' is-editable' : ''}`}
            onPointerDown={event => {
              if (editor?.editable) event.stopPropagation()
            }}
            style={{ width: displayWidth }}
          >
            {editor?.editable ? (
              <div className="mona-table-column-handlers">
                {columnPositions.map((position, column) => (
                  <div
                    className="mona-table-column-drag-line"
                    key={column}
                    onMouseDown={event => {
                      event.preventDefault()
                      event.stopPropagation()
                      selectSingleCell(0, 0)
                      setStartCell(null)
                      const originSize = columnSizes[column]!
                      const startX = event.pageX
                      const move = (moveEvent: MouseEvent) => {
                        const next = [...columnSizes]
                        next[column] = Math.max(50, Math.round(originSize + (moveEvent.pageX - startX) / editor.scale))
                        setColumnSizePreview(next)
                      }
                      const up = (upEvent: MouseEvent) => {
                        document.removeEventListener('mousemove', move)
                        document.removeEventListener('mouseup', up)
                        const size = originSize + (upEvent.pageX - startX) / editor.scale
                        setColumnSizePreview(null)
                        editor.onElementChange(resizeTableColumn(element, column, size), 'Resize table column')
                      }
                      document.addEventListener('mousemove', move)
                      document.addEventListener('mouseup', up)
                    }}
                    style={{ left: position }}
                  />
                ))}
              </div>
            ) : null}
            <table className={themeClasses} style={tableStyle}>
              <colgroup>
                {columnSizes.map((width, index) => <col key={`${index}-${width}`} span={1} style={{ width }} />)}
              </colgroup>
              <tbody>
                {element.data.map((row, rowIndex) => (
                  <tr key={row.map(cell => cell.id).join('-')} style={{ height: element.rowHeights?.[rowIndex] ?? element.cellMinHeight }}>
                    {row.map((cell, columnIndex) => {
                      const key = tableCellKey(rowIndex, columnIndex)
                      const hidden = hiddenCells.has(key)
                      const active = activeCell === key
                      const markup = { __html: formatTableText(cell.text) }
                      return (
                        <td
                          aria-label={cell.text}
                          className={`mona-table-cell${selectedCells.length > 1 && selectedCells.includes(key) ? ' is-selected' : ''}${active ? ' is-active' : ''}`}
                          colSpan={cell.colspan}
                          data-cell-index={key}
                          key={cell.id}
                          onContextMenu={event => {
                            if (!selectedCells.includes(key)) selectSingleCell(rowIndex, columnIndex)
                            editor?.onContextMenu(event, rowIndex, columnIndex)
                          }}
                          onMouseDown={event => {
                            if (!editor?.editable || event.button !== 0) return
                            event.stopPropagation()
                            selectingRef.current = true
                            setStartCell([rowIndex, columnIndex])
                            editor.onSelectedCellsChange([key])
                          }}
                          onMouseEnter={() => {
                            if (selectingRef.current) {
                              const end: [number, number] = [rowIndex, columnIndex]
                              editor?.onSelectedCellsChange(getSelectedTableCells(element.data, startCell, end))
                            }
                          }}
                          rowSpan={cell.rowspan}
                          style={{ ...getTableCellStyle(element.outline, cell.style, cell.borders), ...(hidden ? { display: 'none' } : {}) }}
                        >
                          {active ? (
                            <EditableCellText
                              cell={cell}
                              onInput={value => {
                                const pending = pendingCellEditRef.current
                                if (pending && (pending.row !== rowIndex || pending.column !== columnIndex)) flushPendingCellEdit()
                                if (inputTimerRef.current) clearTimeout(inputTimerRef.current)
                                pendingCellEditRef.current = { row: rowIndex, column: columnIndex, value }
                                inputTimerRef.current = setTimeout(() => {
                                  inputTimerRef.current = null
                                  flushPendingCellEdit()
                                }, 300)
                              }}
                              onPasteData={values => {
                                const base = flushPendingCellEdit()
                                editor?.onElementChange(expandAndFillTable(base, rowIndex, columnIndex, values), 'Paste table cells')
                              }}
                              style={getTableTextStyle(element.cellMinHeight, cell.style)}
                            />
                          ) : <div className="mona-table-cell-text" dangerouslySetInnerHTML={markup} style={getTableTextStyle(element.cellMinHeight, cell.style)} />}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {editor && (!editor.editable || element.lock) ? (
            <div
              aria-label={t('foundation.editor.selectElement', { type: element.name || element.type, id: element.id })}
              className={`mona-table-mask${element.lock ? ' is-locked' : ''}`}
              onDoubleClick={event => {
                event.stopPropagation()
                if (!element.lock) {
                  setStartCell(null)
                  editor.onStartEdit()
                }
              }}
              onPointerDown={event => {
                if (!element.lock) editor.onPointerDown(event)
              }}
              role="button"
            >
              {editor.isHandle ? <div className="mona-table-mask-tip" style={{ transform: `scale(${1 / editor.scale})` }}>{t('foundation.editor.tableEditing.doubleClick')}</div> : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
