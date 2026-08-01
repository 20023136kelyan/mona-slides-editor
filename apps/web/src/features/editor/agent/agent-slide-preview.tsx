import type { PresentationState } from '@mona/presentation-core'

import { renderSlidePreview } from '@/features/presentation-renderer/render-slide-preview'

export const renderAgentSlidePreview = async (
  presentation: PresentationState,
  slideId: string,
): Promise<Blob | undefined> => {
  return renderSlidePreview(presentation, slideId, {
    format: 'png',
    maxWidth: 1200,
  })
}
