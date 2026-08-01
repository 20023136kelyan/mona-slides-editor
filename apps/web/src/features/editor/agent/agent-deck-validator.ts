import {
  applyPresentationTransaction,
  copyElementTreeWithPowerPointOrigins,
  createPresentationTransaction,
  createPresentationId,
  flattenElementTree,
  retainElementTreeCopyOrigins,
  resolveSlideRenderState,
  type PresentationCommand,
  type PresentationState,
  type PresentationTransaction,
} from '@mona/presentation-core'
import type { PPTElement, Slide, SlideTheme } from '@mona/presentation-core/model'

import { sanitizeSlides } from '@/lib/deck-sanitizer'

const MAX_ELEMENT_EXTENT = 100_000
/**
 * A whole deck, not one edit, so the ceiling is higher than the old command one.
 *
 * Assets live as files in the workspace and come back as short blob references, so
 * legitimate deck JSON is small - one real 23-slide deck reads back at 0.67 MB.
 * Anything near this ceiling means bytes are being inlined again.
 */
const MAX_SLIDES_BYTES = 12_000_000

type AgentWorkspaceSlide = Slide & {
  powerPointInheritedElements?: PPTElement[]
}

const same = (left: unknown, right: unknown): boolean => (
  JSON.stringify(left) === JSON.stringify(right)
)

interface KnownNativeOrigin {
  packageId: string
  sourceLayer: NonNullable<PPTElement['source']>['sourceLayer']
  sourceObjectId: string
  sourcePart: string
}

const nativeOrigin = (element: PPTElement): KnownNativeOrigin | undefined => {
  const source = element.source
  if (!source) return undefined
  if (source.sourceObjectId && source.sourcePart) {
    return {
      packageId: source.packageId,
      sourceLayer: source.sourceLayer,
      sourceObjectId: source.sourceObjectId,
      sourcePart: source.sourcePart,
    }
  }
  const origin = source.copyOnWrite
  return origin
    ? {
        packageId: origin.packageId,
        sourceLayer: origin.sourceLayer,
        sourceObjectId: origin.sourceObjectId,
        sourcePart: origin.sourcePart,
      }
    : undefined
}

/**
 * Consume the virtual inherited layer exposed in the agent's slide JSON.
 *
 * An unchanged entry is discarded. Editing one creates a slide-local
 * copy-on-write override; removing one records a slide-local hide intent. The
 * shared master/layout object is never edited as a side effect of applying a
 * slide file.
 */
const materializeInheritedAgentEdits = (
  state: PresentationState,
  slides: AgentWorkspaceSlide[],
): Slide[] => {
  const currentById = new Map(state.slides.map(slide => [slide.id, slide]))
  return slides.map(inputSlide => {
    const {
      powerPointInheritedElements,
      ...slideWithoutVirtualLayer
    } = inputSlide
    const slide = slideWithoutVirtualLayer as Slide
    const copyOrigin = slide.source?.copyOnWrite
    const previous = currentById.get(slide.id) ?? (
      copyOrigin
        ? state.slides.find(candidate => (
            candidate.source?.packageId === copyOrigin.packageId
            && candidate.source?.slidePart === copyOrigin.sourceSlidePart
          ))
        : undefined
    )
    if (!previous || powerPointInheritedElements === undefined) return slide
    if (!Array.isArray(powerPointInheritedElements)) {
      throw new Error(`Slide "${slide.id}" has an invalid powerPointInheritedElements list.`)
    }
    const inherited = resolveSlideRenderState(previous, state.sourcePackages ?? [])
      .nodes
      .filter(node => node.layer !== 'slide')
      .map(node => node.element)
    const baselineByObject = new Map(inherited.flatMap(element => {
      const objectId = element.source?.sourceObjectId
      return objectId ? [[objectId, element] as const] : []
    }))
    const baselineById = new Map(inherited.map(element => [element.id, element]))
    const desiredByObject = new Map<string, PPTElement>()
    const retainedUnaddressableIds = new Set<string>()
    for (const element of powerPointInheritedElements) {
      const objectId = element.source?.sourceObjectId
      if (!objectId) {
        const baselineElement = baselineById.get(element.id)
        if (!baselineElement || baselineElement.source?.sourceObjectId || !same(baselineElement, element)) {
          throw new Error(
            `Slide "${slide.id}" changed an inherited element that has no exact native source identity.`,
          )
        }
        if (retainedUnaddressableIds.has(element.id)) {
          throw new Error(`Slide "${slide.id}" repeats inherited element "${element.id}".`)
        }
        retainedUnaddressableIds.add(element.id)
        continue
      }
      const baselineElement = baselineByObject.get(objectId)
      if (!baselineElement) {
        throw new Error(
          `Slide "${slide.id}" contains an inherited element without a valid native source identity.`,
        )
      }
      if (!same(baselineElement.source, element.source)) {
        throw new Error(
          `Inherited element "${element.id}" changed PowerPoint source provenance. Keep the source field exactly as read.`,
        )
      }
      if (desiredByObject.has(objectId)) {
        throw new Error(`Slide "${slide.id}" repeats inherited object "${objectId}".`)
      }
      desiredByObject.set(objectId, element)
    }
    for (const baselineElement of inherited) {
      if (
        !baselineElement.source?.sourceObjectId
        && !retainedUnaddressableIds.has(baselineElement.id)
      ) {
        throw new Error(
          `Slide "${slide.id}" removed an inherited element that has no exact native source identity.`,
        )
      }
    }
    const hidden = new Set(slide.source?.hiddenInheritedObjectIds ?? [])
    const overrides: PPTElement[] = []
    for (const [objectId, baselineElement] of baselineByObject) {
      const desiredElement = desiredByObject.get(objectId)
      if (!desiredElement) {
        hidden.add(objectId)
        continue
      }
      if (same(baselineElement, desiredElement)) continue
      const copied = copyElementTreeWithPowerPointOrigins(
        [desiredElement],
        createPresentationId,
        'override',
        previous.source
          ? {
              packageId: previous.source.packageId,
              slidePart: previous.source.slidePart,
            }
          : undefined,
      ).elements[0]
      if (copied) overrides.push(copied)
    }
    if (!overrides.length && !hidden.size) return slide
    return {
      ...slide,
      elements: [...slide.elements, ...overrides],
      ...(slide.source
        ? {
            source: {
              ...slide.source,
              ...(hidden.size ? { hiddenInheritedObjectIds: [...hidden].sort() } : {}),
            },
          }
        : {}),
    }
  })
}

/**
 * Source provenance is data owned by Mona, not an agent-editable style field.
 * Existing identities must remain byte-for-byte equal. Copying an imported
 * element under a new Mona id is allowed and is converted to an explicit native
 * copy reference instead of aliasing the original OOXML object.
 */
const normalizeAgentElementProvenance = (
  state: PresentationState,
  slides: Slide[],
): void => {
  const previousById = new Map<string, { element: PPTElement; slideId: string }>()
  const knownNativeObjects = new Map<string, KnownNativeOrigin>()
  for (const slide of state.slides) {
    for (const element of flattenElementTree(slide.elements)) {
      previousById.set(element.id, { element, slideId: slide.id })
      const origin = nativeOrigin(element)
      if (origin) knownNativeObjects.set(origin.sourceObjectId, origin)
    }
    for (const node of resolveSlideRenderState(slide, state.sourcePackages ?? []).nodes) {
      const origin = nativeOrigin(node.element)
      if (origin) knownNativeObjects.set(origin.sourceObjectId, origin)
    }
  }

  for (const slide of slides) {
    const previousSlide = state.slides.find(candidate => candidate.id === slide.id)
    if (previousSlide && !same(previousSlide.source, slide.source)) {
      throw new Error(
        `Slide "${slide.id}" changed PowerPoint source provenance. Keep the source field exactly as read.`,
      )
    }
    if (!previousSlide && slide.source) {
      const sourceSlide = state.slides.find(candidate => same(candidate.source, slide.source))
      if (!sourceSlide) {
        throw new Error(`Slide "${slide.id}" has forged or unknown PowerPoint source provenance.`)
      }
      // The copy keeps the retained slide as a read-only clone origin. It may
      // continue resolving the same layout/master while open, but writeback
      // sees `copyOnWrite` and allocates a new slide part rather than patching
      // the source slide. Duplicate element IDs are remapped atomically because
      // IDs are deck-global.
      const roots = slide.elements
      const existingIds = new Set(state.slides.flatMap(candidate => (
        flattenElementTree(candidate.elements).map(element => element.id)
      )))
      if (flattenElementTree(roots).some(element => existingIds.has(element.id))) {
        const copied = copyElementTreeWithPowerPointOrigins(roots, createPresentationId, 'copy')
        slide.elements = copied.elements
        if (slide.animations) {
          for (const animation of slide.animations) {
            animation.id = createPresentationId()
            animation.elId = copied.idMap.get(animation.elId) ?? animation.elId
          }
        }
      }
      else slide.elements = roots
      slide.source = {
        ...sourceSlide.source!,
        copyOnWrite: {
          packageId: sourceSlide.source!.packageId,
          sourceSlidePart: sourceSlide.source!.copyOnWrite?.sourceSlidePart
            ?? sourceSlide.source!.slidePart,
        },
      }
    }
    const target = slide.source
      ? { packageId: slide.source.packageId, slidePart: slide.source.slidePart }
      : undefined
    const validateNewTree = (elements: readonly PPTElement[]): void => {
      for (const element of flattenElementTree(elements)) {
        const origin = nativeOrigin(element)
        if (element.source) {
          const known = origin && knownNativeObjects.get(origin.sourceObjectId)
          if (!known || !same(known, origin)) {
            throw new Error(
              `Element "${element.id}" has a forged or unknown PowerPoint source identity (${JSON.stringify(origin)}).`,
            )
          }
          continue
        }
        if (element.type === 'opaque') {
          throw new Error(
            `Opaque element "${element.id}" has no retained native payload and cannot be created from scratch.`,
          )
        }
      }
    }
    const normalizeRoots = (elements: PPTElement[]): void => {
      for (const element of elements) {
        const previous = previousById.get(element.id)
        if (previous?.slideId === slide.id) {
          if (!same(previous.element.source, element.source)) {
            throw new Error(
              `Element "${element.id}" changed PowerPoint source provenance. Keep the source field exactly as read.`,
            )
          }
          if (element.type === 'group') normalizeRoots(element.elements)
          continue
        }
        if (element.source) {
          if (previous && !same(previous.element.source, element.source)) {
            throw new Error(
              `Element "${element.id}" changed PowerPoint source provenance. Keep the source field exactly as read.`,
            )
          }
          validateNewTree([element])
          retainElementTreeCopyOrigins([element], 'copy', target)
          continue
        }
        validateNewTree([element])
        if (element.type === 'group') normalizeRoots(element.elements)
      }
    }
    normalizeRoots(slide.elements)

    const desiredIds = new Set(flattenElementTree(slide.elements).map(element => element.id))
    if (previousSlide) {
      const hidden = new Set(slide.source?.hiddenInheritedObjectIds ?? [])
      for (const previous of flattenElementTree(previousSlide.elements)) {
        if (desiredIds.has(previous.id)) continue
        const origin = previous.source?.copyOnWrite
        if (origin?.mode === 'override') hidden.add(origin.sourceObjectId)
      }
      if (slide.source && hidden.size) {
        slide.source = {
          ...slide.source,
          hiddenInheritedObjectIds: [...hidden].sort(),
        }
      }
    }
  }
}

/**
 * Accepts a bare string where the model meant "set the text".
 *
 * A shape stores structured `ShapeText`, so a plain string in `text` produces a
 * rendered element with nothing visible on it - a silent, blank failure rather
 * than an error anyone can read. Editing slide JSON directly makes this *more*
 * likely than the old program API did: `"text": "TEAM FIVE"` is the obvious thing
 * to write in a file where `text` is right there as a field.
 *
 * Coercing rather than rejecting keeps the deck forgiving in the direction the
 * model already leans, and writing only the content back preserves the styling.
 */
const coerceShapeText = (
  previous: PPTElement | undefined,
  element: PPTElement,
): PPTElement => {
  const raw = (element as { text?: unknown }).text
  if (typeof raw !== 'string') return element
  // A text element keeps its copy in `content`; there is no `text` field to set.
  if (element.type === 'text') {
    const { text: _text, ...rest } = element as unknown as Record<string, unknown>
    return { ...rest, content: raw } as unknown as PPTElement
  }
  if (element.type !== 'shape') return element
  const existing = previous?.type === 'shape' ? previous.text : undefined
  return {
    ...element,
    text: {
      align: existing?.align ?? 'middle',
      defaultColor: existing?.defaultColor ?? '#333333',
      defaultFontName: existing?.defaultFontName ?? 'Microsoft Yahei',
      ...(existing ?? {}),
      content: raw,
    },
  }
}

const assertGeometry = (element: PPTElement, label: string) => {
  const geometry = [element.left, element.top, element.width]
  if (element.type !== 'line') geometry.push(element.height)
  if (geometry.some(value => !Number.isFinite(value) || Math.abs(value) > MAX_ELEMENT_EXTENT)) {
    throw new Error(`${label} has invalid or excessive geometry`)
  }
  if (element.width <= 0 || (element.type !== 'line' && element.height <= 0)) {
    throw new Error(`${label} must have positive dimensions`)
  }
}

/**
 * Every image in a deck is a file the deck owns.
 *
 * An `https://` URL the model found on the web renders only while that host is up,
 * leaks the reader's IP to it, and breaks the deck offline. `data:` puts the bytes
 * in the model, which is what made one deck persist at 193 MB. Both are refused in
 * favour of the one thing that survives a restart: a file in `deck/assets/`, which
 * arrives here as a `mona://asset/` reference once ingested.
 */
const assertLocalImage = (element: PPTElement, label: string) => {
  if (element.type !== 'image') return
  if (!element.src.startsWith('mona://asset/')) {
    throw new Error(
      `${label} points at "${element.src.slice(0, 60)}". Save the image into deck/assets/ and reference that path instead.`,
    )
  }
}

/**
 * Validates a whole deck read back out of the agent's workspace.
 *
 * This is the one place changes land, which is the point. The old design put
 * validation in front of every *read* - the model could not see the document
 * without going through a checked API - while edits arrived as a program in an
 * invented vocabulary. Here the agent edits ordinary files with ordinary tools and
 * the deck is checked once, on the way in.
 *
 * The single `presentation.slides.replace` also keeps what was worth keeping from
 * the old design: one transaction per run, so a whole conversation is one undo.
 *
 * Every message names the fix. The agent reads these and retries, so "invalid
 * deck" costs a turn where "keep the id the slide was read with" does not.
 */
export const validateAgentSlides = (
  state: PresentationState,
  { slides, theme, title }: { slides: readonly AgentWorkspaceSlide[]; theme?: Partial<SlideTheme>; title?: string },
): PresentationTransaction => {
  if (!slides.length) throw new Error('The deck has no slides. A deck must keep at least one.')
  if (JSON.stringify(slides).length > MAX_SLIDES_BYTES) {
    throw new Error(`The deck exceeds ${Math.round(MAX_SLIDES_BYTES / 1_000_000)} MB. Keep assets as files rather than inline data.`)
  }

  // Cloned up front so normalising never touches the caller's slides. Native
  // provenance is checked before the virtual inherited layer is consumed, so
  // the normalizer's own hidden/override metadata cannot be mistaken for an
  // agent attempt to forge a source identity.
  const workspaceSlides = structuredClone(slides) as AgentWorkspaceSlide[]
  normalizeAgentElementProvenance(state, workspaceSlides)
  const cloned = materializeInheritedAgentEdits(state, workspaceSlides)
  const previousElements = new Map<string, PPTElement>()
  for (const slide of state.slides) {
    for (const element of flattenElementTree(slide.elements)) previousElements.set(element.id, element)
  }

  const seen = new Set<string>()
  for (const [index, slide] of cloned.entries()) {
    const where = slide.title ? `Slide "${slide.title}"` : `Slide ${index + 1}`
    if (typeof slide.id !== 'string' || !slide.id) throw new Error(`${where} has no id. Keep the id the slide was read with.`)
    if (seen.has(slide.id)) throw new Error(`${where} repeats the id "${slide.id}". Every slide needs its own.`)
    seen.add(slide.id)
    if (!Array.isArray(slide.elements)) throw new Error(`${where} has no element list.`)
    // Rebuilt rather than mutated in place, because coercion can change an
    // element's shape and `flattenElementTree` walks into groups.
    slide.elements = slide.elements.map(function normalize(element): PPTElement {
      const coerced = coerceShapeText(previousElements.get(element.id), element)
      const children = (coerced as { elements?: PPTElement[] }).elements
      return Array.isArray(children)
        ? { ...coerced, elements: children.map(normalize) } as PPTElement
        : coerced
    })
    for (const element of flattenElementTree(slide.elements)) {
      assertGeometry(element, `${where}: element ${element.id}`)
      assertLocalImage(element, `${where}: image ${element.id}`)
    }
  }

  const commands: PresentationCommand[] = [{
    slides: cloned,
    type: 'presentation.slides.replace',
    ...(theme ? { theme } : {}),
  }]
  if (typeof title === 'string' && title !== state.title) {
    // `fallbackTitle` is what an emptied title falls back to, so clearing the
    // title keeps the one the deck already has rather than blanking it.
    commands.push({ fallbackTitle: state.title, title, type: 'presentation.title.set' })
  }

  const transaction = createPresentationTransaction({
    commands,
    label: 'Mona agent edit',
    origin: 'agent',
  })
  const preview = applyPresentationTransaction(state, transaction)
  if (!preview.ok) throw new Error(preview.reason)
  // The security net, unchanged: unsafe markup or URL schemes never reach the
  // renderer, whichever route the change arrived by.
  if (sanitizeSlides(preview.state.slides) !== preview.state.slides) {
    throw new Error('The deck contains unsafe markup or URLs.')
  }
  return transaction
}
