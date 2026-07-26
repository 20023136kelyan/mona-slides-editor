import { useEffect, useRef } from 'react'

import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

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

export interface ScreenContextMenuItem {
  action?: string
  checked?: boolean
  children?: ScreenContextMenuItem[]
  disabled?: boolean
  divider?: boolean
  handler?: () => void
  icon?: LucideIcon
  label?: string
  shortcut?: string
}

// Matches the roomy Canva-style rows used by the editor context menus.
const CONTEXT_ROW_CLASS = 'gap-2.5 py-1.5'

function renderScreenItems(items: ScreenContextMenuItem[], activate: (item: ScreenContextMenuItem) => void): ReactNode {
  return items.map((item, index) => {
    if (item.divider) return <DropdownMenuSeparator key={`divider-${index}`} />
    const Icon = item.icon
    if (item.children?.length) {
      return (
        <DropdownMenuSub key={item.action || item.label}>
          <DropdownMenuSubTrigger className={CONTEXT_ROW_CLASS} disabled={item.disabled}>{Icon ? <Icon className="size-5" /> : null}{item.label}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>{renderScreenItems(item.children, activate)}</DropdownMenuSubContent>
        </DropdownMenuSub>
      )
    }
    if (item.checked !== undefined) {
      return (
        <DropdownMenuCheckboxItem checked={item.checked} className={CONTEXT_ROW_CLASS} disabled={item.disabled} key={item.action || item.label} onSelect={() => activate(item)}>{Icon ? <Icon className="size-5" /> : null}{item.label}</DropdownMenuCheckboxItem>
      )
    }
    return (
      <DropdownMenuItem className={CONTEXT_ROW_CLASS} disabled={item.disabled} key={item.action || item.label} onSelect={() => activate(item)}>
        {Icon ? <Icon className="size-5" /> : null}
        {item.label}
        {item.shortcut ? <DropdownMenuShortcut>{item.shortcut}</DropdownMenuShortcut> : null}
      </DropdownMenuItem>
    )
  })
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
  const contentRef = useRef<HTMLDivElement>(null)
  // After Radix has taken focus itself, not before: a ref callback runs too
  // early and its focus is the one that gets overridden.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      contentRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([data-disabled])')?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [])
  const activate = (item: ScreenContextMenuItem) => {
    if (item.disabled || (item.children && !item.handler)) return
    item.handler?.()
    onDismiss()
  }
  return (
    <DropdownMenu onOpenChange={open => {
      if (!open) onDismiss()
    }} open>
      <DropdownMenuTrigger asChild>
        <span aria-hidden="true" className="pointer-events-none fixed" style={{ left: position.x, top: position.y }} />
      </DropdownMenuTrigger>
      {/* Focus the first item the way a keyboard-opened menu should.
          Radix moves focus to the content and highlights the first item only
          when it opened the menu itself, from its own trigger. This one is
          opened by state — Shift+F10 or the ContextMenu key on the slideshow
          canvas — so nothing tells Radix a keyboard asked for it, and focus
          stopped on the container. That cost a keystroke: the first arrow press
          went to the first item instead of past it. */}
      <DropdownMenuContent
        align="start"
        className="w-auto min-w-52"
        onContextMenu={event => event.preventDefault()}
        ref={contentRef}
        side="bottom"
        sideOffset={0}
      >
        {renderScreenItems(items, activate)}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
