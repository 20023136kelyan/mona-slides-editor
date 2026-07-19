import type { PPTAnimation, PPTElement, Slide } from './model'
import type { PresentationState } from './state'

export interface ElementLocation {
  slideId: string
  slideIndex: number
  elementIndex: number
  element: PPTElement
}

export interface FormattedAnimation {
  animations: PPTAnimation[]
  autoNext: boolean
}

export const selectCurrentSlide = (state: PresentationState): Slide => {
  const slide = state.slides[state.slideIndex]
  if (!slide) throw new Error(`Current slide index is invalid: ${state.slideIndex}`)
  return slide
}

export const selectSlideById = (
  state: Pick<PresentationState, 'slides'>,
  slideId: string,
): Slide | undefined => state.slides.find(slide => slide.id === slideId)

export const selectElementById = (
  state: Pick<PresentationState, 'slides'>,
  elementId: string,
  slideId?: string,
): PPTElement | undefined => {
  if (slideId) return selectSlideById(state, slideId)?.elements.find(element => element.id === elementId)

  for (const slide of state.slides) {
    const element = slide.elements.find(candidate => candidate.id === elementId)
    if (element) return element
  }
  return undefined
}

export const buildElementIndex = (
  state: Pick<PresentationState, 'slides'>,
): ReadonlyMap<string, ElementLocation> => {
  const index = new Map<string, ElementLocation>()
  state.slides.forEach((slide, slideIndex) => {
    slide.elements.forEach((element, elementIndex) => {
      index.set(element.id, { slideId: slide.id, slideIndex, elementIndex, element })
    })
  })
  return index
}

export const selectCurrentSlideAnimations = (state: PresentationState): PPTAnimation[] => {
  const currentSlide = selectCurrentSlide(state)
  if (!currentSlide.animations) return []

  const elementIds = new Set(currentSlide.elements.map(element => element.id))
  return currentSlide.animations.filter(animation => elementIds.has(animation.elId))
}

export const selectFormattedCurrentSlideAnimations = (
  state: PresentationState,
): FormattedAnimation[] => {
  const animations = selectCurrentSlideAnimations(state)
  const formatted: FormattedAnimation[] = []

  for (const animation of animations) {
    if (animation.trigger === 'click' || formatted.length === 0) {
      formatted.push({ animations: [animation], autoNext: false })
    }
    else if (animation.trigger === 'meantime') {
      const last = formatted[formatted.length - 1]
      if (!last) continue
      last.animations = last.animations.filter(item => item.elId !== animation.elId)
      last.animations.push(animation)
    }
    else {
      const last = formatted[formatted.length - 1]
      if (!last) continue
      last.autoNext = true
      formatted.push({ animations: [animation], autoNext: false })
    }
  }

  return formatted
}
