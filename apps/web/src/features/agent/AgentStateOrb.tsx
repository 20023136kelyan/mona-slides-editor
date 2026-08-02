import { ThinkingOrb, type OrbState } from 'thinking-orbs'

import type { AgentActivity } from '@/features/agent/agent-activity'
import { cn } from '@/lib/utils'

const ORB_STATE: Record<AgentActivity, OrbState> = {
  editing: 'shaping',
  inspecting: 'working',
  looking: 'searching',
  reasoning: 'solving',
  searching: 'searching',
  waiting: 'working',
}

/** The common activity mark used by every agent transcript. */
export function AgentStateOrb({
  activity,
  className,
  size = 20,
}: {
  activity: AgentActivity
  className?: string
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
