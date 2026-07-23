/* oxlint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/control-has-associated-label, jsx-a11y/interactive-supports-focus, jsx-a11y/no-noninteractive-element-to-interactive-role, jsx-a11y/no-static-element-interactions, jsx-a11y/prefer-tag-over-role -- nested canvas menus use composite menu semantics and named actions. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import CheckOneIcon from '~icons/icon-park-solid/check-one'
import CloseOneIcon from '~icons/icon-park-solid/close-one'
import AttentionIcon from '~icons/icon-park-solid/attention'

import type { PointerPosition } from '@mona/editor-interactions'
import type { PowerPointPackageReference } from '@mona/presentation-core'
import type { ElementLinkType, Slide, SlideTheme } from '@mona/presentation-core/model'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
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
    { action: 'paste', label: t('foundation.editor.action.paste'), shortcut: 'Ctrl + V' },
    { action: 'select-all', label: t('foundation.editor.action.selectAll'), shortcut: 'Ctrl + A' },
    { action: 'ruler', label: t('foundation.editor.action.ruler'), checked: showRuler },
    {
      action: 'grid-toggle',
      label: t('foundation.editor.action.gridLines'),
      children: [
        { action: 'grid-0', label: t('foundation.editor.action.gridNone'), checked: gridLineSize === 0 },
        { action: 'grid-25', label: t('foundation.editor.action.gridSmall'), checked: gridLineSize === 25 },
        { action: 'grid-50', label: t('foundation.editor.action.gridMedium'), checked: gridLineSize === 50 },
        { action: 'grid-100', label: t('foundation.editor.action.gridLarge'), checked: gridLineSize === 100 },
      ],
    },
    { action: 'reset-slide', label: t('foundation.editor.action.resetSlide') },
    { divider: true },
    { action: 'slideshow', label: t('foundation.editor.action.slideshow'), shortcut: 'F5' },
  ]
  const elementActions: ContextMenuItem[] = locked ? [
    { action: 'unlock', label: t('foundation.editor.action.unlock') },
  ] : [
    { action: 'cut', label: t('foundation.editor.action.cut'), shortcut: 'Ctrl + X' },
    { action: 'copy', label: t('foundation.editor.action.copy'), shortcut: 'Ctrl + C' },
    { action: 'paste', label: t('foundation.editor.action.paste'), shortcut: 'Ctrl + V' },
    { divider: true },
    {
      action: 'align-horizontal',
      label: t('foundation.editor.action.alignHorizontal'),
      children: [
        { action: 'align-center', label: t('foundation.editor.action.alignCenter') },
        { action: 'align-horizontal', label: t('foundation.editor.action.alignHorizontal') },
        { action: 'align-left', label: t('foundation.editor.action.alignLeft') },
        { action: 'align-right', label: t('foundation.editor.action.alignRight') },
      ],
    },
    {
      action: 'align-vertical',
      label: t('foundation.editor.action.alignVertical'),
      children: [
        { action: 'align-center', label: t('foundation.editor.action.alignCenter') },
        { action: 'align-vertical', label: t('foundation.editor.action.alignVertical') },
        { action: 'align-top', label: t('foundation.editor.action.alignTop') },
        { action: 'align-bottom', label: t('foundation.editor.action.alignBottom') },
      ],
    },
    { divider: true },
    {
      action: 'bring-front',
      label: t('foundation.editor.action.bringFront'),
      disabled: !canOrder,
      children: [
        { action: 'bring-front', label: t('foundation.editor.action.bringFront') },
        { action: 'bring-forward', label: t('foundation.editor.action.bringForward') },
      ],
    },
    {
      action: 'send-back',
      label: t('foundation.editor.action.sendBack'),
      disabled: !canOrder,
      children: [
        { action: 'send-back', label: t('foundation.editor.action.sendBack') },
        { action: 'send-backward', label: t('foundation.editor.action.sendBackward') },
      ],
    },
    { divider: true },
    { action: 'set-link', label: t('foundation.editor.action.setLink') },
    { action: grouped ? 'ungroup' : 'group', hidden: !canGroup, label: t(grouped ? 'foundation.editor.action.ungroup' : 'foundation.editor.action.group'), shortcut: 'Ctrl + G' },
    { action: 'select-all', label: t('foundation.editor.action.selectAll'), shortcut: 'Ctrl + A' },
    { action: 'lock', label: t('foundation.editor.action.lock'), shortcut: 'Ctrl + L' },
    { action: 'delete', label: t('foundation.editor.action.delete'), shortcut: 'Delete' },
  ]
  const tableActions: ContextMenuItem[] = [
    {
      action: 'table-insert-column',
      label: t('foundation.editor.tableEditing.insertColumn'),
      children: [
        { action: 'table-insert-column-left', label: t('foundation.editor.tableEditing.toLeft') },
        { action: 'table-insert-column-right', label: t('foundation.editor.tableEditing.toRight') },
      ],
    },
    {
      action: 'table-insert-row',
      label: t('foundation.editor.tableEditing.insertRow'),
      children: [
        { action: 'table-insert-row-above', label: t('foundation.editor.tableEditing.above') },
        { action: 'table-insert-row-below', label: t('foundation.editor.tableEditing.below') },
      ],
    },
    { action: 'table-delete-column', disabled: !canDeleteTableColumn, label: t('foundation.editor.table.deleteColumn') },
    { action: 'table-delete-row', disabled: !canDeleteTableRow, label: t('foundation.editor.table.deleteRow') },
    { divider: true },
    { action: 'table-merge', disabled: !canMergeTableCells, label: t('foundation.editor.tableEditing.mergeCells') },
    { action: 'table-split', disabled: !canSplitTableCell, label: t('foundation.editor.tableEditing.unmergeCells') },
    { divider: true },
    { action: 'table-select-column', label: t('foundation.editor.tableEditing.selectColumn') },
    { action: 'table-select-row', label: t('foundation.editor.tableEditing.selectRow') },
    { action: 'table-select-all', label: t('foundation.editor.tableEditing.selectAllCells') },
  ]
  const actions = surface === 'canvas' ? canvasActions : surface === 'table-cell' ? tableActions : elementActions
  const visible = actions.filter(item => !item.hidden)
  const menuHeight = visible.filter(item => !item.divider).length * 30 + visible.filter(item => item.divider).length * 11 + 10
  const viewportWidth = document.body.clientWidth
  const viewportHeight = document.body.clientHeight
  const adjustedPosition = {
    x: viewportWidth <= position.x + 180 ? position.x - 180 : position.x,
    y: viewportHeight <= position.y + menuHeight ? position.y - menuHeight : position.y,
  }

  const renderMenu = (items: readonly ContextMenuItem[], submenu = false) => (
    <ul className={`mona-context-menu-content${submenu ? ' mona-editor-context-submenu' : ''}`} role="menu">
      {items.map((item, index) => {
        if (item.hidden) return null
        if (item.divider) return <li className="mona-context-menu-entry is-divider" key={`divider-${index}`} role="separator" />
        const hasChildren = !!item.children?.length
        return (
          <li
            aria-disabled={item.disabled || undefined}
            aria-haspopup={hasChildren ? 'menu' : undefined}
            className={`mona-context-menu-entry${item.disabled ? ' is-disabled' : ''}`}
            data-action={item.action}
            key={item.action}
            onClick={event => {
              event.stopPropagation()
              if (item.disabled) return
              if (item.action) onAction(item.action)
            }}
            role="menuitem"
          >
            <div className={`mona-context-menu-item-content${hasChildren ? ' has-children' : ''}${hasChildren && item.action ? ' has-handler' : ''}`}>
              <span className="mona-context-menu-label">{item.label}</span>
              {!hasChildren && (item.checked || item.shortcut) ? (
                <span className="mona-context-menu-shortcut">{item.checked ? '√' : item.shortcut}</span>
              ) : null}
              {hasChildren ? renderMenu(item.children!, true) : null}
            </div>
          </li>
        )
      })}
    </ul>
  )

  return createPortal((
    <>
      <div
        className="mona-editor-context-menu-mask"
        onContextMenu={event => {
          event.preventDefault(); event.stopPropagation(); onDismiss()
        }}
        onMouseDown={event => {
          if (event.button === 0) onDismiss()
        }}
        onPointerDown={event => event.stopPropagation()}
      />
      <div
        aria-label={t(surface === 'canvas' ? 'foundation.editor.canvasMenu' : surface === 'table-cell' ? 'foundation.editor.tableEditing.menu' : 'foundation.editor.elementMenu')}
        className="mona-editor-context-menu"
        onContextMenu={event => {
          event.preventDefault(); event.stopPropagation()
        }}
        onPointerDown={event => event.stopPropagation()}
        role="menu"
        style={{ left: adjustedPosition.x, top: adjustedPosition.y }}
        tabIndex={-1}
      >
        {renderMenu(actions)}
      </div>
    </>
  ), document.body)
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
      <DialogContent className="mona-link-dialog" onOpenAutoFocus={event => {
        if (linkType === 'web') {
          event.preventDefault()
          addressInputRef.current?.focus()
        }
      }} onPointerDown={event => event.stopPropagation()} overlayClassName="mona-link-dialog-backdrop" showCloseButton={false}>
        <DialogHeader className="sr-only"><DialogTitle>{t('foundation.editor.link.title')}</DialogTitle></DialogHeader>
        <form onSubmit={event => {
          event.preventDefault(); onSubmit()
        }}>
          <Tabs onValueChange={value => onTypeChange(value as ElementLinkType)} value={linkType}>
            <TabsList aria-label={t('foundation.editor.link.typeLabel')} className="mona-link-type-tabs">
              <TabsTrigger className="mona-link-type-tab" value="web">{t('foundation.editor.link.web')}</TabsTrigger>
              <TabsTrigger className="mona-link-type-tab" disabled={!slideOptions.some(option => !option.disabled)} value="slide">{t('foundation.editor.link.slide')}</TabsTrigger>
            </TabsList>
            <TabsContent value="web">
            <label className="mona-link-field">
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
              <div className="mona-link-select-wrap">
                <span className="sr-only">{t('foundation.editor.link.slideLabel')}</span>
                <Select onValueChange={onSlideChange} value={slideId}>
                  <SelectTrigger aria-label={t('foundation.editor.link.slideLabel')} className="mona-link-select"><SelectValue placeholder={selectedOption?.label ?? slideId} /></SelectTrigger>
                  <SelectContent className="mona-link-select-popover">
                    {slideOptions.map(option => <SelectItem disabled={option.disabled} key={option.id} value={option.id}>{option.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {selectedSlide ? (
                <div className="mona-link-slide-preview">
                  <div>{t('foundation.editor.link.preview')}</div>
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
              ) : null}
            </TabsContent>
          </Tabs>
          <div className="mona-link-dialog-actions">
            <Button onClick={onCancel} size="editor" type="button" variant="outline">{t('foundation.editor.link.cancel')}</Button>
            <Button size="editor" type="submit">{t('foundation.editor.link.apply')}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export type EditorNoticeValue = { text: string; type: 'error' | 'success' | 'warning' }

function EditorNoticeItem({
  duration = 3000,
  notice,
  onClose,
}: {
  duration?: number
  notice: EditorNoticeValue
  onClose: () => void
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onCloseRef = useRef(onClose)
  const [leaving, setLeaving] = useState(false)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])
  const clearTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])
  const close = useCallback(() => {
    clearTimer()
    setLeaving(true)
    if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current)
    leaveTimerRef.current = setTimeout(() => onCloseRef.current(), 300)
  }, [clearTimer])
  const startTimer = useCallback(() => {
    clearTimer()
    if (duration > 0 && !leaving) timerRef.current = setTimeout(close, duration)
  }, [clearTimer, close, duration, leaving])
  useEffect(() => {
    startTimer()
    return clearTimer
  }, [clearTimer, startTimer])
  useEffect(() => () => {
    if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current)
  }, [])
  return (
    <div className={`mona-message${leaving ? ' is-leaving' : ''}`}>
      <div className="mona-message-container" onMouseEnter={clearTimer} onMouseLeave={startTimer}>
        <div aria-hidden="true" className={`mona-message-icon is-${notice.type}`}>
          {notice.type === 'success' ? <CheckOneIcon /> : notice.type === 'warning' ? <AttentionIcon /> : <CloseOneIcon />}
        </div>
        <div className="mona-message-content">
          <div className="mona-message-description">{notice.text}</div>
        </div>
      </div>
    </div>
  )
}

export function EditorNotice({ duration, notice, onClose }: { duration?: number; notice: EditorNoticeValue; onClose: () => void }) {
  return createPortal(<div className="mona-message-wrap"><EditorNoticeItem duration={duration} notice={notice} onClose={onClose} /></div>, document.body)
}

export function EditorNoticeStack({
  notices,
  onClose,
}: {
  notices: ReadonlyArray<EditorNoticeValue & { duration?: number; id: number }>
  onClose: (id: number) => void
}) {
  if (!notices.length) return null
  return createPortal((
    <div className="mona-message-wrap">
      {notices.map(notice => <EditorNoticeItem duration={notice.duration} key={notice.id} notice={notice} onClose={() => onClose(notice.id)} />)}
    </div>
  ), document.body)
}
