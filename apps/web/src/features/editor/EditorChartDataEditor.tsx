/* oxlint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions, jsx-a11y/prefer-tag-over-role -- the data-grid resize handle and composite trigger use explicit pointer and keyboard behavior. */
import { useEffect, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'

import type { ChartData, ChartType, PPTChartElement } from '@mona/presentation-core/model'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { CHART_TYPES } from '@/features/editor/editor-chart'
import { parseCustomEditorClipboard } from '@/features/editor/editor-clipboard'
import { parseHtmlTableClipboard, parsePlainTableClipboard } from '@/features/editor/editor-table'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const ROW_COUNT = 31
const COLUMN_COUNT = 7
const CELL_WIDTH = 100
const CELL_HEIGHT = 32

type Matrix = string[][]

function createMatrix(element: PPTChartElement): Matrix {
  const matrix = Array.from({ length: ROW_COUNT }, () => Array.from({ length: COLUMN_COUNT }, () => ''))
  element.data.legends.forEach((legend, index) => {
    if (index + 1 < COLUMN_COUNT) matrix[0]![index + 1] = legend
  })
  element.data.labels.forEach((label, rowIndex) => {
    if (rowIndex + 1 >= ROW_COUNT) return
    matrix[rowIndex + 1]![0] = label
    element.data.series.forEach((series, columnIndex) => {
      if (columnIndex + 1 < COLUMN_COUNT) matrix[rowIndex + 1]![columnIndex + 1] = String(series[rowIndex] ?? '')
    })
  })
  return matrix
}

function ChartEditorButton({ children, onClick, primary = false }: {
  children: React.ReactNode
  onClick: () => void
  primary?: boolean
}) {
  return <Button className="mona-chart-editor-button" onClick={onClick} size="editor" variant={primary ? 'default' : 'outline'}>{children}</Button>
}

export function EditorChartDataEditor({ element, onClose, onSave }: {
  element: PPTChartElement
  onClose: () => void
  onSave: (payload: { data: ChartData; type: ChartType }) => void
}) {
  const { t } = useTranslation()
  const rootRef = useRef<HTMLDivElement>(null)
  const [matrix, setMatrix] = useState<Matrix>(() => createMatrix(element))
  const [chartType, setChartType] = useState<ChartType>(element.chartType)
  const [typeMenuOpen, setTypeMenuOpen] = useState(false)
  const [selectedRange, setSelectedRange] = useState<[number, number]>([
    element.data.series.length + 1,
    element.data.labels.length + 1,
  ])
  const [tempRangeSize, setTempRangeSize] = useState({ width: 0, height: 0 })
  const focusCellRef = useRef<[number, number] | null>(null)

  useEffect(() => {
    const moveNextRow = (event: KeyboardEvent) => {
      if (event.key.toUpperCase() !== 'ENTER' || !focusCellRef.current) return
      const [row, column] = focusCellRef.current
      rootRef.current?.querySelector<HTMLInputElement>(`#mona-chart-cell-${row + 1}-${column}`)?.focus()
    }
    document.addEventListener('keydown', moveNextRow)
    return () => document.removeEventListener('keydown', moveNextRow)
  }, [])

  const setCell = (row: number, column: number, value: string) => {
    setMatrix(current => current.map((line, rowIndex) => rowIndex === row
      ? line.map((cell, columnIndex) => columnIndex === column ? value : cell)
      : line))
  }

  const fillTableData = (data: string[][], row: number, column: number) => {
    setMatrix(current => current.map((line, rowIndex) => line.map((cell, columnIndex) => (
      data[rowIndex - row]?.[columnIndex - column] ?? cell
    ))))
  }

  const handlePaste = (event: ReactClipboardEvent<HTMLInputElement>, row: number, column: number) => {
    event.preventDefault()
    const item = event.clipboardData.items[0]
    if (!item || item.kind !== 'string') return
    if (item.type === 'text/plain') {
      item.getAsString(text => {
        if (typeof parseCustomEditorClipboard(text) === 'object') return
        const tabular = parsePlainTableClipboard(text)
        if (tabular) {
          fillTableData(tabular, row, column)
          return
        }
        const input = rootRef.current?.querySelector<HTMLInputElement>(`#mona-chart-cell-${row}-${column}`)
        if (!input) return
        const start = input.selectionStart ?? input.value.length
        const end = input.selectionEnd ?? start
        setCell(row, column, input.value.slice(0, start) + text + input.value.slice(end))
      })
    }
    else if (item.type === 'text/html') {
      item.getAsString(html => {
        const tabular = parseHtmlTableClipboard(html)
        if (tabular) fillTableData(tabular, row, column)
      })
    }
  }

  const clear = () => {
    setMatrix(current => current.map((line, row) => line.map((cell, column) => row > 0 && column > 0 ? '' : cell)))
  }

  const save = () => {
    const [columns, rows] = selectedRange
    const labels: string[] = []
    let legends: string[] = []
    let series: number[][] = []
    for (let row = 1; row < rows; row += 1) {
      labels.push(matrix[row]?.[0] || t('foundation.editor.chartData.category', { number: row }))
    }
    for (let column = 1; column < columns; column += 1) {
      legends.push(matrix[0]?.[column] || t('foundation.editor.chartData.series', { number: column }))
    }
    for (let column = 1; column < columns; column += 1) {
      const values: number[] = []
      for (let row = 1; row < rows; row += 1) {
        const value = Number(matrix[row]?.[column] || 0)
        values.push(value ? value : 0)
      }
      series.push(values)
    }
    if (chartType === 'scatter' && legends.length < 2) {
      legends.push('Y')
      series.push(series[0]!)
    }
    if ((chartType === 'ring' || chartType === 'pie') && legends.length > 1) {
      legends = legends.slice(0, 1)
      series = series.slice(0, 1)
    }
    onSave({ data: { labels, legends, series }, type: chartType })
  }

  const beginRangeResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const startX = event.pageX
    const startY = event.pageY
    const originWidth = selectedRange[0] * CELL_WIDTH
    const originHeight = selectedRange[1] * CELL_HEIGHT
    let latest = { width: originWidth, height: originHeight }
    const move = (pointer: PointerEvent) => {
      latest = { width: originWidth + pointer.pageX - startX, height: originHeight + pointer.pageY - startY }
      setTempRangeSize(latest)
    }
    const stop = (pointer: PointerEvent) => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', stop)
      if (pointer.pageX === startX && pointer.pageY === startY) return
      let { width, height } = latest
      if (width % CELL_WIDTH > CELL_WIDTH * 0.5) width += CELL_WIDTH - width % CELL_WIDTH
      if (height % CELL_HEIGHT > CELL_HEIGHT * 0.5) height += CELL_HEIGHT - height % CELL_HEIGHT
      setSelectedRange([Math.max(2, Math.round(width / CELL_WIDTH)), Math.max(3, Math.round(height / CELL_HEIGHT))])
      setTempRangeSize({ width: 0, height: 0 })
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', stop)
  }

  const selectedWidth = selectedRange[0] * CELL_WIDTH
  const selectedHeight = selectedRange[1] * CELL_HEIGHT

  return (
    <Dialog onOpenChange={open => {
      if (!open) onClose()
    }} open>
      <DialogContent className="mona-chart-data-modal-content" overlayClassName="mona-chart-data-mask" showCloseButton={false}>
        <DialogHeader className="sr-only"><DialogTitle>{t('foundation.editor.chartStyle.editChart')}</DialogTitle></DialogHeader>
        <div className="mona-chart-data-editor" ref={rootRef}>
          <div className="mona-chart-editor-content">
            <div className="mona-chart-editor-handler">
              <div className="mona-chart-col-header">
                {Array.from({ length: COLUMN_COUNT }, (_, index) => <div className="mona-chart-col-header-item" key={index}><div className="mona-chart-col-key">{ALPHABET[index]}</div></div>)}
              </div>
              <div className="mona-chart-row-header">
                {Array.from({ length: ROW_COUNT }, (_, index) => <div className="mona-chart-row-header-item" key={index}><div className="mona-chart-row-key">{index + 1}</div></div>)}
              </div>
              <div className="mona-chart-all-header">
                <svg className="mona-chart-corner-triangle" height="8" viewBox="0 0 8 8" width="8"><path d="M8,0 L8,8 L0,8 L8,0" fill="#ccc" /></svg>
              </div>
            </div>
            <div className="mona-chart-range-box">
              <div className="mona-chart-temp-range" style={{ width: tempRangeSize.width, height: tempRangeSize.height }} />
              <div className="mona-chart-range-line is-top" style={{ width: selectedWidth }} />
              <div className="mona-chart-range-line is-bottom" style={{ top: selectedHeight, width: selectedWidth }} />
              <div className="mona-chart-range-line is-left" style={{ height: selectedHeight }} />
              <div className="mona-chart-range-line is-right" style={{ left: selectedWidth, height: selectedHeight }} />
              <div className="mona-chart-range-resizable" onPointerDown={beginRangeResize} style={{ left: selectedWidth, top: selectedHeight }} />
            </div>
            <table className="mona-chart-data-table">
              <tbody>
                {Array.from({ length: ROW_COUNT }, (_, row) => (
                  <tr key={row}>
                    {Array.from({ length: COLUMN_COUNT }, (_, column) => (
                      <td className={(column === 0 && row < selectedRange[1]) || (row === 0 && column < selectedRange[0]) ? 'is-head' : ''} key={column}>
                        {row === 0 && column === 0 ? null : (
                          <input
                            aria-label={t('foundation.editor.chartData.cell', {
                              column: ALPHABET[column],
                              row: row + 1,
                            })}
                            autoComplete="off"
                            className={`mona-chart-data-item${row < selectedRange[1] && column < selectedRange[0] ? ' is-selected' : ''}`}
                            id={`mona-chart-cell-${row}-${column}`}
                            onChange={event => setCell(row, column, event.target.value)}
                            onFocus={() => {
                              focusCellRef.current = [row, column] 
                            }}
                            onPaste={event => handlePaste(event, row, column)}
                            value={matrix[row]![column]}
                          />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mona-chart-editor-buttons">
            <div className="mona-chart-editor-buttons-left">
              {t('foundation.editor.chartData.type', { type: t(`foundation.editor.chartTypes.${chartType}`) })}
              <Popover onOpenChange={setTypeMenuOpen} open={typeMenuOpen}>
                <PopoverTrigger asChild><Button className="mona-chart-editor-change" size="xs" variant="link">{t('foundation.editor.chartData.change')}</Button></PopoverTrigger>
                <PopoverContent aria-label={t('foundation.editor.chartData.change')} align="center" className="mona-chart-type-menu is-data-editor" side="top" sideOffset={8}>
                  {CHART_TYPES.map(type => <PopoverClose asChild key={type}><Button onClick={() => setChartType(type)} size="sm" variant="ghost">{t(`foundation.editor.chartTypes.${type}`)}</Button></PopoverClose>)}
                </PopoverContent>
              </Popover>
            </div>
            <div className="mona-chart-editor-buttons-right">
              <ChartEditorButton onClick={onClose}>{t('foundation.editor.chartData.cancel')}</ChartEditorButton>
              <ChartEditorButton onClick={clear}>{t('foundation.editor.chartData.clear')}</ChartEditorButton>
              <ChartEditorButton onClick={save} primary>{t('foundation.editor.chartData.confirm')}</ChartEditorButton>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
