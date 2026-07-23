import type { PPTAnimation, PPTElement, Slide } from './model'
import type { PresentationState } from './state'
import { collectElementTreeIds, findElementById, walkElementTree } from './elements'

export interface ElementLocation {
  slideId: string
  slideIndex: number
  elementIndex: number
  elementPath: readonly number[]
  parentElementId?: string
  element: PPTElement
}

export interface FormattedAnimation {
  animations: PPTAnimation[]
  autoNext: boolean
}

export const selectCurrentSlide = (state: PresentationState): Slide => {
  // Keep the Vue getter's runtime behavior during initial empty-state loading.
  // Its historical static type was Slide even though the array lookup can yield
  // undefined before persistence finishes hydrating the store.
  return state.slides[state.slideIndex] as Slide
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
  if (slideId) {
    const slide = selectSlideById(state, slideId)
    return slide ? findElementById(slide.elements, elementId) : undefined
  }

  for (const slide of state.slides) {
    const element = findElementById(slide.elements, elementId)
    if (element) return element
  }
  return undefined
}

export const buildElementIndex = (
  state: Pick<PresentationState, 'slides'>,
): ReadonlyMap<string, ElementLocation> => {
  const index = new Map<string, ElementLocation>()
  state.slides.forEach((slide, slideIndex) => {
    walkElementTree(slide.elements, ({ element, parent, path }) => {
      index.set(element.id, {
        element,
        elementIndex: path[0]!,
        elementPath: path,
        parentElementId: parent?.id,
        slideId: slide.id,
        slideIndex,
      })
    })
  })
  return index
}

export const selectCurrentSlideAnimations = (state: PresentationState): PPTAnimation[] => {
  const currentSlide = selectCurrentSlide(state)
  if (!currentSlide?.animations) return []

  const elementIds = new Set(collectElementTreeIds(currentSlide.elements))
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
    else if (animation.trigger === 'auto') {
      const last = formatted[formatted.length - 1]
      if (!last) continue
      last.autoNext = true
      formatted.push({ animations: [animation], autoNext: false })
    }
  }

  return formatted
}
