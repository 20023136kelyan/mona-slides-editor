/** Element pools (shapes, lines, tables, symbols, equations) and the Text panel. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import ConnectionIcon from '~icons/icon-park-outline/connection'
import FormulaIcon from '~icons/icon-park-outline/formula'
import TextRotationDownIcon from '~icons/icon-park-outline/text-rotation-down'
import TextRotationNoneIcon from '~icons/icon-park-outline/text-rotation-none'
import WritingIcon from '~icons/icon-park-outline/writing-fluently'
import { LINE_LIST, SHAPE_LIST, type LinePoolItem, type ShapePoolItem } from '@mona/presentation-core'
import { SYMBOL_LIST } from '@mona/presentation-core/symbol-presets'

import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { LinePointMarker } from '@/features/editor/ElementStyleCommons'
import { EditorTableGenerator } from '@/features/editor/EditorTableGenerator'
import { useEditorPanel } from '@/features/editor/panel/editor-panel-context'
import { useEditorPanelSearch } from '@/features/editor/panel/editor-panel-search'
import { PanelBody, PanelChrome, PanelNoResults } from '@/features/editor/panel/EditorPanelPrimitives'
import { cn } from '@/lib/utils'


const EMOJI_TYPES = ['face', 'gesture', 'nature', 'food', 'travel', 'activity', 'object', 'symbol'] as const

const poolCategoryLabelClassName = 'mb-2 w-full box-border px-0 py-0.5 text-xs font-semibold text-foreground/70'
const shapeItemClassName = 'relative mb-[calc(8%/7)] flex h-0 w-[11.5%] flex-[0_0_11.5%] items-center justify-center border-0 bg-transparent p-0 pb-[11.5%] [&:not(:nth-child(8n))]:mr-[calc(8%/7)] [&>svg]:absolute [&>svg]:top-1/2 [&>svg]:left-1/2 [&>svg]:-translate-x-1/2 [&>svg]:-translate-y-1/2 hover:[&_path:not(.is-outlined)]:stroke-editor-selection hover:[&_path.is-outlined]:fill-editor-selection'
const lineItemClassName = 'relative mb-[calc(5%/4)] flex h-0 w-[19%] flex-[0_0_19%] items-center justify-center border-0 bg-transparent p-0 pb-[19%] text-[#999] [&:not(:nth-child(5n))]:mr-[calc(5%/4)] [&>svg]:absolute [&>svg]:top-1/2 [&>svg]:left-1/2 [&>svg]:-translate-x-1/2 [&>svg]:-translate-y-1/2 hover:text-editor-selection'

function ShapeThumbnail({ category, index, onSelect, shape }: {
  category: string
  index: number
  onSelect: () => void
  shape: ShapePoolItem
}) {
  return (
    <Button aria-label={shape.title || `${category} shape ${index + 1}`} className={shapeItemClassName} onClick={onSelect} size="editor-icon" type="button" variant="ghost">
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
    </Button>
  )
}

function ShapePool({ onSelect, query }: { onSelect: (shape: ShapePoolItem) => void; query: string }) {
  const { t } = useTranslation()
  const needle = query.trim().toLocaleLowerCase()
  // Shapes carry titles, so the drawer's bar can narrow them. A category that
  // loses every shape drops out rather than leaving a bare heading behind.
  const categories = SHAPE_LIST
    .map(category => ({
      ...category,
      children: needle
        ? category.children.filter(shape => (shape.title ?? '').toLocaleLowerCase().includes(needle)
          || t(`foundation.editor.canvasTool.shapeGroups.${category.type}`).toLocaleLowerCase().includes(needle))
        : category.children,
    }))
    .filter(category => category.children.length)
  if (!categories.length) return null
  return (
    <div className="mt-3 w-full">
      {categories.map(category => (
        <section key={category.type}>
          <div className={poolCategoryLabelClassName}>{t(`foundation.editor.canvasTool.shapeGroups.${category.type}`)}</div>
          <div className="mb-2.5 flex flex-wrap content-start">
            {category.children.map((shape, index) => (
              <ShapeThumbnail category={category.type} index={index} key={`${category.type}-${index}`} onSelect={() => onSelect(shape)} shape={shape} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function LinePool({ onSelect, query }: { onSelect: (line: LinePoolItem) => void; query: string }) {
  const { t } = useTranslation()
  const needle = query.trim().toLocaleLowerCase()
  // Line presets have no titles of their own, so only their group label is
  // matchable; narrowing to a whole group is still better than ignoring input.
  const categories = LINE_LIST
    .map((category, categoryIndex) => ({ category, categoryIndex }))
    .filter(({ category }) => !needle || t(`foundation.editor.canvasTool.lineGroups.${category.type}`).toLocaleLowerCase().includes(needle))
  if (!categories.length) return null
  return (
    <div className="w-full">
      {categories.map(({ category, categoryIndex }) => (
        <section key={category.type}>
          <div className={poolCategoryLabelClassName}>{t(`foundation.editor.canvasTool.lineGroups.${category.type}`)}</div>
          <div className="mb-2.5 flex flex-wrap content-start">
            {category.children.map((line, index) => {
              const id = `mona-create-line-${categoryIndex}-${index}`
              return (
                <Button aria-label={`${category.type} line ${index + 1}`} className={lineItemClassName} key={id} onClick={() => onSelect(line)} size="editor-icon" type="button" variant="ghost">
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
                </Button>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

function SymbolPool({ onSelect }: { onSelect: (value: string) => void }) {
  const { t } = useTranslation()
  const [selectedSymbolKey, setSelectedSymbolKey] = useState(SYMBOL_LIST[0]!.key)
  const [selectedEmojiTypeIndex, setSelectedEmojiTypeIndex] = useState(0)
  const poolRef = useRef<HTMLDivElement>(null)
  const selectedSymbol = SYMBOL_LIST.find(item => item.key === selectedSymbolKey) || SYMBOL_LIST[0]!
  const symbolPool: readonly (readonly string[])[] = selectedSymbol.key === 'emoji'
    ? [selectedSymbol.children[selectedEmojiTypeIndex] || []]
    : selectedSymbol.children

  useEffect(() => {
    poolRef.current?.scrollTo(0, 0)
  }, [selectedEmojiTypeIndex, selectedSymbolKey])

  return (
    <div className="flex h-full min-h-0 flex-col text-foreground">
      <Tabs className="mb-2 w-full shrink-0 select-none" onValueChange={setSelectedSymbolKey} value={selectedSymbolKey}>
        <TabsList className="h-auto w-full flex-wrap justify-start gap-0 rounded-none bg-transparent p-0" variant="line">
          {SYMBOL_LIST.map(item => (
            <TabsTrigger className="flex-none rounded-none px-2.5 py-1.5 text-xs" key={item.key} value={item.key}>
              {t('foundation.editor.symbolPanel.tabs.' + item.key)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {selectedSymbolKey === 'emoji' ? (
        <ToggleGroup className="mb-0.75 items-center text-xs" onValueChange={value => {
          if (value) setSelectedEmojiTypeIndex(Number(value))
        }} spacing={1} type="single" value={String(selectedEmojiTypeIndex)}>
          {EMOJI_TYPES.map((type, index) => <ToggleGroupItem className="h-auto min-w-0 px-1 py-0.5 font-normal data-[state=on]:bg-editor-selection-subtle data-[state=on]:font-bold data-[state=on]:text-editor-selection" key={type} value={String(index)}>{t('foundation.editor.symbolPanel.categories.' + type)}</ToggleGroupItem>)}
        </ToggleGroup>
      ) : null}
      <div className="mx-[-12px] flex-1 overflow-auto px-3 pt-1.25 text-[18px] select-none" ref={poolRef}>
        {symbolPool.map((group, groupIndex) => (
          <div className="flex flex-wrap content-start [&:not(:first-child)]:mt-2 [&:not(:first-child)]:border-t [&:not(:first-child)]:pt-2.5" key={groupIndex}>
            {group.map((item, index) => (
              <Button
                className="relative mb-[calc(4%/7)] h-9.5 w-[12%] rounded-none border p-0 transition-colors hover:border-foreground hover:text-foreground [&:not(:nth-child(8n))]:mr-[calc(4%/7)]"
                key={item + '-' + index}
                onClick={() => onSelect(item)}
                onMouseDown={event => event.preventDefault()}
                size="editor-icon"
                type="button"
                variant="ghost"
              >
                <span className="absolute inset-0 flex items-center justify-center bg-background">{item}</span>
              </Button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function DrawerAction({ children, icon, onClick }: { children: ReactNode; icon: ReactNode; onClick: () => void }) {
  return (
    <Button
      className="mona-drawer-action h-8.5 w-full justify-start gap-2 px-2.5 text-control"
      onClick={onClick}
      size="editor"
      type="button"
      variant="outline"
    >
      <span className="mona-drawer-action-icon flex text-base [&_svg]:size-[1em]">{icon}</span>
      <span className="mona-drawer-action-label">{children}</span>
    </Button>
  )
}

const drawerStackClassName = 'mona-drawer-stack flex flex-col gap-2'
const drawerHintClassName = 'mona-drawer-hint mx-0.5 mt-0.5 text-xs leading-normal text-muted-foreground'
const drawerActionGridClassName = 'mona-drawer-action-grid grid grid-cols-2 gap-2 [&_.mona-drawer-action]:min-w-0 [&_.mona-drawer-action]:justify-start'

/**
 * Five rail entries share this one route; `elementCategory` decides which pool
 * is shown. Both panels below have no pinned header, so their body carries the
 * top padding that PanelHeader would otherwise contribute.
 */
export function ElementsPanel() {
  const { actions, elementCategory } = useEditorPanel()
  const search = useEditorPanelSearch()
  const { t } = useTranslation()
  const query = search.query
  const needle = query.trim().toLocaleLowerCase()
  // Symbols are bare glyphs and the table generator is a size picker — neither
  // has text to match, so a query that cannot apply says so rather than
  // silently returning everything.
  const unsearchable = elementCategory === 'symbols' || elementCategory === 'tables'
  const actionMatches = (label: string) => !needle || label.toLocaleLowerCase().includes(needle)

  const shapeActions = [
    { icon: <ConnectionIcon />, label: t('foundation.editor.canvasTool.drawPath'), onClick: actions.openPathEditor },
    { icon: <WritingIcon />, label: t('foundation.editor.canvasTool.freehandShape'), onClick: actions.drawCustomShape },
  ].filter(action => actionMatches(action.label))
  const equationLabel = t('foundation.editor.canvasTool.insertEquation')

  const empty = needle && !unsearchable && (
    (elementCategory === 'shapes' && !shapeActions.length && !SHAPE_LIST.some(c => c.children.some(s => (s.title ?? '').toLocaleLowerCase().includes(needle)) || t(`foundation.editor.canvasTool.shapeGroups.${c.type}`).toLocaleLowerCase().includes(needle)))
    || (elementCategory === 'lines' && !LINE_LIST.some(c => t(`foundation.editor.canvasTool.lineGroups.${c.type}`).toLocaleLowerCase().includes(needle)))
    || (elementCategory === 'equations' && !actionMatches(equationLabel))
  )

  return (
    <PanelChrome className="mona-elements-panel">
      <PanelBody className={cn(drawerStackClassName, 'pt-3')}>
        {empty ? <PanelNoResults onClear={search.clear} query={query} /> : null}
        {!empty && elementCategory === 'shapes' ? (
          <>
            {shapeActions.length ? (
              <div className={drawerActionGridClassName}>
                {shapeActions.map(action => (
                  <DrawerAction icon={action.icon} key={action.label} onClick={action.onClick}>{action.label}</DrawerAction>
                ))}
              </div>
            ) : null}
            <ShapePool onSelect={shape => actions.createTool({ type: 'shape', key: 'shape', data: shape })} query={query} />
          </>
        ) : null}
        {!empty && elementCategory === 'lines' ? <LinePool onSelect={line => actions.createTool({ type: 'line', key: 'line', data: line })} query={query} /> : null}
        {elementCategory === 'tables' ? <EditorTableGenerator onInsert={actions.insertTable} /> : null}
        {elementCategory === 'symbols' ? <SymbolPool onSelect={actions.insertSymbol} /> : null}
        {!empty && elementCategory === 'equations' && actionMatches(equationLabel) ? <DrawerAction icon={<FormulaIcon />} onClick={actions.openLatexEditor}>{equationLabel}</DrawerAction> : null}
      </PanelBody>
    </PanelChrome>
  )
}

export function TextPanel() {
  const { actions } = useEditorPanel()
  const search = useEditorPanelSearch()
  const { t } = useTranslation()
  const needle = search.query.trim().toLocaleLowerCase()
  const items = [
    { icon: <TextRotationNoneIcon />, label: t('foundation.editor.canvasTool.horizontalText'), vertical: false },
    { icon: <TextRotationDownIcon />, label: t('foundation.editor.canvasTool.verticalText'), vertical: true },
  ].filter(item => !needle || item.label.toLocaleLowerCase().includes(needle))

  return (
    <PanelChrome className="mona-text-panel">
      <PanelBody className={cn(drawerStackClassName, 'pt-3')}>
        {items.length ? (
          <>
            {items.map(item => (
              <DrawerAction icon={item.icon} key={item.label} onClick={() => actions.createTool({ type: 'text', key: 'text', vertical: item.vertical })}>
                {item.label}
              </DrawerAction>
            ))}
            <p className={drawerHintClassName}>{t('foundation.editor.canvasTool.textHint')}</p>
          </>
        ) : <PanelNoResults onClear={search.clear} query={search.query} />}
      </PanelBody>
    </PanelChrome>
  )
}
