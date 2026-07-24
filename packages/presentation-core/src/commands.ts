import type { PPTElement, Slide, SlideTemplate, SlideTheme } from './model'
import type { PowerPointPackageReference } from './source'
import type { PresentationState } from './state'
import { cloneSerializable } from './state'
import {
  collectElementTreeIds,
  findElementById,
  flattenElementTree,
  removeElementsFromTree,
  updateElementTreeByIds,
} from './elements'

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
  | { type: 'presentation.source-packages.replace'; sourcePackages: PowerPointPackageReference[] }
  | { type: 'presentation.templates.replace'; templates: SlideTemplate[] }
  | { type: 'slide.add'; slides: Slide | Slide[] }
  | { type: 'slide.update'; props: Partial<Slide>; slideId?: string }
  | { type: 'slide.properties.remove'; payload: RemovePropertyPayload }
  | { type: 'slide.delete'; slideIds: string | string[] }
  | { type: 'slide.focus'; index: number }
  | { type: 'element.add'; elements: PPTElement | PPTElement[]; slideId?: string }
  | { type: 'element.delete'; elementIds: string | string[]; slideId?: string }
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

const markPowerPointSlideDirty = (
  state: PresentationState,
  slide: Slide,
  reason: PresentationCommand['type'],
  elementIds: readonly string[] = [],
): PresentationState => {
  const source = slide.source
  if (!source || !state.sourcePackages?.length) return state
  const packageIndex = state.sourcePackages.findIndex(candidate => candidate.packageId === source.packageId)
  if (packageIndex < 0) return state
  const selectedIds = new Set(elementIds)
  const allElements = flattenElementTree(slide.elements)
  const selectedElements = allElements.filter(element => !elementIds.length || selectedIds.has(element.id))
  const changesByPart = new Map<string, Set<string>>()
  let hasUnresolvedSlideLocalChange = !elementIds.length
  for (const element of selectedElements) {
    const elementSource = element.source
    if (!elementSource?.sourceObjectId || !elementSource.sourcePart) {
      hasUnresolvedSlideLocalChange = true
      continue
    }
    const objectIds = changesByPart.get(elementSource.sourcePart) ?? new Set<string>()
    objectIds.add(elementSource.sourceObjectId)
    changesByPart.set(elementSource.sourcePart, objectIds)
  }
  if (selectedElements.length < elementIds.length) hasUnresolvedSlideLocalChange = true
  if (hasUnresolvedSlideLocalChange || changesByPart.size === 0) {
    if (!changesByPart.has(source.slidePart)) changesByPart.set(source.slidePart, new Set())
  }
  const sourcePackages = state.sourcePackages.slice()
  const sourcePackage = sourcePackages[packageIndex]!
  const existingParts = sourcePackage.dirty?.parts ?? []
  const nextParts = new Map(existingParts.map(part => [part.partPath, part]))
  for (const [partPath, objectIds] of changesByPart) {
    const existingPart = nextParts.get(partPath)
    nextParts.set(partPath, {
      objectIds: [...new Set([...(existingPart?.objectIds ?? []), ...objectIds])].sort(),
      partPath,
      reasons: [...new Set([...(existingPart?.reasons ?? []), reason])].sort(),
    })
  }
  sourcePackages[packageIndex] = {
    ...sourcePackage,
    dirty: {
      parts: [...nextParts.values()].sort((left, right) => left.partPath.localeCompare(right.partPath)),
      revision: (sourcePackage.dirty?.revision ?? 0) + 1,
    },
  }
  return { ...state, sourcePackages }
}

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
      const previousById = new Map(state.slides.map(slide => [slide.id, slide]))
      const backgroundChanges: Slide[] = []
      const slides = command.slides.map(slide => {
        const previous = previousById.get(slide.id)
        if (
          !previous?.source
          || !slide.source
          || JSON.stringify(previous.background) === JSON.stringify(slide.background)
        ) return slide
        backgroundChanges.push(previous)
        return {
          ...slide,
          source: {
            ...slide.source,
            backgroundSource: 'slide' as const,
          },
        }
      })
      let nextState: PresentationState = {
        ...state,
        slides,
        theme: command.theme ? { ...state.theme, ...command.theme } : state.theme,
      }
      for (const previous of backgroundChanges) {
        nextState = markPowerPointSlideDirty(nextState, previous, command.type)
      }
      return changed(nextState, command, slides.map(slide => slide.id))
    }
    case 'presentation.source-packages.replace': {
      if (command.sourcePackages === state.sourcePackages) return unchanged(state, command)
      return changed({ ...state, sourcePackages: command.sourcePackages }, command)
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
      const slide = {
        ...previousSlide,
        ...command.props,
        ...(command.props.background !== undefined && (command.props.source ?? previousSlide.source)
          ? {
              source: {
                ...(command.props.source ?? previousSlide.source)!,
                backgroundSource: 'slide' as const,
              },
            }
          : {}),
      }
      const slides = state.slides.slice()
      slides[slideIndex] = slide
      return changed(markPowerPointSlideDirty({ ...state, slides }, previousSlide, command.type), command, [slide.id])
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
      const previousSlide = state.slides.find(slide => slide.id === command.payload.id)!
      return changed(markPowerPointSlideDirty({ ...state, slides }, previousSlide, command.type), command, [command.payload.id])
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
      const slideIndex = findSlideIndex(state, command.slideId)
      const currentSlide = state.slides[slideIndex]
      if (!currentSlide) throw new PresentationCommandError('Current slide not found')
      const existingIds = new Set(collectElementTreeIds(currentSlide.elements))
      const additionIds = new Set<string>()
      for (const elementId of collectElementTreeIds(additions)) {
        if (existingIds.has(elementId) || additionIds.has(elementId)) {
          throw new PresentationCommandError(`Duplicate element id: ${elementId}`)
        }
        additionIds.add(elementId)
      }
      const slide = { ...currentSlide, elements: [...currentSlide.elements, ...additions] }
      const slides = state.slides.slice()
      slides[slideIndex] = slide
      return changed(
        markPowerPointSlideDirty({ ...state, slides }, currentSlide, command.type, additions.map(element => element.id)),
        command,
        [slide.id],
        additions.map(element => element.id),
      )
    }
    case 'element.delete': {
      const elementIds = Array.isArray(command.elementIds) ? command.elementIds : [command.elementIds]
      const deleted = new Set(elementIds)
      const slideIndex = findSlideIndex(state, command.slideId)
      const currentSlide = state.slides[slideIndex]
      if (!currentSlide) throw new PresentationCommandError('Current slide not found')
      const missing = elementIds.find(id => !findElementById(currentSlide.elements, id))
      if (missing) throw new PresentationCommandError(`Element not found: ${missing}`)
      const slide = {
        ...currentSlide,
        elements: removeElementsFromTree(currentSlide.elements, deleted),
      }
      const slides = state.slides.slice()
      slides[slideIndex] = slide
      return changed(
        markPowerPointSlideDirty({ ...state, slides }, currentSlide, command.type, elementIds),
        command,
        [slide.id],
        elementIds,
      )
    }
    case 'element.update': {
      const elementIds = typeof command.payload.id === 'string'
        ? [command.payload.id]
        : command.payload.id
      const targetIds = new Set(elementIds)
      const slideIndex = findSlideIndex(state, command.payload.slideId)
      const currentSlide = state.slides[slideIndex]
      if (!currentSlide) throw new PresentationCommandError('Target slide not found')
      const missing = elementIds.find(id => !findElementById(currentSlide.elements, id))
      if (missing) throw new PresentationCommandError(`Element not found: ${missing}`)
      const elements = updateElementTreeByIds(
        currentSlide.elements,
        targetIds,
        element => {
          const props = command.payload.props
          const updated = { ...element, ...props } as PPTElement
          // Imported structured text remains the inheritance source until a
          // direct HTML edit occurs. At that point Mona's editor markup is the
          // new authored source and must not be overwritten on the next render.
          if (
            element.type === 'text'
            && 'content' in props
            && !('structuredText' in props)
            && updated.type === 'text'
          ) {
            delete updated.structuredText
          }
          if (
            element.type === 'shape'
            && updated.type === 'shape'
            && 'text' in props
            && props.text
            && typeof props.text === 'object'
            && 'content' in props.text
            && !('structuredText' in props.text)
            && updated.text
          ) {
            delete updated.text.structuredText
          }
          return updated
        },
      )
      const slide = { ...currentSlide, elements }
      const slides = state.slides.slice()
      slides[slideIndex] = slide
      return changed(
        markPowerPointSlideDirty({ ...state, slides }, currentSlide, command.type, elementIds),
        command,
        [slide.id],
        elementIds,
      )
    }
    case 'element.properties.remove': {
      const properties = normalizePropertyList(command.payload.property)
      const slideIndex = findSlideIndex(state)
      const currentSlide = state.slides[slideIndex]
      if (!currentSlide) throw new PresentationCommandError('Current slide not found')
      if (!findElementById(currentSlide.elements, command.payload.id)) {
        throw new PresentationCommandError(`Element not found: ${command.payload.id}`)
      }
      const elements = updateElementTreeByIds(
        currentSlide.elements,
        new Set([command.payload.id]),
        element => omitProperties(element, properties) as PPTElement,
      )
      const slide = { ...currentSlide, elements }
      const slides = state.slides.slice()
      slides[slideIndex] = slide
      return changed(
        markPowerPointSlideDirty({ ...state, slides }, currentSlide, command.type, [command.payload.id]),
        command,
        [slide.id],
        [command.payload.id],
      )
    }
  }
}
