/**
 * Shared building blocks for the drawer task panels (Uploads, Photos, Charts,
 * Templates, …). Extracted verbatim from the panel implementations so every
 * panel uses one construction path per concept: chrome, search field, back
 * header, section header, empty/loading/error states and the masonry grid.
 */
import { Fragment, type ComponentType, type ReactNode, type UIEventHandler, useMemo, useRef } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { ChevronLeft, Search, SearchX, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useOptionalEditorPanel } from '@/features/editor/panel/editor-panel-context'
import { useEditorPanelSearch } from '@/features/editor/panel/editor-panel-search'
import { useEdgeFade } from '@/features/editor/use-edge-fade'
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
  const scrollRef = useRef<HTMLDivElement>(null)
  // The panel header stays pinned above this, so the seam between them is the
  // clipped edge of this scroller. Fade it instead of ruling a border under the
  // header: the fade only appears when content is actually cut off.
  // No refresh key: `children` changes identity every render and would thrash
  // the listeners. The hook's own resize/mutation observers track content.
  useEdgeFade(scrollRef, 'y')
  // Scrolling is the primitive's job, not the caller's: when it was opt-in,
  // panels disagreed about it and the ones that forgot silently clipped their
  // overflow instead of scrolling it.
  return (
    <div className={cn('mona-panel-body min-h-0 flex-1 overflow-y-auto px-3 pb-3', className)} onScroll={onScroll} ref={scrollRef}>
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
    <div className="flex h-9 shrink-0 items-center gap-0.5 rounded-action border border-input bg-background pl-2.5 pr-1">
      <Search className="size-3.5 shrink-0 text-muted-foreground" />
      <Input
        aria-label={label}
        className="h-8 min-w-0 flex-1 rounded-action border-0 bg-transparent px-1.5 shadow-none focus-visible:ring-0 [&::-webkit-search-cancel-button]:hidden"
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

/**
 * The drawer search bar: one per category, always in the same place.
 *
 * The drawer renders this above whatever panel is active rather than each panel
 * rendering its own, so presence and placement are structural. Panels read the
 * value through useEditorPanelSearch() and contribute their own secondary
 * controls (chips, tabs) in a PanelHeader below it.
 */
export function PanelSearchBar({ label, placeholder }: { label: string; placeholder: string }) {
  const { t } = useTranslation()
  // `label` names the field for assistive tech and is category-specific
  // ("Describe your ideal design"); the go button needs the plain verb instead.
  const searchLabel = t('foundation.editor.panel.search')
  const search = useEditorPanelSearch()
  return (
    <div className="mona-panel-search-bar shrink-0 px-3 pt-3 pb-2">
      <PanelSearchField
        actions={(
          <>
            {search.query ? (
              <Button
                aria-label={t('foundation.editor.panel.clearSearch')}
                className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
                onClick={search.clear}
                size="icon-xs"
                title={t('foundation.editor.panel.clearSearch')}
                type="button"
                variant="ghost"
              >
                <X className="size-3.5" />
              </Button>
            ) : null}
            {/* Only `submit` panels need a go button; `filter` panels have
                already reacted by the time the user could press it. */}
            {search.mode === 'submit' ? (
              <Button
                aria-label={searchLabel}
                className="size-7 shrink-0"
                onClick={search.submit}
                size="icon-xs"
                title={searchLabel}
                type="button"
                variant="ghost"
              >
                <Search className="size-3.5" />
              </Button>
            ) : null}
          </>
        )}
        label={label}
        onChange={search.setQuery}
        onSubmit={search.mode === 'submit' ? search.submit : undefined}
        placeholder={placeholder}
        value={search.query}
      />
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

/**
 * The drawer's empty space: this category has nothing to show yet.
 *
 * The icon is the category's own — the drawer supplies it from the registry, so
 * an empty Videos panel reads as *Videos, empty* rather than as a generic void.
 * Distinct from PanelNoResults, which reports a search that matched nothing;
 * conflating them tells the user their library is empty when in fact their
 * query was just too narrow.
 */
export function PanelEmptyState({
  action,
  hint,
  icon,
  message,
}: {
  action?: ReactNode
  /** Optional second line: what the user can do to fill this space. */
  hint?: string
  icon?: ComponentType<{ className?: string }>
  message: string
}) {
  // Omitting the icon is the common case: the drawer already knows which
  // category is open, so the empty space picks up that category's mark.
  // Read unconditionally — behind `??` the hook would only run when no icon
  // was passed, which changes the hook order between renders.
  const panel = useOptionalEditorPanel()
  const Icon = icon ?? panel?.categoryIcon
  return (
    <div className="mona-panel-empty flex h-full min-h-40 flex-col items-center justify-center gap-2 px-4 text-center text-xs text-muted-foreground">
      {Icon ? (
        <span className="mb-0.5 flex size-11 items-center justify-center rounded-full bg-foreground/[0.04]">
          <Icon className="size-5 opacity-55" />
        </span>
      ) : null}
      <p className="max-w-52 text-foreground/70">{message}</p>
      {hint ? <p className="max-w-52 text-[11px] leading-normal opacity-80">{hint}</p> : null}
      {action}
    </div>
  )
}

/**
 * The drawer's search-empty space: the query matched nothing here.
 *
 * Echoes the term so the user can see what was actually searched (trailing
 * whitespace and typos are the usual culprits), and offers the one useful way
 * out. Panels reach for this whenever a *search* came back empty; a category
 * that simply has no content uses PanelEmptyState.
 */
export function PanelNoResults({ onClear, query }: { onClear?: () => void; query: string }) {
  const { t } = useTranslation()
  const trimmed = query.trim()
  return (
    <div className="mona-panel-no-results flex h-full min-h-40 flex-col items-center justify-center gap-2 px-4 text-center text-xs text-muted-foreground">
      <span className="mb-0.5 flex size-11 items-center justify-center rounded-full bg-foreground/[0.04]">
        <SearchX className="size-5 opacity-55" />
      </span>
      <p className="max-w-52 text-foreground/70">
        {trimmed
          ? <Trans i18nKey="foundation.editor.panel.noResultsFor" values={{ query: trimmed }}>
              No results for <span className="font-semibold text-foreground">{{ query: trimmed } as never}</span>
            </Trans>
          : t('foundation.editor.panel.noResults')}
      </p>
      {onClear ? (
        <Button className="h-7 px-2 text-xs" onClick={onClear} size="sm" type="button" variant="outline">
          {t('foundation.editor.panel.clearSearch')}
        </Button>
      ) : null}
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
