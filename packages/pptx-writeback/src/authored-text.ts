export interface AuthoredTextStyle {
  [property: string]: string | undefined
}

export interface AuthoredTextRun {
  fieldId?: string
  fieldType?: string
  hyperlink?: string
  kind: 'break' | 'field' | 'tab' | 'text'
  sourceId?: string
  style: AuthoredTextStyle
  text: string
}

export interface AuthoredTextParagraph {
  level: number
  list?: { startAt?: number; type: 'bullet' | 'number' }
  runs: AuthoredTextRun[]
  sourceId?: string
  style: AuthoredTextStyle
}

interface HtmlElement {
  attributes: Record<string, string>
  children: HtmlNode[]
  parent?: HtmlElement
  tag: string
  type: 'element'
}

interface HtmlText {
  parent: HtmlElement
  type: 'text'
  value: string
}

type HtmlNode = HtmlElement | HtmlText

const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'link', 'meta'])
const BLOCK_TAGS = new Set(['div', 'p'])

const decodeEntities = (value: string): string => value.replace(
  /&(#(?:x[0-9a-f]+|\d+)|amp|apos|gt|lt|nbsp|quot);/gi,
  (entity, name: string) => {
    if (name[0] === '#') {
      const hex = name[1]?.toLowerCase() === 'x'
      const parsed = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10)
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : entity
    }
    return {
      amp: '&',
      apos: "'",
      gt: '>',
      lt: '<',
      nbsp: '\u00a0',
      quot: '"',
    }[name.toLowerCase()] ?? entity
  },
)

const parseAttributes = (value: string): Record<string, string> => {
  const result: Record<string, string> = {}
  const expression = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g
  let match: RegExpExecArray | null
  while ((match = expression.exec(value))) {
    result[match[1]!.toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '')
  }
  return result
}

const parseFragment = (html: string): HtmlElement => {
  const root: HtmlElement = { attributes: {}, children: [], tag: '', type: 'element' }
  const stack = [root]
  const tokens = /<\/?([A-Za-z][\w:-]*)([^>]*)>|([^<]+)/g
  let match: RegExpExecArray | null
  while ((match = tokens.exec(html))) {
    const parent = stack.at(-1)!
    if (match[3] !== undefined) {
      parent.children.push({ parent, type: 'text', value: decodeEntities(match[3]) })
      continue
    }
    const raw = match[0]
    const tag = match[1]!.toLowerCase()
    if (raw.startsWith('</')) {
      for (let index = stack.length - 1; index > 0; index -= 1) {
        if (stack[index]!.tag === tag) {
          stack.length = index
          break
        }
      }
      continue
    }
    const element: HtmlElement = {
      attributes: parseAttributes(match[2] ?? ''),
      children: [],
      parent,
      tag,
      type: 'element',
    }
    parent.children.push(element)
    if (!VOID_TAGS.has(tag) && !/\/\s*>$/.test(raw)) stack.push(element)
  }
  return root
}

const parseStyle = (value = ''): AuthoredTextStyle => {
  const style: AuthoredTextStyle = {}
  for (const declaration of value.split(';')) {
    const separator = declaration.indexOf(':')
    if (separator < 0) continue
    const name = declaration.slice(0, separator).trim().toLowerCase()
    const entry = declaration.slice(separator + 1).trim()
    if (name && entry) style[name] = entry
  }
  return style
}

const elementStyle = (element: HtmlElement): AuthoredTextStyle => {
  const style = parseStyle(element.attributes.style)
  if (element.tag === 'strong' || element.tag === 'b') style['font-weight'] = '700'
  if (element.tag === 'em' || element.tag === 'i') style['font-style'] = 'italic'
  if (element.tag === 'u') style['text-decoration-line'] = 'underline'
  if (element.tag === 's' || element.tag === 'strike' || element.tag === 'del') {
    style['text-decoration-line'] = [style['text-decoration-line'], 'line-through']
      .filter(Boolean).join(' ')
  }
  if (element.tag === 'sub') style['vertical-align'] = 'sub'
  if (element.tag === 'sup') style['vertical-align'] = 'super'
  return style
}

const mergedStyle = (
  inherited: AuthoredTextStyle,
  element: HtmlElement,
): AuthoredTextStyle => ({ ...inherited, ...elementStyle(element) })

const nearestAttribute = (element: HtmlElement | undefined, name: string): string | undefined => {
  let current = element
  while (current) {
    const value = current.attributes[name]
    if (value !== undefined) return value
    current = current.parent
  }
  return undefined
}

const nearestLink = (element: HtmlElement | undefined): string | undefined => {
  let current = element
  while (current) {
    if (current.tag === 'a' && current.attributes.href) return current.attributes.href
    current = current.parent
  }
  return undefined
}

const styleKey = (style: AuthoredTextStyle): string => JSON.stringify(
  Object.fromEntries(Object.entries(style).sort(([left], [right]) => left.localeCompare(right))),
)

const pushRun = (runs: AuthoredTextRun[], run: AuthoredTextRun): void => {
  const previous = runs.at(-1)
  if (
    previous
    && previous.kind === 'text'
    && run.kind === 'text'
    && previous.sourceId === run.sourceId
    && previous.hyperlink === run.hyperlink
    && previous.fieldId === run.fieldId
    && styleKey(previous.style) === styleKey(run.style)
  ) {
    previous.text += run.text
    return
  }
  runs.push(run)
}

const collectRuns = (
  node: HtmlNode,
  paragraph: HtmlElement,
  inherited: AuthoredTextStyle,
  runs: AuthoredTextRun[],
): void => {
  if (node.type === 'text') {
    if (!node.value || (/^\s+$/.test(node.value) && /[\r\n]/.test(node.value))) return
    const sourceId = nearestAttribute(node.parent, 'data-ppt-run-id')
    const fieldId = nearestAttribute(node.parent, 'data-ppt-field-id')
    const fieldType = nearestAttribute(node.parent, 'data-ppt-field-type')
    pushRun(runs, {
      ...(fieldId ? { fieldId } : {}),
      ...(fieldType ? { fieldType } : {}),
      ...(nearestLink(node.parent) ? { hyperlink: nearestLink(node.parent) } : {}),
      kind: fieldId || fieldType ? 'field' : 'text',
      ...(sourceId ? { sourceId } : {}),
      style: inherited,
      text: node.value,
    })
    return
  }
  if (node !== paragraph && BLOCK_TAGS.has(node.tag)) return
  const style = mergedStyle(inherited, node)
  const sourceId = node.attributes['data-ppt-run-id']
  if (node.tag === 'br') {
    runs.push({ kind: 'break', ...(sourceId ? { sourceId } : {}), style, text: '' })
    return
  }
  if (node.attributes['data-ppt-run-kind'] === 'tab') {
    runs.push({ kind: 'tab', ...(sourceId ? { sourceId } : {}), style, text: '' })
    return
  }
  for (const child of node.children) collectRuns(child, paragraph, style, runs)
}

const listDepth = (element: HtmlElement): number => {
  let depth = 0
  let current = element.parent
  while (current) {
    if (current.tag === 'ol' || current.tag === 'ul') depth += 1
    current = current.parent
  }
  return Math.max(0, depth - 1)
}

const listMetadata = (
  element: HtmlElement,
): AuthoredTextParagraph['list'] => {
  let current = element.parent
  while (current) {
    if (current.tag === 'ul') return { type: 'bullet' }
    if (current.tag === 'ol') {
      const startAt = Number.parseInt(current.attributes.start ?? '', 10)
      return {
        ...(Number.isFinite(startAt) ? { startAt } : {}),
        type: 'number',
      }
    }
    current = current.parent
  }
  return undefined
}

const collectParagraphElements = (root: HtmlElement): HtmlElement[] => {
  const paragraphs: HtmlElement[] = []
  const visit = (element: HtmlElement): void => {
    if (BLOCK_TAGS.has(element.tag)) {
      paragraphs.push(element)
      return
    }
    for (const child of element.children) {
      if (child.type === 'element') visit(child)
    }
  }
  visit(root)
  if (paragraphs.length) return paragraphs
  return [root]
}

/**
 * Parses the intentionally small, inert HTML subset emitted by Mona's rich
 * text editor. No browser DOM is used, so the PowerPoint writer remains usable
 * in Electron's main process and in deterministic tests.
 */
export const parseAuthoredText = (html: string): AuthoredTextParagraph[] => (
  collectParagraphElements(parseFragment(html)).map(element => {
    const paragraphStyle = mergedStyle({}, element)
    const runs: AuthoredTextRun[] = []
    for (const child of element.children) collectRuns(child, element, paragraphStyle, runs)
    const sourceId = element.attributes['data-ppt-paragraph-id']
    const authoredLevel = Number.parseInt(element.attributes['data-ppt-level'] ?? '', 10)
    return {
      level: Number.isFinite(authoredLevel) ? authoredLevel : listDepth(element),
      ...(listMetadata(element) ? { list: listMetadata(element) } : {}),
      runs,
      ...(sourceId ? { sourceId } : {}),
      style: paragraphStyle,
    }
  })
)
