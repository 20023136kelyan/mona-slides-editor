import type { PresentationState } from '@mona/presentation-core'

import { monaBridge } from '@/lib/mona-bridge'

const COVER_DEBOUNCE_MS = 1_200

interface PendingCover {
  presentation: PresentationState
  savedAt: number
  slideId: string
}

export interface LibraryCoverPersistence {
  flush: () => Promise<void>
  initialize: (presentation: PresentationState) => Promise<void>
  schedule: (presentation: PresentationState, savedAt: number) => void
  stop: () => void
}

const firstVisibleSlideId = (presentation: PresentationState): string | undefined => (
  presentation.slides.find(slide => !slide.hidden)?.id ?? presentation.slides[0]?.id
)

/**
 * Keeps the Home-library cover derived from the exact deck revision on disk.
 *
 * Autosave only schedules this work; capture runs later at background priority.
 * An explicit document flush waits for it so navigating Home immediately after
 * an edit still reveals the latest cover.
 */
export const createLibraryCoverPersistence = (
  documentId: string,
): LibraryCoverPersistence => {
  let pending: PendingCover | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false
  let rendering = Promise.resolve()
  let initialization = Promise.resolve()

  const capture = (): Promise<void> => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    const request = pending
    pending = null
    if (!request || stopped) return rendering
    rendering = rendering.then(async () => {
      if (stopped) return
      const { renderSlidePreview } = await import(
        '@/features/presentation-renderer/render-slide-preview'
      )
      const cover = await renderSlidePreview(request.presentation, request.slideId, {
        format: 'webp',
        maxWidth: 640,
        quality: 0.84,
      })
      if (!cover || stopped) return
      await monaBridge().documents.writePreview(
        documentId,
        await cover.arrayBuffer(),
        {
          expectedSavedAt: request.savedAt,
          mediaType: cover.type || 'image/webp',
          slideId: request.slideId,
        },
      )
    }).catch(error => {
      console.warn('Library cover generation failed.', error)
    })
    return rendering
  }

  const schedule = (presentation: PresentationState, savedAt: number) => {
    const slideId = firstVisibleSlideId(presentation)
    if (!slideId || stopped) return
    pending = { presentation, savedAt, slideId }
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { void capture() }, COVER_DEBOUNCE_MS)
  }

  return {
    flush: async () => {
      await initialization
      await capture()
      await rendering
    },
    initialize: async presentation => {
      initialization = monaBridge().documents.read(documentId).then(stored => {
        if (!stored || stopped) return
        schedule(presentation, stored.savedAt)
      })
      await initialization
    },
    schedule,
    stop: () => {
      stopped = true
      pending = null
      if (timer) clearTimeout(timer)
      timer = null
    },
  }
}
