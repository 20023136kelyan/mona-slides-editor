/* oxlint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions, jsx-a11y/no-noninteractive-element-interactions -- exact PPTist context-menu DOM and hover submenus. */
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
  const render = (menuItems: ScreenContextMenuItem[], submenu = false) => (
    <ul className={`mona-context-menu-content${submenu ? ' mona-screen-context-submenu' : ''}`}>
      {menuItems.map((item, index) => item.divider ? (
        <li className="mona-context-menu-entry is-divider" key={`divider-${index}`} />
      ) : (
        <li className={`mona-context-menu-entry${item.disabled ? ' is-disabled' : ''}`} data-action={item.action} key={item.action || item.label} onClick={event => {
          event.stopPropagation(); activate(item) 
        }}>
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
      <div className="mona-editor-context-menu mona-screen-context-menu" onContextMenu={event => event.preventDefault()} style={style}>{render(items)}</div>
    </>
  ), document.body)
}
