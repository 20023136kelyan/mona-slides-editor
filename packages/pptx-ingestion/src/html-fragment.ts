interface HtmlElement {
  attributes: Array<{ name: string; quote: '"' | '\''; value: string }>
  children: HtmlNode[]
  parent?: HtmlElement
  tag: string
  type: 'element'
  void: boolean
}

interface HtmlText {
  parent?: HtmlElement
  type: 'text'
  value: string
}

type HtmlNode = HtmlElement | HtmlText

const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'meta', 'link'])

const parseAttributes = (source: string): HtmlElement['attributes'] => {
  const attributes: HtmlElement['attributes'] = []
  const expression = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g
  let match: RegExpExecArray | null
  while ((match = expression.exec(source))) {
    attributes.push({
      name: match[1]!,
      quote: match[2] === undefined ? '\'' : '"',
      value: match[2] ?? match[3] ?? match[4] ?? '',
    })
  }
  return attributes
}

const parseFragment = (html: string): HtmlElement => {
  const root: HtmlElement = {
    attributes: [],
    children: [],
    tag: '',
    type: 'element',
    void: false,
  }
  const stack = [root]
  const tokens = /<\/?([A-Za-z][\w:-]*)([^>]*)>|([^<]+)/g
  let match: RegExpExecArray | null
  while ((match = tokens.exec(html))) {
    const parent = stack.at(-1)!
    if (match[3] !== undefined) {
      parent.children.push({ parent, type: 'text', value: match[3] })
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
      void: VOID_TAGS.has(tag) || /\/\s*>$/.test(raw),
    }
    parent.children.push(element)
    if (!element.void) stack.push(element)
  }
  return root
}

const escapeAttribute = (value: string, quote: '"' | '\''): string => (
  quote === '"' ? value.replace(/"/g, '&quot;') : value.replace(/'/g, '&#39;')
)

const serialize = (node: HtmlNode): string => {
  if (node.type === 'text') return node.value
  if (!node.tag) return node.children.map(serialize).join('')
  const attributes = node.attributes.map(attribute => (
    ` ${attribute.name}=${attribute.quote}${escapeAttribute(attribute.value, attribute.quote)}${attribute.quote}`
  )).join('')
  if (node.void) return `<${node.tag}${attributes}>`
  return `<${node.tag}${attributes}>${node.children.map(serialize).join('')}</${node.tag}>`
}

const styleAttribute = (element: HtmlElement): HtmlElement['attributes'][number] | undefined => (
  element.attributes.find(attribute => attribute.name.toLowerCase() === 'style')
)

const parseStyle = (element: HtmlElement): Map<string, string> => {
  const style = new Map<string, string>()
  for (const declaration of styleAttribute(element)?.value.split(';') ?? []) {
    const separator = declaration.indexOf(':')
    if (separator === -1) continue
    const name = declaration.slice(0, separator).trim().toLowerCase()
    const value = declaration.slice(separator + 1).trim()
    if (name && value) style.set(name, value)
  }
  return style
}

const setStyle = (element: HtmlElement, name: string, value: string): void => {
  let attribute = styleAttribute(element)
  if (!attribute) {
    attribute = { name: 'style', quote: '"', value: '' }
    element.attributes.push(attribute)
  }
  const style = parseStyle(element)
  style.set(name, value)
  attribute.value = [...style].map(([property, entry]) => `${property}: ${entry}`).join('; ')
}

const walkElements = (element: HtmlElement, visit: (node: HtmlElement) => void): void => {
  for (const child of element.children) {
    if (child.type === 'text') continue
    visit(child)
    walkElements(child, visit)
  }
}

const textNodesOwnedBy = (item: HtmlElement): HtmlText[] => {
  const result: HtmlText[] = []
  const visit = (node: HtmlNode): void => {
    if (node.type === 'text') {
      if (node.value.replace(/\s+/g, '')) result.push(node)
      return
    }
    if (node !== item && node.tag === 'li') return
    for (const child of node.children) visit(child)
  }
  visit(item)
  return result
}

const containingStyleSpan = (
  text: HtmlText,
  item: HtmlElement,
  property: string,
): HtmlElement | undefined => {
  let parent = text.parent
  while (parent && parent !== item) {
    if (parent.tag === 'span' && parseStyle(parent).has(property)) return parent
    parent = parent.parent
  }
  return undefined
}

const itemStyleValue = (
  item: HtmlElement,
  property: string,
): string => {
  let commonSpan: HtmlElement | undefined
  const texts = textNodesOwnedBy(item)
  if (!texts.length) return ''
  for (const text of texts) {
    const span = containingStyleSpan(text, item, property)
    if (!span || (commonSpan && commonSpan !== span)) return ''
    commonSpan = span
  }
  return commonSpan ? parseStyle(commonSpan).get(property) ?? '' : ''
}

/**
 * DOM-free equivalent of the old list-style promotion.
 *
 * PowerPoint emits list font/color on each run. Mona's editor expects a common
 * list style on the `<ul>/<ol>` when every direct item agrees. The fragment
 * parser deliberately implements only the HTML subset emitted by the PPTX
 * parser; it does not execute markup or depend on a renderer DOM.
 */
export const promotePowerPointListTextStyle = (html: string): string => {
  if (!/<(ul|ol)\b/i.test(html) || (!/font-size\s*:/i.test(html) && !/color\s*:/i.test(html))) {
    return html
  }
  const root = parseFragment(html)
  walkElements(root, list => {
    if (list.tag !== 'ul' && list.tag !== 'ol') return
    const items = list.children.filter(
      (child): child is HtmlElement => child.type === 'element' && child.tag === 'li',
    )
    if (!items.length) return
    for (const property of ['font-size', 'color']) {
      if (parseStyle(list).has(property)) continue
      let common = ''
      for (const item of items) {
        const value = itemStyleValue(item, property)
        if (!value || (common && common !== value)) {
          common = ''
          break
        }
        common = value
      }
      if (common) setStyle(list, property, common)
    }
  })
  return serialize(root)
}

export const firstInlineStyle = (
  html: string,
  tag: string,
): ReadonlyMap<string, string> => {
  const root = parseFragment(html)
  let result = new Map<string, string>()
  walkElements(root, element => {
    if (!result.size && element.tag === tag.toLowerCase()) result = parseStyle(element)
  })
  return result
}
