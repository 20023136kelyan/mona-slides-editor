import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { PointerPosition } from '@mona/editor-interactions'
import type { ElementLinkType } from '@mona/presentation-core/model'

interface ContextMenuItem {
  readonly action: string
  readonly checked?: boolean
  readonly children?: readonly ContextMenuItem[]
  readonly disabled?: boolean
  readonly dividerBefore?: boolean
  readonly label: string
  readonly shortcut?: string
}

export interface EditorContextMenuProps {
  canGroup: boolean
  canOrder: boolean
  canPaste: boolean
  gridLineSize: number
  grouped: boolean
  locked: boolean
  onAction: (action: string) => void
  position: PointerPosition
  showRuler: boolean
  surface: 'canvas' | 'element'
}

export function EditorContextMenu({
  canGroup,
  canOrder,
  canPaste,
  gridLineSize,
  grouped,
  locked,
  onAction,
  position,
  showRuler,
  surface,
}: EditorContextMenuProps) {
  const { t } = useTranslation()
  const canvasActions: ContextMenuItem[] = [
    { action: 'paste', label: t('foundation.editor.action.paste'), disabled: !canPaste, shortcut: 'Ctrl + V' },
    { action: 'select-all', label: t('foundation.editor.action.selectAll'), shortcut: 'Ctrl + A' },
    { action: 'ruler', label: t('foundation.editor.action.ruler'), checked: showRuler, dividerBefore: true },
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
    { action: 'reset-slide', label: t('foundation.editor.action.resetSlide'), dividerBefore: true },
  ]
  const elementActions: ContextMenuItem[] = locked ? [
    { action: 'unlock', label: t('foundation.editor.action.unlock') },
  ] : [
    { action: 'cut', label: t('foundation.editor.action.cut'), shortcut: 'Ctrl + X' },
    { action: 'copy', label: t('foundation.editor.action.copy'), shortcut: 'Ctrl + C' },
    { action: 'paste', label: t('foundation.editor.action.paste'), disabled: !canPaste, shortcut: 'Ctrl + V' },
    {
      action: 'align-horizontal',
      label: t('foundation.editor.action.alignHorizontal'),
      dividerBefore: true,
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
    {
      action: 'bring-front',
      label: t('foundation.editor.action.bringFront'),
      disabled: !canOrder,
      dividerBefore: true,
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
    { action: 'set-link', label: t('foundation.editor.action.setLink'), dividerBefore: true },
    ...(canGroup ? [{ action: grouped ? 'ungroup' : 'group', label: t(grouped ? 'foundation.editor.action.ungroup' : 'foundation.editor.action.group'), shortcut: 'Ctrl + G' }] : []),
    { action: 'select-all', label: t('foundation.editor.action.selectAll'), shortcut: 'Ctrl + A' },
    { action: 'lock', label: t('foundation.editor.action.lock'), shortcut: 'Ctrl + L' },
    { action: 'delete', label: t('foundation.editor.action.delete'), shortcut: 'Delete' },
  ]
  const actions = surface === 'canvas' ? canvasActions : elementActions
  const menuRef = useRef<HTMLDivElement>(null)
  const [adjustedPosition, setAdjustedPosition] = useState(position)

  useLayoutEffect(() => {
    const node = menuRef.current
    if (!node) return
    const bounds = node.getBoundingClientRect()
    setAdjustedPosition({
      x: Math.max(8, Math.min(position.x, window.innerWidth - bounds.width - 8)),
      y: Math.max(8, Math.min(position.y, window.innerHeight - bounds.height - 8)),
    })
  }, [actions.length, position.x, position.y])

  const submenuClassName = [
    'mona-editor-context-submenu',
    adjustedPosition.x > window.innerWidth / 2 ? 'opens-left' : '',
    adjustedPosition.y > window.innerHeight / 2 ? 'opens-up' : '',
  ].filter(Boolean).join(' ')
  const itemContent = (item: ContextMenuItem, hasChildren = false) => (
    <>
      <span className="mona-context-menu-label"><i>{item.checked ? '✓' : ''}</i>{item.label}</span>
      <span className="mona-context-menu-shortcut">{hasChildren ? '›' : item.shortcut}</span>
    </>
  )

  return (
    <div
      aria-label={t(surface === 'canvas' ? 'foundation.editor.canvasMenu' : 'foundation.editor.elementMenu')}
      className="mona-editor-context-menu"
      onPointerDown={event => event.stopPropagation()}
      ref={menuRef}
      role="menu"
      style={{ left: adjustedPosition.x, top: adjustedPosition.y }}
    >
      {actions.map(item => (
        <div className={`mona-context-menu-entry${item.dividerBefore ? ' has-divider' : ''}${item.children ? ' has-children' : ''}`} key={item.action} role="none">
          <button
            aria-haspopup={item.children ? 'menu' : undefined}
            disabled={item.disabled}
            onClick={() => onAction(item.action)}
            role="menuitem"
            type="button"
          >
            {itemContent(item, !!item.children)}
          </button>
          {item.children ? (
            <div aria-label={`${item.label} submenu`} className={submenuClassName} role="menu">
              {item.children.map(child => (
                <div className="mona-context-menu-entry" key={child.action} role="none">
                  <button disabled={item.disabled || child.disabled} onClick={() => onAction(child.action)} role="menuitem" type="button">
                    {itemContent(child)}
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}

export interface LinkSlideOption {
  readonly disabled: boolean
  readonly id: string
  readonly label: string
}

export function LinkEditor({ linkType, onCancel, onChange, onSubmit, onTypeChange, slideOptions, value }: {
  linkType: ElementLinkType
  onCancel: () => void
  onChange: (value: string) => void
  onSubmit: () => void
  onTypeChange: (type: ElementLinkType) => void
  slideOptions: readonly LinkSlideOption[]
  value: string
}) {
  const { t } = useTranslation()
  return (
    <div className="mona-link-dialog-backdrop" onPointerDown={event => event.stopPropagation()}>
      <dialog aria-label={t('foundation.editor.link.title')} className="mona-link-dialog" open>
        <form onSubmit={event => { event.preventDefault(); onSubmit() }}>
          <div aria-label={t('foundation.editor.link.typeLabel')} className="mona-link-type-tabs" role="tablist">
            <button aria-selected={linkType === 'web'} onClick={() => onTypeChange('web')} role="tab" type="button">
              {t('foundation.editor.link.web')}
            </button>
            <button aria-selected={linkType === 'slide'} disabled={!slideOptions.some(option => !option.disabled)} onClick={() => onTypeChange('slide')} role="tab" type="button">
              {t('foundation.editor.link.slide')}
            </button>
          </div>
          {linkType === 'web' ? (
            <label>
              <span>{t('foundation.editor.link.label')}</span>
              <input
                autoFocus
                onChange={event => onChange(event.target.value)}
                pattern="https?://.*"
                placeholder={t('foundation.editor.link.placeholder')}
                required
                type="url"
                value={value}
              />
            </label>
          ) : (
            <label>
              <span>{t('foundation.editor.link.slideLabel')}</span>
              <select autoFocus onChange={event => onChange(event.target.value)} required value={value}>
                {slideOptions.map(option => (
                  <option disabled={option.disabled} key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            </label>
          )}
          <div className="mona-link-dialog-actions">
            <button onClick={onCancel} type="button">{t('foundation.editor.link.cancel')}</button>
            <button disabled={!value.trim()} type="submit">{t('foundation.editor.link.apply')}</button>
          </div>
        </form>
      </dialog>
    </div>
  )
}
