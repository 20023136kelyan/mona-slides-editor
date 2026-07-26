/** How many slides a row names before it just counts them instead. */
const NAMED_SLIDE_LIMIT = 3

/** Long enough to identify a command or query, short enough for one line. */
const DETAIL_LIMIT = 48

export interface ToolLabelSlide {
  id: string
  title?: string
}

export interface ToolLabelContext {
  /** The slide the tools act on when the call names none. */
  currentSlideId?: string
  slides: readonly ToolLabelSlide[]
  translate: (key: string, values?: Record<string, unknown>) => string
}

const key = (name: string) => `foundation.editor.agent.${name}`

/**
 * A slide as the user knows it: its own title, or its position when untitled.
 *
 * Null for an id the deck no longer holds, so a stale reference is dropped
 * rather than named after whatever now occupies that position.
 */
export const slideLabelFor = (
  id: string | undefined,
  { slides, translate }: Pick<ToolLabelContext, 'slides' | 'translate'>,
): string | null => {
  if (!id) return null
  const index = slides.findIndex(slide => slide.id === id)
  if (index < 0) return null
  return slides[index]?.title?.trim() || translate(key('slideNumber'), { number: index + 1 })
}

/**
 * A workspace path as the user knows it.
 *
 * The agent works on `deck/slides/02.json` in a temp directory, which is true and
 * useless to read. The filename is the slide's position in deck order, so it maps
 * straight back to the slide the user is looking at - and that is what the row
 * should say. Anything outside `deck/slides` keeps its own name.
 */
const pathLabel = (
  path: string,
  { slides, translate }: Pick<ToolLabelContext, 'slides' | 'translate'>,
): { kind: 'asset' | 'deck' | 'other' | 'slide'; label: string } => {
  const slide = /(?:^|\/)slides\/(\d+)\.json$/.exec(path)
  if (slide) {
    const position = Number(slide[1])
    const title = slides[position - 1]?.title?.trim()
    return { kind: 'slide', label: title || translate(key('slideNumber'), { number: position }) }
  }
  const name = path.split('/').filter(Boolean).at(-1) ?? path
  if (/(?:^|\/)deck\.json$/.test(path)) return { kind: 'deck', label: name }
  if (/(?:^|\/)assets\//.test(path)) return { kind: 'asset', label: name }
  return { kind: 'other', label: name }
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const hostOf = (url: string): string => {
  try {
    return new URL(url).host
  }
  catch {
    return url.slice(0, DETAIL_LIMIT)
  }
}

/**
 * The line a tool row shows: what it is doing, and to what.
 *
 * The tools are the ordinary ones now, so the labels have to describe real work -
 * reading a file, grepping the deck, running a command - rather than the three
 * custom verbs that came before. Paths are translated back into slides, because a
 * row reading `deck/slides/02.json` in a temp directory tells the user nothing
 * they can act on.
 *
 * Slides are named rather than called "this slide": a transcript is read after
 * the fact, and by then "this" has no referent.
 */
export const buildToolLabel = (
  name: string,
  input: unknown,
  context: ToolLabelContext,
): string => {
  const { currentSlideId, translate } = context
  const value = (input ?? {}) as Record<string, unknown>

  // Reading a slide file is reading a slide; reading an image is looking at one.
  if (name === 'Read' || name === 'Edit' || name === 'Write' || name === 'NotebookEdit') {
    const path = text(value.file_path ?? value.path ?? value.notebook_path)
    if (!path) return translate(key('runningTool'), { tool: name })
    const { kind, label } = pathLabel(path, context)
    if (kind === 'asset') return translate(key('toolImage'), { name: label })
    if (kind === 'deck') return translate(key('toolDeckOutline'))
    if (name === 'Read') {
      return kind === 'slide'
        ? translate(key('toolReading'), { scope: label })
        : translate(key('toolFile'), { name: label })
    }
    return translate(key(name === 'Write' ? 'toolWriting' : 'toolEditing'), { scope: label })
  }

  if (name === 'Grep') {
    return translate(key('toolSearching'), { query: text(value.pattern).slice(0, DETAIL_LIMIT) })
  }
  if (name === 'Glob') {
    return translate(key('toolListing'))
  }
  if (name === 'Bash' || name === 'BashOutput') {
    // The SDK asks for a one-line description of every command, which reads far
    // better than the command itself; the command is the fallback.
    const detail = text(value.description) || text(value.command)
    return detail
      ? translate(key('runningTool'), { tool: detail.slice(0, DETAIL_LIMIT) })
      : translate(key('runningTool'), { tool: name })
  }
  if (name === 'WebSearch') {
    return translate(key('toolWebSearching'), { query: text(value.query).slice(0, DETAIL_LIMIT) })
  }
  if (name === 'WebFetch') {
    return translate(key('toolFetching'), { host: hostOf(text(value.url)) })
  }

  if (name === 'search_images') {
    return translate(key('toolSearching'), { query: text(value.query).slice(0, DETAIL_LIMIT) })
  }
  if (name === 'web_search') {
    return translate(key('toolWebSearching'), { query: text(value.query).slice(0, DETAIL_LIMIT) })
  }
  if (name === 'apply') {
    const explanation = text(value.explanation)
    return explanation ? explanation.slice(0, 80) : translate(key('toolApplying'))
  }
  if (name === 'sync') {
    return translate(key('toolSyncing'))
  }

  if (name === 'look') {
    const requested = Array.isArray(value.slideIds)
      ? value.slideIds.filter((id): id is string => typeof id === 'string')
      : []
    const named = (requested.length ? requested : [currentSlideId])
      .map(id => slideLabelFor(id, context))
      .filter((label): label is string => label !== null)
    const scope = named.length && named.length <= NAMED_SLIDE_LIMIT
      ? named.join(', ')
      : translate(key('toolSlides'), { count: named.length || requested.length })
    return translate(key('toolLooking'), { scope })
  }

  // A tool nobody here knows about still gets a row saying its name, which beats
  // describing it as something it is not.
  return translate(key('runningTool'), { tool: name })
}
