import type { PPTElement, Slide, SlideTemplate, SlideTheme } from './model'
import type { PresentationState } from './state'
import { cloneSerializable } from './state'

export interface RemovePropertyPayload {
  id: string
  property: string | string[]
}

export interface UpdateElementPayload {
  id: string | string[]
  props: Partial<PPTElement>
  slideId?: string
}

export type PresentationCommand =
  | { type: 'presentation.title.set'; title: string; fallbackTitle: string }
  | { type: 'presentation.theme.update'; props: Partial<SlideTheme> }
  | { type: 'presentation.viewport-size.set'; size: number }
  | { type: 'presentation.viewport-ratio.set'; ratio: number }
  | { type: 'presentation.slides.replace'; slides: Slide[]; theme?: Partial<SlideTheme> }
  | { type: 'presentation.templates.replace'; templates: SlideTemplate[] }
  | { type: 'slide.add'; slides: Slide | Slide[] }
  | { type: 'slide.update'; props: Partial<Slide>; slideId?: string }
  | { type: 'slide.properties.remove'; payload: RemovePropertyPayload }
  | { type: 'slide.delete'; slideIds: string | string[] }
  | { type: 'slide.focus'; index: number }
  | { type: 'element.add'; elements: PPTElement | PPTElement[] }
  | { type: 'element.delete'; elementIds: string | string[] }
  | { type: 'element.update'; payload: UpdateElementPayload }
  | { type: 'element.properties.remove'; payload: RemovePropertyPayload }

export interface PresentationChange {
  commandType: PresentationCommand['type']
  changed: boolean
  affectedSlideIds: string[]
  affectedElementIds: string[]
}

export interface PresentationCommandResult {
  state: PresentationState
  change: PresentationChange
}

export class PresentationCommandError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PresentationCommandError'
  }
}

const omitProperties = <Value extends object>(value: Value, properties: string[]): Value => {
  const omitted = new Set(properties)
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !omitted.has(key)),
  ) as Value
}

const normalizePropertyList = (property: string | string[]): string[] => {
  return typeof property === 'string' ? [property] : property
}

const findSlideIndex = (state: PresentationState, slideId?: string): number => {
  const index = slideId ? state.slides.findIndex(slide => slide.id === slideId) : state.slideIndex
  if (index < 0 || index >= state.slides.length) {
    throw new PresentationCommandError(`Slide not found: ${slideId ?? state.slideIndex}`)
  }
  return index
}

const unchanged = (
  state: PresentationState,
  command: PresentationCommand,
): PresentationCommandResult => ({
  state,
  change: {
    commandType: command.type,
    changed: false,
    affectedSlideIds: [],
    affectedElementIds: [],
  },
})

const changed = (
  state: PresentationState,
  command: PresentationCommand,
  affectedSlideIds: string[] = [],
  affectedElementIds: string[] = [],
): PresentationCommandResult => ({
  state,
  change: {
    commandType: command.type,
    changed: true,
    affectedSlideIds,
    affectedElementIds,
  },
})

export const applyPresentationCommand = (
  state: PresentationState,
  command: PresentationCommand,
): PresentationCommandResult => {
  switch (command.type) {
    case 'presentation.title.set': {
      const title = command.title || command.fallbackTitle
      if (title === state.title) return unchanged(state, command)
      return changed({ ...state, title }, command)
    }
    case 'presentation.theme.update': {
      return changed({ ...state, theme: { ...state.theme, ...command.props } }, command)
    }
    case 'presentation.viewport-size.set': {
      if (command.size === state.viewportSize) return unchanged(state, command)
      return changed({ ...state, viewportSize: command.size }, command)
    }
    case 'presentation.viewport-ratio.set': {
      if (command.ratio === state.viewportRatio) return unchanged(state, command)
      return changed({ ...state, viewportRatio: command.ratio }, command)
    }
    case 'presentation.slides.replace': {
      return changed({
        ...state,
        slides: command.slides,
        theme: command.theme ? { ...state.theme, ...command.theme } : state.theme,
      }, command, command.slides.map(slide => slide.id))
    }
    case 'presentation.templates.replace': {
      return changed({ ...state, templates: command.templates }, command)
    }
    case 'slide.add': {
      const additions = (Array.isArray(command.slides) ? command.slides : [command.slides]).map(slide => {
        const nextSlide = { ...slide }
        delete nextSlide.sectionTag
        return nextSlide
      })
      const insertionIndex = state.slideIndex + 1
      const slides = [
        ...state.slides.slice(0, insertionIndex),
        ...additions,
        ...state.slides.slice(insertionIndex),
      ]
      return changed(
        { ...state, slides, slideIndex: insertionIndex },
        command,
        additions.map(slide => slide.id),
      )
    }
    case 'slide.update': {
      const slideIndex = findSlideIndex(state, command.slideId)
      const previousSlide = state.slides[slideIndex]
      if (!previousSlide) throw new PresentationCommandError('Slide not found')
      const slide = { ...previousSlide, ...command.props }
      const slides = state.slides.slice()
      slides[slideIndex] = slide
      return changed({ ...state, slides }, command, [slide.id])
    }
    case 'slide.properties.remove': {
      const properties = normalizePropertyList(command.payload.property)
      let didChange = false
      const slides = state.slides.map(slide => {
        if (slide.id !== command.payload.id) return slide
        didChange = true
        return omitProperties(slide, properties)
      })
      if (!didChange) throw new PresentationCommandError(`Slide not found: ${command.payload.id}`)
      return changed({ ...state, slides }, command, [command.payload.id])
    }
    case 'slide.delete': {
      const slideIds = Array.isArray(command.slideIds) ? command.slideIds : [command.slideIds]
      const slides = cloneSerializable(state.slides)
      const deletedIndexes: number[] = []

      for (const deletedId of slideIds) {
        const index = slides.findIndex(slide => slide.id === deletedId)
        if (index < 0) throw new PresentationCommandError(`Slide not found: ${deletedId}`)
        deletedIndexes.push(index)

        const deletedSlide = slides[index]
        if (!deletedSlide) throw new PresentationCommandError(`Slide not found: ${deletedId}`)
        const deletedSection = deletedSlide.sectionTag
        if (deletedSection) {
          const nextSlide = slides[index + 1]
          if (nextSlide && !nextSlide.sectionTag) {
            delete deletedSlide.sectionTag
            nextSlide.sectionTag = deletedSection
          }
        }
        slides.splice(index, 1)
      }

      let slideIndex = Math.min(...deletedIndexes)
      const maxIndex = slides.length - 1
      if (slideIndex > maxIndex) slideIndex = maxIndex

      return changed({ ...state, slides, slideIndex }, command, slideIds)
    }
    case 'slide.focus': {
      if (command.index === state.slideIndex) return unchanged(state, command)
      return changed({ ...state, slideIndex: command.index }, command, [state.slides[command.index]?.id].filter((id): id is string => !!id))
    }
    case 'element.add': {
      const additions = Array.isArray(command.elements) ? command.elements : [command.elements]
      const slideIndex = findSlideIndex(state)
      const currentSlide = state.slides[slideIndex]
      if (!currentSlide) throw new PresentationCommandError('Current slide not found')
      const slide = { ...currentSlide, elements: [...currentSlide.elements, ...additions] }
      const slides = state.slides.slice()
      slides[slideIndex] = slide
      return changed(
        { ...state, slides },
        command,
        [slide.id],
        additions.map(element => element.id),
      )
    }
    case 'element.delete': {
      const elementIds = Array.isArray(command.elementIds) ? command.elementIds : [command.elementIds]
      const deleted = new Set(elementIds)
      const slideIndex = findSlideIndex(state)
      const currentSlide = state.slides[slideIndex]
      if (!currentSlide) throw new PresentationCommandError('Current slide not found')
      const slide = {
        ...currentSlide,
        elements: currentSlide.elements.filter(element => !deleted.has(element.id)),
      }
      const slides = state.slides.slice()
      slides[slideIndex] = slide
      return changed({ ...state, slides }, command, [slide.id], elementIds)
    }
    case 'element.update': {
      const elementIds = typeof command.payload.id === 'string'
        ? [command.payload.id]
        : command.payload.id
      const targetIds = new Set(elementIds)
      const slideIndex = findSlideIndex(state, command.payload.slideId)
      const currentSlide = state.slides[slideIndex]
      if (!currentSlide) throw new PresentationCommandError('Target slide not found')
      const elements = currentSlide.elements.map(element => {
        return targetIds.has(element.id) ? { ...element, ...command.payload.props } as PPTElement : element
      })
      const slide = { ...currentSlide, elements }
      const slides = state.slides.slice()
      slides[slideIndex] = slide
      return changed({ ...state, slides }, command, [slide.id], elementIds)
    }
    case 'element.properties.remove': {
      const properties = normalizePropertyList(command.payload.property)
      const slideIndex = findSlideIndex(state)
      const currentSlide = state.slides[slideIndex]
      if (!currentSlide) throw new PresentationCommandError('Current slide not found')
      let didChange = false
      const elements = currentSlide.elements.map(element => {
        if (element.id !== command.payload.id) return element
        didChange = true
        return omitProperties(element, properties) as PPTElement
      })
      if (!didChange) throw new PresentationCommandError(`Element not found: ${command.payload.id}`)
      const slide = { ...currentSlide, elements }
      const slides = state.slides.slice()
      slides[slideIndex] = slide
      return changed({ ...state, slides }, command, [slide.id], [command.payload.id])
    }
  }
}
