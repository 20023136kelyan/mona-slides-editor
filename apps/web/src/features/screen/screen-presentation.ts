import type { PresentationState, Slide, TurningMode } from '@mona/presentation-core'

const RANDOM_TURNING_MODES: TurningMode[] = ['slideX', 'slideY', 'slideX3D', 'slideY3D', 'fade', 'rotate', 'scaleY', 'scaleX', 'scale', 'scaleReverse']

export const resolveTurningModes = (slides: readonly Slide[]) => slides.map(slide => {
  let turningMode = slide.turningMode || 'slideY'
  if (turningMode === 'random') turningMode = RANDOM_TURNING_MODES[Math.floor(Math.random() * RANDOM_TURNING_MODES.length)]!
  return { ...slide, turningMode }
})

/**
 * Presenter projection keeps authoring state intact while omitting hidden
 * pages from every navigation path. If every page is hidden, the complete
 * deck remains presentable so the user is never dropped into an empty show.
 */
export const projectPresentationForScreen = (
  source: PresentationState,
): PresentationState => {
  const visibleSlides = source.slides.filter(slide => !slide.hidden)
  const slides = visibleSlides.length ? visibleSlides : source.slides
  const currentId = source.slides[source.slideIndex]?.id
  let slideIndex = slides.findIndex(slide => slide.id === currentId)
  if (slideIndex === -1) {
    const nextVisibleId = source.slides.slice(source.slideIndex).find(slide => !slide.hidden)?.id
      ?? [...source.slides.slice(0, source.slideIndex)].reverse().find(slide => !slide.hidden)?.id
    slideIndex = Math.max(0, slides.findIndex(slide => slide.id === nextVisibleId))
  }
  return { ...source, slides, slideIndex }
}

export const resolveSourceSlideIndex = (
  source: PresentationState,
  projected: PresentationState,
  projectedIndex: number,
): number => {
  const id = projected.slides[projectedIndex]?.id
  return source.slides.findIndex(slide => slide.id === id)
}
