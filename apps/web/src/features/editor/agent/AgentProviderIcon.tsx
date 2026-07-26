import type { ComponentType, SVGProps } from 'react'
import ClaudeIcon from '~icons/simple-icons/claude'
import GeminiIcon from '~icons/simple-icons/googlegemini'
import OpenAiIcon from '~icons/logos/openai-icon'

import type { AgentProviderId } from '@/features/editor/agent/agent-types'
import { cn } from '@/lib/utils'

/**
 * Provider marks for the model picker.
 *
 * Loaded through `unplugin-icons`, the way the rest of the editor takes icons,
 * so the paths stay maintained upstream rather than pasted in here. OpenAI comes
 * from the `logos` collection because `simple-icons` does not carry it - it
 * ships only "OpenAI Gym", a different product.
 *
 * Brand colour is applied by us rather than taken from the icon, because
 * `simple-icons` marks are monochrome and inherit `currentColor`. `logos` marks
 * carry their own fills, so OpenAI is left alone.
 */
const BRAND: Partial<Record<AgentProviderId, {
  Icon: ComponentType<SVGProps<SVGSVGElement>>
  /** Omitted where the mark supplies its own colours. */
  colour?: string
}>> = {
  'anthropic-claude': { Icon: ClaudeIcon, colour: '#D97757' },
  'google-ai-studio': { Icon: GeminiIcon, colour: '#8E75B2' },
  'openai-chatgpt': { Icon: OpenAiIcon },
}

export function AgentProviderIcon({
  className,
  providerId,
}: {
  className?: string
  providerId: AgentProviderId
}) {
  const brand = BRAND[providerId]
  if (!brand) return null
  const { Icon } = brand
  return (
    <Icon
      aria-hidden="true"
      className={cn('shrink-0', className)}
      {...(brand.colour ? { style: { color: brand.colour } } : {})}
    />
  )
}
