import * as txml from 'txml/txml'

function isWhitespaceTextNode(node) {
  return typeof node === 'string' && node.trim() === ''
}

export function simplifyLostLess(children, parentAttributes = {}, orderState = { next: 0 }) {
  const out = {}
  if (!children.length) return out

  if (children.length === 1 && typeof children[0] === 'string') {
    return Object.keys(parentAttributes).length ? {
      attrs: { order: orderState.next++, ...parentAttributes },
      value: children[0],
    } : children[0]
  }
  for (const child of children) {
    if (isWhitespaceTextNode(child)) continue
    if (typeof child !== 'object') return
    if (child.tagName === '?xml') continue

    if (!out[child.tagName]) out[child.tagName] = []

    const kids = simplifyLostLess(child.children || [], child.attributes, orderState)

    if (typeof kids === 'object') {
      if (!kids.attrs) kids.attrs = { order: orderState.next++ }
      else kids.attrs.order = orderState.next++
    }
    if (Object.keys(child.attributes || {}).length) {
      kids.attrs = { ...kids.attrs, ...child.attributes }
    }
    out[child.tagName].push(kids)
  }
  for (const child in out) {
    if (out[child].length === 1) out[child] = out[child][0]
  }

  return out
}

/**
 * Reads one part of the package and returns it as a plain object tree.
 *
 * `decodeEntities` resolves the escapes an OOXML part may contain — the five
 * entities XML predefines, plus decimal and hexadecimal character references —
 * in both text and attribute values. Generated decks escape heavily, so
 * without it a bullet declared `<a:buChar char="&#x2022;"/>` reaches the
 * canvas as the seven literal characters of its own source.
 *
 * txml decodes each source exactly once, which is the property that matters:
 * a deck wanting the literal text `&#x2022;` writes `&amp;#x2022;`, and a
 * second pass would turn that into a bullet and corrupt authored content.
 * Entities declared in a DTD are not expanded, so this opens no
 * entity-expansion path.
 */
export async function readXmlFile(zip, filename) {
  try {
    const data = await zip.file(filename).async('string')
    return simplifyLostLess(txml.parse(data, { decodeEntities: true, keepWhitespace: true }))
  }
  catch {
    return null
  }
}
