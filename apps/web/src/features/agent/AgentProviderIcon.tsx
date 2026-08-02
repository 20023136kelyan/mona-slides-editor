import ClaudeIcon from '~icons/simple-icons/claude'
import OpenAIIcon from '~icons/simple-icons/openai'
import type { AgentProviderId } from '@mona/agent-protocol'

import { cn } from '@/lib/utils'

/**
 * The Claude mark, shared by Mona's model pickers.
 *
 * Loaded through `unplugin-icons`, the way the rest of the editor takes icons, so
 * the path stays maintained upstream rather than pasted in here. `simple-icons`
 * marks are monochrome and inherit `currentColor`, so the brand colour is applied
 * here rather than carried by the mark.
 *
 * This used to switch between three providers. Only one offers a subscription path
 * a third-party app can authenticate against, so there is nothing left to switch on.
 */
export function AgentProviderIcon({
  className,
  providerId = 'anthropic',
}: {
  className?: string
  providerId?: AgentProviderId
}) {
  if (providerId === 'openai') {
    return (
      <OpenAIIcon
        aria-hidden="true"
        className={cn('shrink-0 text-foreground', className)}
        data-agent-provider-icon
      />
    )
  }
  return (
    <ClaudeIcon
      aria-hidden="true"
      className={cn('shrink-0', className)}
      data-agent-provider-icon
      style={{ color: '#D97757' }}
    />
  )
}
