import type { Node, NodeType, Schema } from 'prosemirror-model'
import type { Transaction } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'

export const setTextAlign = (tr: Transaction, schema: Schema, input: string) => {
  const { selection, doc } = tr
  const alignment = input || ''
  const allowedNodeTypes = new Set([
    schema.nodes.blockquote,
    schema.nodes.list_item,
    schema.nodes.paragraph,
  ])
  const tasks: Array<{ node: Node; pos: number; nodeType: NodeType }> = []

  doc.nodesBetween(selection.from, selection.to, (node, pos) => {
    if (allowedNodeTypes.has(node.type) && (node.attrs.align || '') !== alignment) {
      tasks.push({ node, pos, nodeType: node.type })
    }
    return true
  })

  for (const { node, pos, nodeType } of tasks) {
    const attrs = { ...node.attrs, align: alignment || null }
    tr = tr.setNodeMarkup(pos, nodeType, attrs, node.marks)
  }
  return tr
}

export const alignmentCommand = (view: EditorView, alignment: string) => {
  const { state } = view
  view.dispatch(setTextAlign(state.tr.setSelection(state.selection), state.schema, alignment))
}
