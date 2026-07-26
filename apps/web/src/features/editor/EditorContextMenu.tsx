/* oxlint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/control-has-associated-label, jsx-a11y/interactive-supports-focus, jsx-a11y/no-noninteractive-element-to-interactive-role, jsx-a11y/no-static-element-interactions, jsx-a11y/prefer-tag-over-role -- nested canvas menus use composite menu semantics and named actions. */

import { useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  BringToFront,
  ClipboardPaste,
  Columns3,
  Copy,
  Grid3x3,
  Group,
  Link2,
  Lock,
  LockOpen,
  MoveDown,
  MoveUp,
  Play,
  RotateCcw,
  Rows3,
  Scissors,
  SendToBack,
  SquareDashedMousePointer,
  Table2,
  TableCellsMerge,
  TableCellsSplit,
  Trash2,
  Ruler,
  Ungroup,
  type LucideIcon,
} from 'lucide-react'

import type { PointerPosition } from '@mona/editor-interactions'
import type { PowerPointPackageReference } from '@mona/presentation-core'
import type { ElementLinkType, Slide, SlideTheme } from '@mona/presentation-core/model'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScaledSlide } from '@/features/presentation-renderer/ScaledSlide'

interface ContextMenuItem {
  readonly action?: string
  readonly checked?: boolean
  readonly children?: readonly ContextMenuItem[]
  readonly disabled?: boolean
  readonly divider?: boolean
  readonly hidden?: boolean
  readonly icon?: LucideIcon
  readonly label?: string
  readonly shortcut?: string
}

export interface EditorContextMenuProps {
  canDeleteTableColumn?: boolean
  canDeleteTableRow?: boolean
  canGroup: boolean
  canMergeTableCells?: boolean
  canOrder: boolean
  canPaste: boolean
  canSplitTableCell?: boolean
  gridLineSize: number
  grouped: boolean
  locked: boolean
  onAction: (action: string) => void
  onDismiss: () => void
  position: PointerPosition
  showRuler: boolean
  surface: 'canvas' | 'element' | 'table-cell'
}

export function EditorContextMenu({
  canDeleteTableColumn = false,
  canDeleteTableRow = false,
  canGroup,
  canMergeTableCells = false,
  canOrder,
  canSplitTableCell = false,
  gridLineSize,
  grouped,
  locked,
  onAction,
  onDismiss,
  position,
  showRuler,
  surface,
}: EditorContextMenuProps) {
  const { t } = useTranslation()
  const canvasActions: ContextMenuItem[] = [
    { action: 'paste', icon: ClipboardPaste, label: t('foundation.editor.action.paste'), shortcut: 'Ctrl + V' },
    { action: 'select-all', icon: SquareDashedMousePointer, label: t('foundation.editor.action.selectAll'), shortcut: 'Ctrl + A' },
    { action: 'ruler', icon: Ruler, label: t('foundation.editor.action.ruler'), checked: showRuler },
    {
      action: 'grid-toggle',
      icon: Grid3x3,
      label: t('foundation.editor.action.gridLines'),
      children: [
        { action: 'grid-0', label: t('foundation.editor.action.gridNone'), checked: gridLineSize === 0 },
        { action: 'grid-25', label: t('foundation.editor.action.gridSmall'), checked: gridLineSize === 25 },
        { action: 'grid-50', label: t('foundation.editor.action.gridMedium'), checked: gridLineSize === 50 },
        { action: 'grid-100', label: t('foundation.editor.action.gridLarge'), checked: gridLineSize === 100 },
      ],
    },
    { action: 'reset-slide', icon: RotateCcw, label: t('foundation.editor.action.resetSlide') },
    { divider: true },
    { action: 'slideshow', icon: Play, label: t('foundation.editor.action.slideshow'), shortcut: 'F5' },
  ]
  const elementActions: ContextMenuItem[] = locked ? [
    { action: 'unlock', icon: LockOpen, label: t('foundation.editor.action.unlock') },
  ] : [
    { action: 'cut', icon: Scissors, label: t('foundation.editor.action.cut'), shortcut: 'Ctrl + X' },
    { action: 'copy', icon: Copy, label: t('foundation.editor.action.copy'), shortcut: 'Ctrl + C' },
    { action: 'paste', icon: ClipboardPaste, label: t('foundation.editor.action.paste'), shortcut: 'Ctrl + V' },
    { divider: true },
    {
      action: 'align-horizontal',
      icon: AlignHorizontalJustifyCenter,
      label: t('foundation.editor.action.alignHorizontal'),
      children: [
        { action: 'align-center', icon: AlignHorizontalJustifyCenter, label: t('foundation.editor.action.alignCenter') },
        { action: 'align-horizontal', icon: AlignHorizontalJustifyCenter, label: t('foundation.editor.action.alignHorizontal') },
        { action: 'align-left', icon: AlignHorizontalJustifyStart, label: t('foundation.editor.action.alignLeft') },
        { action: 'align-right', icon: AlignHorizontalJustifyEnd, label: t('foundation.editor.action.alignRight') },
      ],
    },
    {
      action: 'align-vertical',
      icon: AlignVerticalJustifyCenter,
      label: t('foundation.editor.action.alignVertical'),
      children: [
        { action: 'align-center', icon: AlignVerticalJustifyCenter, label: t('foundation.editor.action.alignCenter') },
        { action: 'align-vertical', icon: AlignVerticalJustifyCenter, label: t('foundation.editor.action.alignVertical') },
        { action: 'align-top', icon: AlignVerticalJustifyStart, label: t('foundation.editor.action.alignTop') },
        { action: 'align-bottom', icon: AlignVerticalJustifyEnd, label: t('foundation.editor.action.alignBottom') },
      ],
    },
    { divider: true },
    {
      action: 'bring-front',
      icon: BringToFront,
      label: t('foundation.editor.action.bringFront'),
      disabled: !canOrder,
      children: [
        { action: 'bring-front', icon: BringToFront, label: t('foundation.editor.action.bringFront') },
        { action: 'bring-forward', icon: MoveUp, label: t('foundation.editor.action.bringForward') },
      ],
    },
    {
      action: 'send-back',
      icon: SendToBack,
      label: t('foundation.editor.action.sendBack'),
      disabled: !canOrder,
      children: [
        { action: 'send-back', icon: SendToBack, label: t('foundation.editor.action.sendBack') },
        { action: 'send-backward', icon: MoveDown, label: t('foundation.editor.action.sendBackward') },
      ],
    },
    { divider: true },
    { action: 'set-link', icon: Link2, label: t('foundation.editor.action.setLink') },
    { action: grouped ? 'ungroup' : 'group', icon: grouped ? Ungroup : Group, hidden: !canGroup, label: t(grouped ? 'foundation.editor.action.ungroup' : 'foundation.editor.action.group'), shortcut: 'Ctrl + G' },
    { action: 'select-all', icon: SquareDashedMousePointer, label: t('foundation.editor.action.selectAll'), shortcut: 'Ctrl + A' },
    { action: 'lock', icon: Lock, label: t('foundation.editor.action.lock'), shortcut: 'Ctrl + L' },
    { action: 'delete', icon: Trash2, label: t('foundation.editor.action.delete'), shortcut: 'Delete' },
  ]
  const tableActions: ContextMenuItem[] = [
    {
      action: 'table-insert-column',
      icon: BetweenVerticalStart,
      label: t('foundation.editor.tableEditing.insertColumn'),
      children: [
        { action: 'table-insert-column-left', icon: BetweenVerticalStart, label: t('foundation.editor.tableEditing.toLeft') },
        { action: 'table-insert-column-right', icon: BetweenVerticalEnd, label: t('foundation.editor.tableEditing.toRight') },
      ],
    },
    {
      action: 'table-insert-row',
      icon: BetweenHorizontalStart,
      label: t('foundation.editor.tableEditing.insertRow'),
      children: [
        { action: 'table-insert-row-above', icon: BetweenHorizontalStart, label: t('foundation.editor.tableEditing.above') },
        { action: 'table-insert-row-below', icon: BetweenHorizontalEnd, label: t('foundation.editor.tableEditing.below') },
      ],
    },
    { action: 'table-delete-column', icon: Columns3, disabled: !canDeleteTableColumn, label: t('foundation.editor.table.deleteColumn') },
    { action: 'table-delete-row', icon: Rows3, disabled: !canDeleteTableRow, label: t('foundation.editor.table.deleteRow') },
    { divider: true },
    { action: 'table-merge', icon: TableCellsMerge, disabled: !canMergeTableCells, label: t('foundation.editor.tableEditing.mergeCells') },
    { action: 'table-split', icon: TableCellsSplit, disabled: !canSplitTableCell, label: t('foundation.editor.tableEditing.unmergeCells') },
    { divider: true },
    { action: 'table-select-column', icon: Columns3, label: t('foundation.editor.tableEditing.selectColumn') },
    { action: 'table-select-row', icon: Rows3, label: t('foundation.editor.tableEditing.selectRow') },
    { action: 'table-select-all', icon: Table2, label: t('foundation.editor.tableEditing.selectAllCells') },
  ]
  const actions = surface === 'canvas' ? canvasActions : surface === 'table-cell' ? tableActions : elementActions
  return (
    <DropdownMenu onOpenChange={open => {
      if (!open) onDismiss()
    }} open>
      <DropdownMenuTrigger asChild>
        <span aria-hidden="true" className="pointer-events-none fixed" style={{ left: position.x, top: position.y }} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        aria-label={t(surface === 'canvas' ? 'foundation.editor.canvasMenu' : surface === 'table-cell' ? 'foundation.editor.tableEditing.menu' : 'foundation.editor.elementMenu')}
        className="w-auto min-w-52"
        onContextMenu={event => {
          event.preventDefault(); event.stopPropagation()
        }}
        // Radix portals this to <body>, but React events still bubble up the
        // React tree — straight into the stage's onPointerDown, which clears
        // the menu state and unmounted this before Radix could fire onSelect.
        onPointerDown={event => event.stopPropagation()}
        side="bottom"
        sideOffset={0}
      >
        {renderContextItems(actions, onAction)}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Canva-style roomy rows: wider icon/label gap and taller hit target than the
// dense header dropdowns (which keep the primitive's compact defaults).
const CONTEXT_ROW_CLASS = 'gap-2.5 py-1.5'

function renderContextItems(items: readonly ContextMenuItem[], onAction: (action: string) => void): ReactNode {
  return items.map((item, index) => {
    if (item.hidden) return null
    if (item.divider) return <DropdownMenuSeparator key={`divider-${index}`} />
    const Icon = item.icon
    if (item.children?.length) {
      return (
        <DropdownMenuSub key={item.action}>
          <DropdownMenuSubTrigger className={CONTEXT_ROW_CLASS} disabled={item.disabled}>{Icon ? <Icon className="size-5" /> : null}{item.label}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>{renderContextItems(item.children, onAction)}</DropdownMenuSubContent>
        </DropdownMenuSub>
      )
    }
    if (item.checked !== undefined) {
      return (
        <DropdownMenuCheckboxItem checked={item.checked} className={CONTEXT_ROW_CLASS} disabled={item.disabled} key={item.action} onSelect={() => {
          if (item.action) onAction(item.action)
        }}>{Icon ? <Icon className="size-5" /> : null}{item.label}</DropdownMenuCheckboxItem>
      )
    }
    return (
      <DropdownMenuItem className={CONTEXT_ROW_CLASS} disabled={item.disabled} key={item.action} onSelect={() => {
        if (item.action) onAction(item.action)
      }}>
        {Icon ? <Icon className="size-5" /> : null}
        {item.label}
        {item.shortcut ? <DropdownMenuShortcut>{item.shortcut}</DropdownMenuShortcut> : null}
      </DropdownMenuItem>
    )
  })
}

export interface LinkSlideOption {
  readonly disabled: boolean
  readonly id: string
  readonly label: string
}

export function LinkEditor({
  address,
  linkType,
  onCancel,
  onAddressChange,
  onSlideChange,
  onSubmit,
  onTypeChange,
  slideId,
  slideOptions,
  slides,
  sourcePackages,
  theme,
  viewportRatio,
  viewportSize,
}: {
  address: string
  linkType: ElementLinkType
  onCancel: () => void
  onAddressChange: (value: string) => void
  onSlideChange: (value: string) => void
  onSubmit: () => void
  onTypeChange: (type: ElementLinkType) => void
  slideId: string
  slideOptions: readonly LinkSlideOption[]
  slides: readonly Slide[]
  sourcePackages?: readonly PowerPointPackageReference[]
  theme: SlideTheme
  viewportRatio: number
  viewportSize: number
}) {
  const { t } = useTranslation()
  const addressInputRef = useRef<HTMLInputElement>(null)
  const selectedSlide = linkType === 'slide' ? slides.find(slide => slide.id === slideId) : undefined
  const selectedOption = slideOptions.find(option => option.id === slideId)
  return (
    <Dialog onOpenChange={open => {
      if (!open) onCancel()
    }} open>
      <DialogContent className="sm:max-w-xl" onOpenAutoFocus={event => {
        if (linkType === 'web') {
          event.preventDefault()
          addressInputRef.current?.focus()
        }
      }} onPointerDown={event => event.stopPropagation()} showCloseButton={false}>
        <DialogHeader className="sr-only"><DialogTitle>{t('foundation.editor.link.title')}</DialogTitle></DialogHeader>
        <form onSubmit={event => {
          event.preventDefault(); onSubmit()
        }}>
          <Tabs onValueChange={value => onTypeChange(value as ElementLinkType)} value={linkType}>
            <TabsList aria-label={t('foundation.editor.link.typeLabel')} className="w-full justify-start border-b" variant="line">
              <TabsTrigger value="web">{t('foundation.editor.link.web')}</TabsTrigger>
              <TabsTrigger disabled={!slideOptions.some(option => !option.disabled)} value="slide">{t('foundation.editor.link.slide')}</TabsTrigger>
            </TabsList>
            <TabsContent value="web">
              <label className="grid">
                <span className="sr-only">{t('foundation.editor.link.label')}</span>
                <Input
                  onChange={event => onAddressChange(event.target.value)}
                  placeholder={t('foundation.editor.link.placeholder')}
                  ref={addressInputRef}
                  type="text"
                  value={address}
                />
              </label>
            </TabsContent>
            <TabsContent value="slide">
              <div className="grid gap-1">
                <span className="sr-only">{t('foundation.editor.link.slideLabel')}</span>
                <Select onValueChange={onSlideChange} value={slideId}>
                  <SelectTrigger aria-label={t('foundation.editor.link.slideLabel')} className="mona-link-select w-full"><SelectValue placeholder={selectedOption?.label ?? slideId} /></SelectTrigger>
                  <SelectContent>
                    {slideOptions.map(option => <SelectItem disabled={option.disabled} key={option.id} value={option.id}>{option.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {selectedSlide ? (
                <div className="mt-3">
                  <div className="text-muted-foreground">{t('foundation.editor.link.preview')}</div>
                  <div className="mona-link-slide-preview mt-1.5 w-fit overflow-hidden rounded-surface border">
                    <ScaledSlide
                      fixedWidth={500}
                      slide={selectedSlide}
                      sourcePackages={sourcePackages}
                      theme={theme}
                      thumbnail
                      viewportRatio={viewportRatio}
                      viewportSize={viewportSize}
                    />
                  </div>
                </div>
              ) : null}
            </TabsContent>
          </Tabs>
          <div className="mt-4 flex justify-end gap-2">
            <Button onClick={onCancel} size="editor" type="button" variant="outline">{t('foundation.editor.link.cancel')}</Button>
            <Button size="editor" type="submit">{t('foundation.editor.link.apply')}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
