/**
 * Shared content-surface chrome, derived from the editor's canonical top row.
 *
 * Application routes can arrange different controls inside the row, but its
 * geometry and visual relationship to the workspace remain constant: 44px,
 * transparent, compact, and never separated from its column by a rule.
 */
export const applicationSurfaceBarClass = 'mona-application-surface-bar relative grid h-11 flex-none grid-cols-[auto_minmax(0,1fr)_auto] items-center bg-transparent px-2.5 text-foreground leading-normal select-none'

/** The quiet editable title treatment used by editor and project surfaces. */
export const applicationSurfaceTitleInputClass = 'pointer-events-auto h-7 w-full max-w-[32rem] rounded-control border border-transparent bg-transparent px-2.5 text-center text-[13px]! font-normal text-foreground/80 text-ellipsis shadow-none hover:border-input hover:bg-background focus-visible:border-input focus-visible:bg-background focus-visible:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/20 md:text-[13px]! placeholder:font-normal placeholder:text-muted-foreground placeholder:opacity-100'

/** Compact raised face for non-Button controls that live in a surface bar. */
export const applicationSurfaceControlClass = 'h-7 rounded-action border-border bg-[color-mix(in_oklab,var(--foreground)_3%,var(--background))] text-xs font-medium text-foreground/80 shadow-[0_1px_2px_0_color-mix(in_oklab,var(--foreground)_12%,transparent)] hover:bg-[color-mix(in_oklab,var(--foreground)_6%,var(--background))] hover:text-foreground data-[state=open]:bg-[color-mix(in_oklab,var(--foreground)_10%,var(--background))] data-[state=open]:text-foreground data-[state=open]:shadow-none'
