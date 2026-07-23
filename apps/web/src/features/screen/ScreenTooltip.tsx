import type { ReactElement } from 'react'

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

export function ScreenTooltip({
  children,
  content,
}: {
  children: ReactElement<Record<string, unknown>>
  content: string
}) {
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side="top" sideOffset={8}>{content}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
