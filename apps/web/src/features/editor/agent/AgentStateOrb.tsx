import { ThinkingOrb, type OrbState } from 'thinking-orbs'

import { cn } from '@/lib/utils'

/**
 * What the agent is doing, in the terms the dock cares about.
 *
 * Kept separate from the orb's own state names so the mapping lives in one
 * place: the package is at 0.1.x, and if its API moves this file is the only
 * thing that has to follow.
 */
export type AgentActivity =
  | 'editing'
  | 'inspecting'
  | 'looking'
  | 'reasoning'
  | 'searching'
  | 'waiting'

/**
 * Each animation is chosen for what it depicts, not decoration:
 * `searching` sweeps a scan meridian, which is what looking at a slide is;
 * `shaping` morphs an outline between shapes, which is what editing does;
 * `solving` scrambles and clicks back, which reads as thinking.
 */
const ORB_STATE: Record<AgentActivity, OrbState> = {
  editing: 'shaping',
  inspecting: 'working',
  looking: 'searching',
  reasoning: 'solving',
  searching: 'searching',
  waiting: 'working',
}

/** Which activity a tool call represents. */
export const activityForTool = (toolName: string): AgentActivity => {
  if (toolName === 'edit') return 'editing'
  if (toolName === 'look') return 'looking'
  if (toolName === 'inspect') return 'inspecting'
  if (toolName === 'search_images' || toolName === 'web_search') return 'searching'
  return 'waiting'
}

/**
 * The 20px preset is a distinct design rather than a scaled 64, so it is the
 * only one that belongs inline next to a line of text. The package renders a
 * static frame under `prefers-reduced-motion` on its own.
 *
 * The theme is pinned to `light`, which draws dark ink for a light background.
 * `auto` would be wrong today: it looks for a `dark` ancestor class and, finding
 * none, falls back to `prefers-color-scheme` - so anyone whose system is dark
 * would get pale ink on our light chrome and see almost nothing. The editor
 * defines a `.dark` palette but never applies it, so there is no dark mode to
 * detect yet. Switch this back to `auto` when one ships; the package watches for
 * exactly that class.
 *
 * Always decorative. The orb ships `role="img"` with a per-state label, but in
 * every place we use it the adjacent text already names the activity - so
 * leaving it exposed would announce the state twice and, inside a button, fold
 * the orb's wording into that button's accessible name.
 */
export function AgentStateOrb({
  activity,
  className,
  size = 20,
}: {
  activity: AgentActivity
  className?: string
  /**
   * 20 sits inline beside a line of text; 64 is the standalone scale, with a
   * higher dot count. They are separate designs rather than one scaled, so pick
   * the one that matches the context instead of resizing the other.
   */
  size?: 20 | 64
}) {
  return (
    <ThinkingOrb
      aria-hidden="true"
      className={cn('shrink-0', className)}
      size={size}
      state={ORB_STATE[activity]}
      theme="light"
    />
  )
}
