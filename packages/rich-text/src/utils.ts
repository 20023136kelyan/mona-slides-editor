import { selectAll } from 'prosemirror-commands'
import type { Mark, MarkType, Node, NodeType, ResolvedPos, Schema } from 'prosemirror-model'
import type { EditorState, Selection } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'

export const isList = (node: Node, schema: Schema) => (
  node.type === schema.nodes.bullet_list || node.type === schema.nodes.ordered_list
)

export const autoSelectAll = (view: EditorView) => {
  if (view.state.selection.empty) selectAll(view.state, view.dispatch)
}

export const addMark = (
  editorView: EditorView,
  mark: Mark,
  selection?: { from: number; to: number },
) => {
  if (selection) {
    editorView.dispatch(editorView.state.tr.addMark(selection.from, selection.to, mark))
    return
  }
  const { $from, $to } = editorView.state.selection
  editorView.dispatch(editorView.state.tr.addMark($from.pos, $to.pos, mark))
}

export const findNodesWithSameMark = (
  doc: Node,
  from: number,
  to: number,
  markType: MarkType,
) => {
  let cursor = from
  const finder = (mark: Mark) => mark.type === markType
  let firstMark: Mark | null = null
  let fromNode: Node | null = null
  let toNode: Node | null = null

  while (cursor <= to) {
    const node = doc.nodeAt(cursor)
    if (!node?.marks) return null
    const mark = node.marks.find(finder)
    if (!mark || (firstMark && mark !== firstMark)) return null
    fromNode ||= node
    firstMark ||= mark
    toNode = node
    cursor += 1
  }

  let fromPos = from
  let toPos = to
  cursor = from - 1
  while (cursor > 0) {
    const node = doc.nodeAt(cursor)
    const mark = node?.marks.find(finder)
    if (!mark || mark !== firstMark) break
    fromPos = cursor
    fromNode = node
    cursor -= 1
  }

  cursor = to + 1
  const documentEnd = doc.nodeSize - 2
  while (cursor < documentEnd) {
    const node = doc.nodeAt(cursor)
    const mark = node?.marks.find(finder)
    if (!mark || mark !== firstMark) break
    toPos = cursor
    toNode = node
    cursor += 1
  }

  return {
    mark: firstMark,
    from: { node: fromNode, pos: fromPos },
    to: { node: toNode, pos: toPos },
  }
}

const equalNodeType = (nodeType: NodeType | NodeType[], node: Node) => (
  Array.isArray(nodeType) ? nodeType.includes(node.type) : node.type === nodeType
)

const findParentNodeClosestToPos = ($pos: ResolvedPos, predicate: (node: Node) => boolean) => {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth)
    if (predicate(node)) {
      return {
        pos: $pos.before(depth),
        start: $pos.start(depth),
        depth,
        node,
      }
    }
  }
  return undefined
}

export const findParentNode = (predicate: (node: Node) => boolean) => (
  (selection: Selection) => findParentNodeClosestToPos(selection.$from, predicate)
)

export const findParentNodeOfType = (nodeType: NodeType | NodeType[]) => (
  (selection: Selection) => findParentNode(node => equalNodeType(nodeType, node))(selection)
)

export const isActiveOfParentNodeType = (nodeType: string, state: EditorState) => {
  const node = state.schema.nodes[nodeType]
  return node ? Boolean(findParentNodeOfType(node)(state.selection)) : false
}

export const getLastTextNode = (node: Node | null): Node | null => {
  if (!node) return null
  if (node.type.name === 'text') return node
  return getLastTextNode(node.lastChild)
}

export const getMarkAttrs = (view: EditorView) => {
  const { selection, doc } = view.state
  let node = doc.nodeAt(selection.from) || doc.nodeAt(selection.from - 1)
  node = getLastTextNode(node)
  return node?.marks || []
}

export const getAttrValue = (
  marks: readonly Mark[],
  markType: string,
  attr: string,
): string | null => {
  for (const mark of marks) {
    if (mark.type.name === markType && mark.attrs[attr]) return mark.attrs[attr] as string
  }
  return null
}

export const isActiveMark = (marks: readonly Mark[], markType: string) => (
  marks.some(mark => mark.type.name === markType)
)

export const markActive = (state: EditorState, type: MarkType) => {
  const { from, $from, to, empty } = state.selection
  if (empty) return Boolean(type.isInSet(state.storedMarks || $from.marks()))
  return state.doc.rangeHasMark(from, to, type)
}

export const getAttrValueInSelection = (view: EditorView, attr: string) => {
  const { from, to } = view.state.selection
  let keepChecking = true
  let value = ''
  view.state.doc.nodesBetween(from, to, node => {
    if (keepChecking && node.attrs[attr]) {
      keepChecking = false
      value = node.attrs[attr] as string
    }
    return keepChecking
  })
  return value
}

export type TextAlign = 'left' | 'right' | 'center' | 'justify'

export interface RichTextAttrs {
  bold: boolean
  em: boolean
  underline: boolean
  strikethrough: boolean
  superscript: boolean
  subscript: boolean
  code: boolean
  color: string
  backcolor: string
  fontsize: string
  fontname: string
  link: string
  align: TextAlign
  bulletList: boolean
  orderedList: boolean
  blockquote: boolean
}

interface DefaultAttrs {
  color: string
  backcolor: string
  fontsize: string
  fontname: string
  align: TextAlign
}

const defaultAttrs: DefaultAttrs = {
  color: '#000000',
  backcolor: '',
  fontsize: '16px',
  fontname: '',
  align: 'left',
}

export const getTextAttrs = (
  view: EditorView,
  attrs: Partial<DefaultAttrs> = {},
): RichTextAttrs => {
  const fallback = { ...defaultAttrs, ...attrs }
  const marks = getMarkAttrs(view)
  return {
    bold: isActiveMark(marks, 'strong'),
    em: isActiveMark(marks, 'em'),
    underline: isActiveMark(marks, 'underline'),
    strikethrough: isActiveMark(marks, 'strikethrough'),
    superscript: isActiveMark(marks, 'superscript'),
    subscript: isActiveMark(marks, 'subscript'),
    code: isActiveMark(marks, 'code'),
    color: getAttrValue(marks, 'forecolor', 'color') || fallback.color,
    backcolor: getAttrValue(marks, 'backcolor', 'backcolor') || fallback.backcolor,
    fontsize: getAttrValue(marks, 'fontsize', 'fontsize') || fallback.fontsize,
    fontname: getAttrValue(marks, 'fontname', 'fontname') || fallback.fontname,
    link: getAttrValue(marks, 'link', 'href') || '',
    align: (getAttrValueInSelection(view, 'align') || fallback.align) as TextAlign,
    bulletList: isActiveOfParentNodeType('bullet_list', view.state),
    orderedList: isActiveOfParentNodeType('ordered_list', view.state),
    blockquote: isActiveOfParentNodeType('blockquote', view.state),
  }
}

export const getFontsize = (view: EditorView) => {
  const fontsize = getAttrValue(getMarkAttrs(view), 'fontsize', 'fontsize') || defaultAttrs.fontsize
  return Number.parseInt(fontsize)
}

export const defaultRichTextAttrs: RichTextAttrs = {
  bold: false,
  em: false,
  underline: false,
  strikethrough: false,
  superscript: false,
  subscript: false,
  code: false,
  color: '#000000',
  backcolor: '',
  fontsize: '16px',
  fontname: '',
  link: '',
  align: 'left',
  bulletList: false,
  orderedList: false,
  blockquote: false,
}
