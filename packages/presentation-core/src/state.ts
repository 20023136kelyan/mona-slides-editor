import type { Slide, SlideTemplate, SlideTheme } from './model'

/**
 * Exact persisted/session shape currently owned by the Vue slides store.
 * This remains the canonical serializable presentation state shape.
 */
export interface PresentationState {
  title: string
  theme: SlideTheme
  slides: Slide[]
  slideIndex: number
  viewportSize: number
  viewportRatio: number
  templates: SlideTemplate[]
}

export const cloneSerializable = <Value>(value: Value): Value => {
  return JSON.parse(JSON.stringify(value)) as Value
}
