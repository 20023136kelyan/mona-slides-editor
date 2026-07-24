/**
 * Tailwind class recipes for the contextual toolbar pill.
 *
 * Control atoms (buttons/toggles/selects) and the surrounding shell/dividers
 * live here so `editor.css` only keeps stage geometry (absolute contextbar).
 * Recipes layer on shadcn Button/Toggle/Select via `cn` / tailwind-merge.
 *
 * Colors intentionally keep literals where no token matches (`#41464b` is between
 * `--foreground` and `--muted-foreground`); selection colors stay arbitrary
 * (`var(--editor-selection*)`) as there is no token alias.
 */

// Chrome shared by every pill control (dimensions/typography added per variant).
const controlChrome
  = 'shrink-0 rounded-control border-0 bg-transparent px-1.25'
  + ' text-foreground font-normal tracking-normal whitespace-nowrap cursor-pointer'
  + ' hover:bg-muted'

/** Labeled control (icon + text). `[&>span]` mirrors `.is-labeled > span`. */
export const contextualControlLabeled
  = `${controlChrome} h-7.5 min-w-7.5 [font-family:Arial] text-base`
  + ' [&>span]:ml-1.25 [&>span]:text-xs'

/** Labeled control whose panel edits a border — reverts the Arial override. */
export const contextualControlLabeledBorder
  = `${controlChrome} h-7.5 min-w-7.5 [font-family:inherit] text-base`
  + ' [&>span]:ml-1.25 [&>span]:text-xs'

/** Icon-only control. `size-7.5` collapses shadcn `size-8`/`h-8`/`min-w-8`. */
export const contextualControlIcon = `${controlChrome} size-7.5 min-w-7.5`

/** Text-color swatch button — stacks the glyph over the color bar. */
export const contextualControlTextColor
  = `${controlChrome} h-7.5 min-w-7.5 flex-col text-control`

/**
 * Toggle active state (Radix drives both `data-[state=on]` and `aria-pressed`).
 * Overrides the toggle variant's `bg-muted` pressed wash with the selection tint.
 */
export const contextualToggleActive
  = 'data-[state=on]:bg-editor-selection-soft data-[state=on]:text-editor-selection'
  + ' aria-pressed:bg-editor-selection-soft aria-pressed:text-editor-selection'

/** Toggles that never signal their pressed state — neutralize the muted wash. */
export const contextualToggleFlat
  = 'data-[state=on]:bg-transparent aria-pressed:bg-transparent'

/**
 * Ghost select trigger inside the pill (font/size/marker pickers). Strips the
 * outline/select chrome and adopts the shared hover/open wash. `data-[size=default]`
 * and `aria-expanded` cover both the Popover-button and Radix Select trigger paths.
 */
export const contextualGhostSelect
  = 'h-7.5 data-[size=default]:h-7.5 border-transparent bg-transparent shadow-none'
  + ' hover:bg-black/[0.06] data-[state=open]:bg-black/[0.08] aria-expanded:bg-black/[0.08]'

/** Outer flex shell for a selection's control cluster (hook class stays for tests). */
export const contextualControlsShell
  = 'static flex h-8.5 w-max flex-none items-center border-0 bg-transparent p-0'
  + ' text-foreground leading-normal shadow-none'

/** Horizontal row that hosts the controls. */
export const contextualControlRow = 'inline-flex w-max items-center gap-1 whitespace-nowrap'

/** Deep-action cluster after the primary controls. */
export const contextualDeepActions
  = 'ml-1.5 flex flex-none items-center gap-0.5 border-l border-border pl-1.5'
  + ' first:ml-0 first:border-l-0 first:pl-0'

/** Kind glyph (audio/video) at the start of a media row. */
export const contextualKindIcon
  = 'inline-flex h-7.5 w-7 flex-none items-center justify-center gap-1.5'
  + ' text-ink/70 [&_svg]:size-4'

/** Multi-selection count label. */
export const contextualSelectionLabel
  = 'inline-flex h-7.5 flex-none items-center gap-1.5 border-r border-border'
  + ' px-2.5 pl-1.5 text-xs font-semibold text-ink/70 [&_svg]:size-4'

/** "Group child" badge ahead of nested controls. */
export const contextualChildBadge
  = 'mr-1 inline-flex h-6 flex-none items-center rounded-pill'
  + ' bg-muted px-2 text-mini font-semibold whitespace-nowrap text-muted-foreground'

/** Vertical hairline between control clusters. */
export const contextualDivider = 'mx-1 h-4.5 w-px shrink-0 bg-border'

/** Transparency slider popover body. */
export const contextualTransparencyPopover
  = 'flex w-55 flex-col gap-2.5 p-1.5 text-xs text-foreground'

/** Border style/color/width popover body. */
export const contextualBorderPanel = 'w-54.5 select-none'

/** Line dash/solid style picker list. */
export const contextualLineStyleList = 'flex w-24.5 flex-col gap-1'

/** One entry in the line-style list. */
export const contextualLineStyleItem
  = 'h-8 rounded-control border-0 bg-transparent px-2.5 text-foreground'
  + ' hover:bg-editor-selection-subtle'

export const contextualLineStyleItemActive = 'text-editor-selection'

/** Compact width slider beside line style/color. */
export const contextualLineWidth = 'w-30 shrink-0 px-2'

const textColorChecker
  = 'bg-[url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAAXNSR0IArs4c6QAAACdJREFUGFdjfPbs2X8GBgYGSUlJEMXAiCHw//9/sIrnz59DVKALAADNxxVfaiODNQAAAABJRU5ErkJggg==)]'

/** Under-glyph color bar for the text-color control. */
export const contextualTextColorBar
  = `mt-px block h-1 w-3.75 ${textColorChecker} [&>span]:block [&>span]:size-full`

/** White swatch needs a hairline so it stays visible on the pill. */
export const contextualTextColorBarWhite = 'h-1.25 border border-solid border-[#ddd]'

/** Compact command list used by table add/delete menus (also style panel). */
export const tableCommandMenu
  = 'flex w-25 flex-col [&_button]:h-7.5 [&_button]:w-full [&_button]:rounded-control'
  + ' [&_button]:border-0 [&_button]:bg-transparent [&_button]:px-2.5 [&_button]:text-center'
  + ' [&_button]:text-control [&_button]:text-foreground [&_button]:hover:bg-muted'

/** Primary deep-action button in the trailing cluster. */
export const contextualAction
  = 'inline-flex h-8 items-center gap-1.5 rounded-action px-2.5'
  + ' text-control font-semibold whitespace-nowrap text-ink/70'
  + ' hover:bg-ink-deep/6 hover:text-ink-deep [&_svg]:size-4'
