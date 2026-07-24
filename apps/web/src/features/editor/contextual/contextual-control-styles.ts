/**
 * Tailwind class recipes for the contextual toolbar pill controls.
 *
 * These replace the hand-rolled `.mona-contextual-controls .mona-contextual-control`
 * descendant rules from `editor.css`. They are layered on top of the shadcn
 * Button/Toggle/Select variants and rely on `cn` (tailwind-merge, applied inside
 * those components) to override the variant defaults — e.g. `h-[30px]` drops the
 * variant's `h-8`, `size-[30px]` drops `size-8`/`min-w-8`, `[font-family:Arial]`
 * survives against `font-normal` (plain `font-[Arial]` is misread as a weight and
 * dropped), and `text-base` overrides the size's `text-[13px]`.
 *
 * Colors intentionally keep literals where no token matches (`#41464b` is between
 * `--foreground` and `--muted-foreground`); selection colors stay arbitrary
 * (`var(--editor-selection*)`) as there is no token alias.
 */

// Chrome shared by every pill control (dimensions/typography added per variant).
const controlChrome
  = 'shrink-0 rounded-[var(--radius-control)] border-0 bg-transparent px-[5px]'
  + ' text-[#41464b] font-normal tracking-normal whitespace-nowrap cursor-pointer'
  + ' hover:bg-muted'

/** Labeled control (icon + text). `[&>span]` mirrors `.is-labeled > span`. */
export const contextualControlLabeled
  = `${controlChrome} h-[30px] min-w-[30px] [font-family:Arial] text-base`
  + ' [&>span]:ml-[5px] [&>span]:text-xs'

/** Labeled control whose panel edits a border — reverts the Arial override. */
export const contextualControlLabeledBorder
  = `${controlChrome} h-[30px] min-w-[30px] [font-family:inherit] text-base`
  + ' [&>span]:ml-[5px] [&>span]:text-xs'

/** Icon-only control. `size-[30px]` collapses shadcn `size-8`/`h-8`/`min-w-8`. */
export const contextualControlIcon = `${controlChrome} size-[30px] min-w-[30px]`

/** Text-color swatch button — stacks the glyph over the color bar. */
export const contextualControlTextColor
  = `${controlChrome} h-[30px] min-w-[30px] flex-col text-[13px]`

/**
 * Toggle active state (Radix drives both `data-[state=on]` and `aria-pressed`).
 * Overrides the toggle variant's `bg-muted` pressed wash with the selection tint.
 */
export const contextualToggleActive
  = 'data-[state=on]:bg-[var(--editor-selection-soft)] data-[state=on]:text-[var(--editor-selection)]'
  + ' aria-pressed:bg-[var(--editor-selection-soft)] aria-pressed:text-[var(--editor-selection)]'

/** Toggles that never signal their pressed state — neutralize the muted wash. */
export const contextualToggleFlat
  = 'data-[state=on]:bg-transparent aria-pressed:bg-transparent'

/**
 * Ghost select trigger inside the pill (font/size/marker pickers). Strips the
 * outline/select chrome and adopts the shared hover/open wash. `data-[size=default]`
 * and `aria-expanded` cover both the Popover-button and Radix Select trigger paths.
 */
export const contextualGhostSelect
  = 'h-[30px] data-[size=default]:h-[30px] border-transparent bg-transparent shadow-none'
  + ' hover:bg-black/[0.06] data-[state=open]:bg-black/[0.08] aria-expanded:bg-black/[0.08]'
