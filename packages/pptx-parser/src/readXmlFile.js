import * as txml from 'txml/dist/txml.mjs'

const XML_ENTITIES = {
  amp: '&',
  apos: '\'',
  gt: '>',
  lt: '<',
  quot: '"',
}

const MAX_CODE_POINT = 0x10FFFF

/**
 * Resolves the escapes an OOXML part may contain.
 *
 * txml returns text and attribute values exactly as written, so a part that
 * escapes its content — which generated decks do heavily — reaches the
 * converter as the literal source. A bullet declared
 * `<a:buChar char="&#x2022;"/>` then renders as the seven characters
 * `&#x2022;`, and `authors&apos;` keeps its escape all the way to the canvas.
 *
 * XML predefines exactly five named entities and allows numeric character
 * references. It has no HTML named entities, and entities declared in a DTD
 * are deliberately not resolved here, so this decodes the complete set a
 * conforming part can use without opening an entity-expansion path. One pass
 * handles every form, which keeps an escaped ampersand such as `&amp;#x2022;`
 * resolving to the literal text `&#x2022;` rather than to a bullet.
 */
function decodeXmlEscapes(value) {
  if (!value.includes('&')) return value
  return value.replace(
    /&(?:#(\d+)|#x([\da-f]+)|(amp|apos|gt|lt|quot));/gi,
    (match, decimal, hexadecimal, name) => {
      if (name) return XML_ENTITIES[name.toLowerCase()] ?? match
      const code = decimal ? Number.parseInt(decimal, 10) : Number.parseInt(hexadecimal, 16)
      if (!Number.isInteger(code) || code < 0 || code > MAX_CODE_POINT) return match
      return String.fromCodePoint(code)
    },
  )
}

function decodeAttributes(attributes) {
  if (!attributes) return attributes
  const decoded = {}
  for (const key in attributes) {
    const value = attributes[key]
    decoded[key] = typeof value === 'string' ? decodeXmlEscapes(value) : value
  }
  return decoded
}

function isWhitespaceTextNode(node) {
  return typeof node === 'string' && node.trim() === ''
}

export function simplifyLostLess(children, parentAttributes = {}, orderState = { next: 0 }) {
  const out = {}
  if (!children.length) return out

  if (children.length === 1 && typeof children[0] === 'string') {
    return Object.keys(parentAttributes).length ? {
      attrs: { order: orderState.next++, ...parentAttributes },
      value: decodeXmlEscapes(children[0]),
    } : decodeXmlEscapes(children[0])
  }
  for (const child of children) {
    if (isWhitespaceTextNode(child)) continue
    if (typeof child !== 'object') return
    if (child.tagName === '?xml') continue

    if (!out[child.tagName]) out[child.tagName] = []

    const attributes = decodeAttributes(child.attributes)
    const kids = simplifyLostLess(child.children || [], attributes, orderState)

    if (typeof kids === 'object') {
      if (!kids.attrs) kids.attrs = { order: orderState.next++ }
      else kids.attrs.order = orderState.next++
    }
    if (Object.keys(child.attributes || {}).length) {
      kids.attrs = { ...kids.attrs, ...attributes }
    }
    out[child.tagName].push(kids)
  }
  for (const child in out) {
    if (out[child].length === 1) out[child] = out[child][0]
  }

  return out
}

export async function readXmlFile(zip, filename) {
  try {
    const data = await zip.file(filename).async('string')
    return simplifyLostLess(txml.parse(data, { keepWhitespace: true }))
  }
  catch {
    return null
  }
}
