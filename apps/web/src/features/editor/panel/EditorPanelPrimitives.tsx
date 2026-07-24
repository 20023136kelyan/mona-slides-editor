/**
 * Shared building blocks for the drawer task panels (Uploads, Photos, Charts,
 * Templates, …). Extracted verbatim from the panel implementations so every
 * panel uses one construction path per concept: chrome, search field, back
 * header, section header, empty/loading/error states and the masonry grid.
 */
import { Fragment, useMemo, type ComponentType, type ReactNode, type UIEventHandler } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, Search } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/** Root column of a task panel: hosts a fixed header region and a scrollable body. */
export function PanelChrome({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex min-h-0 flex-1 flex-col', className)}>{children}</div>
}

/** Fixed (non-scrolling) controls region at the top of a panel. */
export function PanelHeader({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex shrink-0 flex-col gap-2.5 px-3 pt-3 pb-2', className)}>{children}</div>
}

/** Content region below the header; callers add overflow classes as needed. */
export function PanelBody({
  children,
  className,
  onScroll,
}: {
  children: ReactNode
  className?: string
  onScroll?: UIEventHandler<HTMLDivElement>
}) {
  return (
    <div className={cn('min-h-0 flex-1 px-3 pb-3', className)} onScroll={onScroll}>
      {children}
    </div>
  )
}

/** Search shell: leading icon, borderless input, optional trailing icon-buttons. */
export function PanelSearchField({
  actions,
  label,
  onChange,
  onSubmit,
  placeholder,
  value,
}: {
  actions?: ReactNode
  label: string
  onChange: (value: string) => void
  onSubmit?: () => void
  placeholder: string
  value: string
}) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-0.5 rounded-[var(--radius-action)] border border-input bg-background pl-2.5 pr-1">
      <Search className="size-3.5 shrink-0 text-muted-foreground" />
      <Input
        aria-label={label}
        className="h-8 min-w-0 flex-1 rounded-[var(--radius-action)] border-0 bg-transparent px-1.5 shadow-none focus-visible:ring-0 [&::-webkit-search-cancel-button]:hidden"
        onChange={event => onChange(event.target.value)}
        onKeyDown={onSubmit
          ? event => {
              if (event.key === 'Enter') onSubmit()
            }
          : undefined}
        placeholder={placeholder}
        type="search"
        value={value}
      />
      {actions}
    </div>
  )
}

/** ChevronLeft + truncated title row used by panel detail subviews. */
export function PanelBackHeader({
  className,
  label,
  onBack,
  title,
}: {
  className?: string
  label: string
  onBack: () => void
  title: string
}) {
  return (
    <div className={cn('flex shrink-0 items-center gap-1 px-3 pt-3 pb-2', className)}>
      <Button aria-label={label} onClick={onBack} size="icon-xs" type="button" variant="ghost">
        <ChevronLeft className="size-4" />
      </Button>
      <h3 className="truncate text-sm font-semibold">{title}</h3>
    </div>
  )
}

/** Section title with an optional "See all" affordance. */
export function PanelSectionHeader({ onSeeAll, title }: { onSeeAll?: () => void; title: string }) {
  const { t } = useTranslation()
  return (
    <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {onSeeAll ? (
        <Button
          className="h-auto px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground"
          onClick={onSeeAll}
          size="sm"
          type="button"
          variant="ghost"
        >
          {t('foundation.editor.panel.seeAll')}
        </Button>
      ) : null}
    </div>
  )
}

/** Centered icon + message, with an optional action (e.g. retry). */
export function PanelEmptyState({
  action,
  icon: Icon,
  message,
}: {
  action?: ReactNode
  icon?: ComponentType<{ className?: string }>
  message: string
}) {
  return (
    <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 px-4 text-center text-xs text-muted-foreground">
      {Icon ? <Icon className="size-6 opacity-60" /> : null}
      <p>{message}</p>
      {action}
    </div>
  )
}

/** Inline "loading…" row appended below panel content. */
export function PanelLoadingRow({ label }: { label: string }) {
  return (
    <output className="block py-3 text-center text-xs text-muted-foreground">
      {label}
    </output>
  )
}

/** Inline error row with an optional retry button. */
export function PanelErrorRow({
  message,
  onRetry,
  retryLabel,
}: {
  message: string
  onRetry?: () => void
  retryLabel?: string
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-4 text-xs text-muted-foreground" role="alert">
      <span>{message}</span>
      {onRetry && retryLabel ? (
        <Button onClick={onRetry} size="sm" type="button" variant="outline">
          {retryLabel}
        </Button>
      ) : null}
    </div>
  )
}

/**
 * Balanced two-column masonry without virtualisation: items are assigned to
 * the currently shorter column by estimated aspect ratio. Drawer-safe — no
 * ResizeObserver churn, unlike the previous Virtuoso-based grid.
 */
export function PanelMasonry<T>({
  className,
  estimateRatio,
  getKey,
  items,
  renderItem,
}: {
  className?: string
  /** Estimated height/width ratio used only for column balancing. */
  estimateRatio: (item: T) => number
  getKey: (item: T) => string
  items: readonly T[]
  renderItem: (item: T) => ReactNode
}) {
  const columns = useMemo(() => {
    const left: T[] = []
    const right: T[] = []
    let leftHeight = 0
    let rightHeight = 0
    for (const item of items) {
      if (leftHeight <= rightHeight) {
        left.push(item)
        leftHeight += estimateRatio(item)
      }
      else {
        right.push(item)
        rightHeight += estimateRatio(item)
      }
    }
    return [left, right]
  }, [estimateRatio, items])

  return (
    <div className={cn('grid w-full grid-cols-2 gap-2', className)}>
      {columns.map((column, columnIndex) => (
        <div className="flex min-w-0 flex-col gap-2" key={columnIndex}>
          {column.map(item => (
            <Fragment key={getKey(item)}>{renderItem(item)}</Fragment>
          ))}
        </div>
      ))}
    </div>
  )
}
