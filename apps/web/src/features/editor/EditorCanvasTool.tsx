/* oxlint-disable jsx-a11y/prefer-tag-over-role -- PPTist's span trigger DOM is required for byte-level toolbar parity. */

import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ChangeEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import BackIcon from '~icons/icon-park-outline/back'
import ChartIcon from '~icons/icon-park-outline/chart-proportion'
import ChartHistogramIcon from '~icons/icon-park-outline/chart-histogram'
import ChartHistogramOneIcon from '~icons/icon-park-outline/chart-histogram-one'
import ChartLineIcon from '~icons/icon-park-outline/chart-line'
import ChartLineAreaIcon from '~icons/icon-park-outline/chart-line-area'
import ChartPieIcon from '~icons/icon-park-outline/chart-pie'
import ChartRingIcon from '~icons/icon-park-outline/chart-ring'
import ChartScatterIcon from '~icons/icon-park-outline/chart-scatter'
import CommentIcon from '~icons/icon-park-outline/comment'
import ConnectionIcon from '~icons/icon-park-outline/connection'
import DownIcon from '~icons/icon-park-outline/down'
import FormulaIcon from '~icons/icon-park-outline/formula'
import FontSizeIcon from '~icons/icon-park-outline/font-size'
import FullScreenIcon from '~icons/icon-park-outline/full-screen'
import GraphicDesignIcon from '~icons/icon-park-outline/graphic-design'
import InsertTableIcon from '~icons/icon-park-outline/insert-table'
import MinusIcon from '~icons/icon-park-outline/minus'
import MoreIcon from '~icons/icon-park-outline/more'
import MoveOneIcon from '~icons/icon-park-outline/move-one'
import NextIcon from '~icons/icon-park-outline/next'
import PictureIcon from '~icons/icon-park-outline/picture'
import PlusIcon from '~icons/icon-park-outline/plus'
import RadarChartIcon from '~icons/icon-park-outline/radar-chart'
import SearchIcon from '~icons/icon-park-outline/search'
import SymbolIcon from '~icons/icon-park-outline/symbol'
import TextRotationDownIcon from '~icons/icon-park-outline/text-rotation-down'
import TextRotationNoneIcon from '~icons/icon-park-outline/text-rotation-none'
import UploadIcon from '~icons/icon-park-outline/upload'
import VideoIcon from '~icons/icon-park-outline/video-two'
import WritingIcon from '~icons/icon-park-outline/writing-fluently'
import { editorActions, selectSession } from '@mona/editor-state'
import { LINE_LIST, SHAPE_LIST, type LinePoolItem, type PresentationState, type ShapePoolItem } from '@mona/presentation-core'
import type { ChartType } from '@mona/presentation-core/model'
import { Popover as PopoverPrimitive } from 'radix-ui'

import { LinePointMarker } from '@/features/editor/ElementStyleCommons'
import { EditorMediaInput } from '@/features/editor/EditorMediaInput'
import { EditorTableGenerator } from '@/features/editor/EditorTableGenerator'
import { CHART_TYPES } from '@/features/editor/editor-chart'
import type { EditorCreateTool } from '@/features/editor/editor-create-tool'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { useEditorSelector } from '@/features/editor/use-editor-selector'

function ToolPopover({
  children,
  className = '',
  content,
  onOpenChange,
  open,
}: {
  children: ReactNode
  className?: string
  content: React.ReactNode
  onOpenChange?: (open: boolean) => void
  open?: boolean
}) {
  return (
    <PopoverPrimitive.Root onOpenChange={onOpenChange} open={open}>
      <PopoverPrimitive.Trigger asChild>{children}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content align="center" className={`mona-canvas-tool-popover${className ? ` ${className}` : ''}`} side="bottom" sideOffset={10}>
          {content}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

function ShapeThumbnail({ category, index, onSelect, shape }: {
  category: string
  index: number
  onSelect: () => void
  shape: ShapePoolItem
}) {
  return (
    <button aria-label={shape.title || `${category} shape ${index + 1}`} className="mona-canvas-shape-item" onClick={onSelect} type="button">
      <svg height="18" overflow="visible" width="18">
        <g transform={`scale(${18 / shape.viewBox[0]}, ${18 / shape.viewBox[1]}) translate(0,0) matrix(1,0,0,1,0,0)`}>
          <path
            className={shape.outlined ? 'is-outlined' : ''}
            d={shape.path}
            fill={shape.outlined ? '#999' : 'transparent'}
            stroke={shape.outlined ? 'transparent' : '#999'}
            strokeLinecap="butt"
            strokeMiterlimit="8"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        </g>
      </svg>
    </button>
  )
}

function ShapePool({ onSelect }: { onSelect: (shape: ShapePoolItem) => void }) {
  const { t } = useTranslation()
  return (
    <div className="mona-canvas-shape-pool">
      {SHAPE_LIST.map(category => (
        <section className="mona-canvas-pool-category" key={category.type}>
          <div className="mona-canvas-pool-category-name">{t(`foundation.editor.canvasTool.shapeGroups.${category.type}`)}</div>
          <div className="mona-canvas-shape-list">
            {category.children.map((shape, index) => (
              <ShapeThumbnail category={category.type} index={index} key={`${category.type}-${index}`} onSelect={() => onSelect(shape)} shape={shape} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function LinePool({ onSelect }: { onSelect: (line: LinePoolItem) => void }) {
  const { t } = useTranslation()
  return (
    <div className="mona-canvas-line-pool">
      {LINE_LIST.map((category, categoryIndex) => (
        <section className="mona-canvas-pool-category" key={category.type}>
          <div className="mona-canvas-pool-category-name">{t(`foundation.editor.canvasTool.lineGroups.${category.type}`)}</div>
          <div className="mona-canvas-line-list">
            {category.children.map((line, index) => {
              const id = `mona-create-line-${categoryIndex}-${index}`
              return (
                <button aria-label={`${category.type} line ${index + 1}`} className="mona-canvas-line-item" key={id} onClick={() => onSelect(line)} type="button">
                  <svg height="20" overflow="visible" width="20">
                    <defs>
                      {line.points[0] ? <LinePointMarker baseSize={2} color="currentColor" id={id} position="start" preview type={line.points[0]} /> : null}
                      {line.points[1] ? <LinePointMarker baseSize={2} color="currentColor" id={id} position="end" preview type={line.points[1]} /> : null}
                    </defs>
                    <path
                      d={line.path}
                      fill="none"
                      markerEnd={line.points[1] ? `url(#${id}-${line.points[1]}-end)` : undefined}
                      markerStart={line.points[0] ? `url(#${id}-${line.points[0]}-start)` : undefined}
                      stroke="currentColor"
                      strokeDasharray={line.style === 'solid' ? '0, 0' : '4, 1'}
                      strokeWidth="2"
                    />
                  </svg>
                </button>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

function ChartPool({ onSelect }: { onSelect: (chart: ChartType) => void }) {
  const { t } = useTranslation()
  const icon = (type: ChartType) => {
    if (type === 'line') return <ChartLineIcon />
    if (type === 'bar') return <ChartHistogramIcon />
    if (type === 'pie') return <ChartPieIcon />
    if (type === 'column') return <ChartHistogramOneIcon />
    if (type === 'area') return <ChartLineAreaIcon />
    if (type === 'ring') return <ChartRingIcon />
    if (type === 'scatter') return <ChartScatterIcon />
    return <RadarChartIcon />
  }
  return (
    <ul className="mona-chart-pool">
      {CHART_TYPES.map(type => (
        <li className="mona-chart-pool-item" key={type}>
          <button className="mona-chart-pool-content" onClick={() => onSelect(type)} type="button">
            <span className="mona-chart-pool-icon">{icon(type)}</span>
            <span className="mona-chart-pool-name">{t(`foundation.editor.chartTypes.${type}`)}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function MenuItem({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return <button className="mona-canvas-tool-menu-item" onClick={onClick} type="button">{children}</button>
}

function HandlerAction({
  ariaLabel,
  children,
  className = '',
  disabled = false,
  onClick,
}: {
  ariaLabel: string
  children: ReactNode
  className?: string
  disabled?: boolean
  onClick?: () => void
}) {
  const activate = () => {
    if (!disabled) onClick?.()
  }
  return (
    <span
      aria-disabled={disabled}
      aria-label={ariaLabel}
      className={`mona-canvas-handler-item${className ? ` ${className}` : ''}`}
      onClick={activate}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') activate()
      }}
      role="button"
      tabIndex={disabled ? -1 : 0}
    >
      {children}
    </span>
  )
}

export function EditorCanvasTool({
  activeTool,
  customShapeActive,
  onCreateToolChange,
  onDrawCustomShape,
  onInsertImage,
  onInsertAudio,
  onInsertChart,
  onInsertTable,
  onInsertVideo,
  onOpenImageLibrary,
  onOpenLatexEditor,
  onOpenPathEditor,
  onToggleSymbolPanel,
  presentation,
  runtime,
  symbolPanelOpen,
}: {
  activeTool: EditorCreateTool | null
  customShapeActive: boolean
  onCreateToolChange: (tool: EditorCreateTool | null) => void
  onDrawCustomShape: () => void
  onInsertImage: (file: File) => void
  onInsertAudio: (payload: { ext?: string; src: string }) => void
  onInsertChart: (type: ChartType) => void
  onInsertTable: (rows: number, columns: number) => void
  onInsertVideo: (payload: { ext?: string; src: string }) => void
  onOpenImageLibrary: () => void
  onOpenLatexEditor: () => void
  onOpenPathEditor: () => void
  onToggleSymbolPanel: () => void
  presentation: PresentationState
  runtime: EditorRuntime
  symbolPanelOpen: boolean
}) {
  const { t } = useTranslation()
  const rootRef = useRef<HTMLDivElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const session = useEditorSelector(runtime.store, selectSession)
  const historySnapshot = useSyncExternalStore(runtime.subscribeHistory, runtime.getHistorySnapshot, runtime.getHistorySnapshot)
  const [historyCursor = 0, historyLength = 1] = historySnapshot.split(':').map(Number)
  const [shapeMenuOpen, setShapeMenuOpen] = useState(false)
  const [shapePoolOpen, setShapePoolOpen] = useState(false)
  const [linePoolOpen, setLinePoolOpen] = useState(false)
  const [imageMenuOpen, setImageMenuOpen] = useState(false)
  const [textMenuOpen, setTextMenuOpen] = useState(false)
  const [tableGeneratorOpen, setTableGeneratorOpen] = useState(false)
  const [chartPoolOpen, setChartPoolOpen] = useState(false)
  const [mediaInputOpen, setMediaInputOpen] = useState(false)
  const [fitScale, setFitScale] = useState(.9)
  const togglePanel = (panel: string) => runtime.store.dispatch(editorActions.panelToggled(panel))

  useLayoutEffect(() => {
    const root = rootRef.current
    const deck = root?.closest<HTMLElement>('.mona-editor-deck')
    if (!root || !deck) return undefined
    const update = () => {
      const centerWidth = root.clientWidth
      const canvasHeight = Math.max(0, deck.clientHeight - 80)
      setFitScale(Math.min(
        centerWidth / presentation.viewportSize,
        canvasHeight / (presentation.viewportSize * presentation.viewportRatio),
      ))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(root)
    observer.observe(deck)
    return () => observer.disconnect()
  }, [presentation.viewportRatio, presentation.viewportSize])

  const canvasScale = fitScale * (session.canvasZoom / 100)
  const canvasScalePercentage = Math.round(canvasScale * 100)
  const setAbsoluteScale = (percentage: number) => {
    // Keep PPTist's percentage-to-scale conversion exactly: canvasZoom is the
    // viewport percentage, while the menu value is the resulting CSS scale.
    const canvasZoom = Math.round(percentage / canvasScale * session.canvasZoom) / 100
    runtime.store.dispatch(editorActions.canvasZoomChanged(canvasZoom))
  }
  const scaleCanvas = (command: '+' | '-') => {
    let percentage = session.canvasZoom
    if (command === '+' && percentage <= 200) percentage += 5
    if (command === '-' && percentage >= 30) percentage -= 5
    runtime.store.dispatch(editorActions.canvasZoomChanged(percentage))
  }
  const zoomPresets = useMemo(() => [200, 150, 125, 100, 75, 50], [])
  const selectShape = (shape: ShapePoolItem) => {
    onCreateToolChange({ type: 'shape', key: 'shape', data: shape })
    setShapePoolOpen(false)
  }
  const selectLine = (line: LinePoolItem) => {
    onCreateToolChange({ type: 'line', key: 'line', data: line })
    setLinePoolOpen(false)
  }
  const selectImageFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) onInsertImage(file)
    setImageMenuOpen(false)
  }

  return (
    <div className="mona-canvas-tool" ref={rootRef}>
      <div className="mona-canvas-tool-left">
        <HandlerAction ariaLabel={t('foundation.editor.canvasTool.undo')} disabled={historyCursor <= 0} onClick={() => runtime.undo()}><BackIcon /></HandlerAction>
        <HandlerAction ariaLabel={t('foundation.editor.canvasTool.redo')} disabled={historyCursor >= historyLength - 1} onClick={() => runtime.redo()}><NextIcon /></HandlerAction>
        <div className="mona-canvas-tool-more">
          <div aria-hidden="true" className="mona-canvas-tool-divider" />
          <ToolPopover content={(
            <div className="mona-canvas-tool-menu">
              <MenuItem onClick={() => togglePanel('notes')}><CommentIcon />{t('foundation.editor.canvasTool.comments')}</MenuItem>
              <MenuItem onClick={() => togglePanel('selection')}><MoveOneIcon />{t('foundation.editor.canvasTool.selectionPane')}</MenuItem>
              <MenuItem onClick={() => togglePanel('search')}><SearchIcon />{t('foundation.editor.canvasTool.findReplace')}</MenuItem>
            </div>
          )}><HandlerAction ariaLabel="More tools" className="mona-canvas-more-icon"><MoreIcon /></HandlerAction></ToolPopover>
          <HandlerAction ariaLabel={t('foundation.editor.canvasTool.comments')} className={session.openPanels.includes('notes') ? 'is-active' : ''} onClick={() => togglePanel('notes')}><CommentIcon /></HandlerAction>
          <HandlerAction ariaLabel={t('foundation.editor.canvasTool.selectionPane')} className={session.openPanels.includes('selection') ? 'is-active' : ''} onClick={() => togglePanel('selection')}><MoveOneIcon /></HandlerAction>
          <HandlerAction ariaLabel={t('foundation.editor.canvasTool.findReplace')} className={session.openPanels.includes('search') ? 'is-active' : ''} onClick={() => togglePanel('search')}><SearchIcon /></HandlerAction>
        </div>
      </div>

      <div className="mona-canvas-tool-add-elements">
        <div className={`mona-canvas-insert-item is-group${activeTool?.type === 'text' ? ' is-active' : ''}`}>
          <button className="mona-canvas-group-main" onClick={() => onCreateToolChange({ type: 'text', key: 'text', vertical: false })} type="button"><FontSizeIcon className="mona-canvas-tool-icon" /><span>{t('foundation.editor.canvasTool.textBox')}</span></button>
          <ToolPopover content={(
            <div className="mona-canvas-tool-menu">
              <MenuItem onClick={() => {
                onCreateToolChange({ type: 'text', key: 'text', vertical: false }); setTextMenuOpen(false) 
              }}><TextRotationNoneIcon />{t('foundation.editor.canvasTool.horizontalText')}</MenuItem>
              <MenuItem onClick={() => {
                onCreateToolChange({ type: 'text', key: 'text', vertical: true }); setTextMenuOpen(false) 
              }}><TextRotationDownIcon />{t('foundation.editor.canvasTool.verticalText')}</MenuItem>
            </div>
          )} onOpenChange={setTextMenuOpen} open={textMenuOpen}><button aria-label="Text box options" className="mona-canvas-group-arrow" type="button"><DownIcon /></button></ToolPopover>
        </div>

        <div className={`mona-canvas-insert-item is-group${customShapeActive || activeTool?.type === 'shape' ? ' is-active' : ''}`}>
          <ToolPopover className="is-shape-pool" content={<ShapePool onSelect={selectShape} />} onOpenChange={setShapePoolOpen} open={shapePoolOpen}>
            <button className="mona-canvas-group-main" type="button"><GraphicDesignIcon className="mona-canvas-tool-icon" /><span>{t('foundation.editor.canvasTool.shape')}</span></button>
          </ToolPopover>
          <ToolPopover content={(
            <div className="mona-canvas-tool-menu">
              <MenuItem onClick={() => {
                setShapeMenuOpen(false); setShapePoolOpen(true) 
              }}><GraphicDesignIcon />{t('foundation.editor.canvasTool.presetShapes')}</MenuItem>
              <MenuItem onClick={() => {
                setShapeMenuOpen(false); onOpenPathEditor() 
              }}><ConnectionIcon />{t('foundation.editor.canvasTool.drawPath')}</MenuItem>
              <MenuItem onClick={() => {
                setShapeMenuOpen(false); onDrawCustomShape() 
              }}><WritingIcon />{t('foundation.editor.canvasTool.freehandShape')}</MenuItem>
            </div>
          )} onOpenChange={setShapeMenuOpen} open={shapeMenuOpen}><button aria-label="Shape options" className="mona-canvas-group-arrow" type="button"><DownIcon /></button></ToolPopover>
        </div>

        <div className="mona-canvas-insert-item is-group">
          <input accept="image/*" aria-label={t('foundation.editor.canvasTool.uploadImage')} className="mona-visually-hidden" onChange={selectImageFile} ref={imageInputRef} type="file" />
          <button className="mona-canvas-group-main" onClick={() => imageInputRef.current?.click()} type="button"><PictureIcon className="mona-canvas-tool-icon" /><span>{t('foundation.editor.canvasTool.image')}</span></button>
          <ToolPopover content={(
            <div className="mona-canvas-tool-menu is-image-menu">
              <MenuItem onClick={() => imageInputRef.current?.click()}><UploadIcon />{t('foundation.editor.canvasTool.uploadImage')}</MenuItem>
              <MenuItem onClick={() => {
                setImageMenuOpen(false); onOpenImageLibrary() 
              }}><PictureIcon />{t('foundation.editor.canvasTool.onlineImages')}</MenuItem>
            </div>
          )} onOpenChange={setImageMenuOpen} open={imageMenuOpen}><button aria-label="Image options" className="mona-canvas-group-arrow" type="button"><DownIcon /></button></ToolPopover>
        </div>

        <ToolPopover className="is-line-pool" content={<LinePool onSelect={selectLine} />} onOpenChange={setLinePoolOpen} open={linePoolOpen}>
          <button className={`mona-canvas-insert-item${activeTool?.type === 'line' ? ' is-active' : ''}`} type="button"><ConnectionIcon className="mona-canvas-tool-icon" /><span>{t('foundation.editor.canvasTool.line')}</span></button>
        </ToolPopover>
        <ToolPopover className="is-chart-pool" content={<ChartPool onSelect={type => {
          onInsertChart(type); setChartPoolOpen(false) 
        }} />} onOpenChange={setChartPoolOpen} open={chartPoolOpen}>
          <button className="mona-canvas-insert-item" type="button"><ChartIcon className="mona-canvas-tool-icon" /><span>{t('foundation.editor.canvasTool.chart')}</span></button>
        </ToolPopover>
        <ToolPopover
          className="is-table-generator"
          content={<EditorTableGenerator onClose={() => setTableGeneratorOpen(false)} onInsert={(rows, columns) => {
            onInsertTable(rows, columns); setTableGeneratorOpen(false) 
          }} />}
          onOpenChange={setTableGeneratorOpen}
          open={tableGeneratorOpen}
        >
          <button className="mona-canvas-insert-item" type="button"><InsertTableIcon className="mona-canvas-tool-icon" /><span>{t('foundation.editor.canvasTool.table')}</span></button>
        </ToolPopover>
        <button className="mona-canvas-insert-item" onClick={onOpenLatexEditor} type="button"><FormulaIcon className="mona-canvas-tool-icon" /><span>{t('foundation.editor.canvasTool.equation')}</span></button>
        <ToolPopover
          className="is-media-input"
          content={(
            <EditorMediaInput
              onClose={() => setMediaInputOpen(false)}
              onInsertAudio={payload => {
                onInsertAudio(payload); setMediaInputOpen(false) 
              }}
              onInsertVideo={payload => {
                onInsertVideo(payload); setMediaInputOpen(false) 
              }}
            />
          )}
          onOpenChange={setMediaInputOpen}
          open={mediaInputOpen}
        >
          <button className="mona-canvas-insert-item" type="button"><VideoIcon className="mona-canvas-tool-icon" /><span>{t('foundation.editor.canvasTool.media')}</span></button>
        </ToolPopover>
        <button className={'mona-canvas-insert-item' + (symbolPanelOpen ? ' is-active' : '')} onClick={onToggleSymbolPanel} type="button"><SymbolIcon className="mona-canvas-tool-icon" /><span>{t('foundation.editor.canvasTool.symbol')}</span></button>
      </div>

      <div className="mona-canvas-tool-right">
        <HandlerAction ariaLabel={t('foundation.editor.canvasTool.zoomOut')} className="is-viewport-size" onClick={() => scaleCanvas('-')}><MinusIcon /></HandlerAction>
        <ToolPopover content={(
          <div className="mona-canvas-tool-menu is-zoom-menu">
            {zoomPresets.map(value => <MenuItem key={value} onClick={() => setAbsoluteScale(value)}>{value}%</MenuItem>)}
            <MenuItem onClick={() => {
              runtime.store.dispatch(editorActions.canvasZoomChanged(90)); runtime.store.dispatch(editorActions.canvasPanChanged({ x: 0, y: 0 }))
            }}>{t('foundation.editor.canvasTool.fit')}</MenuItem>
          </div>
        )}><span className="mona-canvas-zoom-text" role="button" tabIndex={0}>{canvasScalePercentage}%</span></ToolPopover>
        <HandlerAction ariaLabel={t('foundation.editor.canvasTool.zoomIn')} className="is-viewport-size" onClick={() => scaleCanvas('+')}><PlusIcon /></HandlerAction>
        <HandlerAction ariaLabel={t('foundation.editor.canvasTool.fit')} onClick={() => {
          runtime.store.dispatch(editorActions.canvasZoomChanged(90)); runtime.store.dispatch(editorActions.canvasPanChanged({ x: 0, y: 0 }))
        }}><FullScreenIcon /></HandlerAction>
      </div>
    </div>
  )
}
