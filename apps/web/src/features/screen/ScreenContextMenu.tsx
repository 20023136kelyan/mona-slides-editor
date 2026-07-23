/* oxlint-disable jsx-a11y/no-static-element-interactions -- the full-viewport dismissal mask is pointer-only; all menu commands are keyboard controls. */
import { useEffect, useRef, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'

export interface ScreenContextMenuItem {
  action?: string
  children?: ScreenContextMenuItem[]
  disabled?: boolean
  divider?: boolean
  handler?: () => void
  label?: string
  shortcut?: string
}

export function ScreenContextMenu({
  items,
  onDismiss,
  position,
}: {
  items: ScreenContextMenuItem[]
  onDismiss: () => void
  position: { x: number; y: number }
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const menuHeight = items.filter(item => !item.divider).length * 30 + items.filter(item => item.divider).length * 11 + 10
  const style = {
    left: document.body.clientWidth <= position.x + 180 ? position.x - 180 : position.x,
    top: document.body.clientHeight <= position.y + menuHeight ? position.y - menuHeight : position.y,
  }
  const activate = (item: ScreenContextMenuItem) => {
    if (item.disabled || (item.children && !item.handler)) return
    item.handler?.()
    onDismiss()
  }
  useEffect(() => {
    const frame = requestAnimationFrame(() => (
      menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus()
    ))
    return () => cancelAnimationFrame(frame)
  }, [])
  const moveFocus = (event: KeyboardEvent<HTMLElement>, item: ScreenContextMenuItem) => {
    const current = event.currentTarget
    const menu = current.parentElement
    const items = Array.from(menu?.querySelectorAll<HTMLElement>(':scope > [role="menuitem"]:not([aria-disabled="true"])') ?? [])
    const index = items.indexOf(current)
    event.stopPropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      onDismiss()
    }
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      activate(item)
    }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const direction = event.key === 'ArrowDown' ? 1 : -1
      items[(index + direction + items.length) % items.length]?.focus()
    }
    else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      items[event.key === 'Home' ? 0 : items.length - 1]?.focus()
    }
    else if (event.key === 'ArrowRight' && item.children?.length) {
      event.preventDefault()
      current.querySelector<HTMLElement>('[role="menu"] [role="menuitem"]:not([aria-disabled="true"])')?.focus()
    }
    else if (event.key === 'ArrowLeft' && menu?.classList.contains('mona-screen-context-submenu')) {
      event.preventDefault()
      menu.closest<HTMLElement>('[role="menuitem"]')?.focus()
    }
  }
  const render = (menuItems: ScreenContextMenuItem[], submenu = false) => (
    <ul className={`mona-context-menu-content${submenu ? ' mona-screen-context-submenu' : ''}`} role="menu">
      {menuItems.map((item, index) => item.divider ? (
        <li aria-hidden="true" className="mona-context-menu-entry is-divider" key={`divider-${index}`}><hr /></li>
      ) : (
        <li
          aria-disabled={item.disabled || undefined}
          aria-haspopup={item.children?.length ? 'menu' : undefined}
          className={`mona-context-menu-entry${item.disabled ? ' is-disabled' : ''}`}
          data-action={item.action}
          key={item.action || item.label}
          onClick={event => {
          event.stopPropagation(); activate(item) 
          }}
          onKeyDown={event => moveFocus(event, item)}
          role="menuitem"
          tabIndex={submenu || index > 0 || item.disabled ? -1 : 0}
        >
          <div className={`mona-context-menu-item-content${item.children ? ' has-children' : ''}${item.handler && item.children ? ' has-handler' : ''}`}>
            <span className="mona-context-menu-label">{item.label}</span>
            {item.shortcut && !item.children ? <span className="mona-context-menu-shortcut">{item.shortcut}</span> : null}
            {item.children?.length ? render(item.children, true) : null}
          </div>
        </li>
      ))}
    </ul>
  )
  return createPortal((
    <>
      <div className="mona-editor-context-menu-mask" onContextMenu={event => {
        event.preventDefault(); onDismiss() 
      }} onMouseDown={event => {
        if (event.button === 0) onDismiss() 
      }} />
      <div className="mona-editor-context-menu mona-screen-context-menu" onContextMenu={event => event.preventDefault()} ref={menuRef} style={style}>{render(items)}</div>
    </>
  ), document.body)
}
