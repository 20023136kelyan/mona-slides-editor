import {
  applyPresentationTransaction,
  createPresentationTransaction,
  flattenElementTree,
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
 * An image must resolve without the network.
 *
 * `blob:` is an asset in Mona's own media store; `data:` is bytes inline. Anything
 * else - an `https://` URL the model found on the web - renders only while that
 * host is up, leaks the reader's IP to it, and breaks the deck offline. The right
 * move for a web image is to download it into `deck/assets/` and reference the
 * file, which arrives here as a blob once ingested.
 */
const assertLocalImage = (element: PPTElement, label: string) => {
  if (element.type !== 'image') return
  if (!element.src.startsWith('blob:') && !element.src.startsWith('data:')) {
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
  { slides, theme, title }: { slides: readonly Slide[]; theme?: Partial<SlideTheme>; title?: string },
): PresentationTransaction => {
  if (!slides.length) throw new Error('The deck has no slides. A deck must keep at least one.')
  if (JSON.stringify(slides).length > MAX_SLIDES_BYTES) {
    throw new Error(`The deck exceeds ${Math.round(MAX_SLIDES_BYTES / 1_000_000)} MB. Keep assets as files rather than inline data.`)
  }

  // Cloned up front so normalising never touches the caller's slides.
  const cloned = structuredClone(slides) as Slide[]
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
