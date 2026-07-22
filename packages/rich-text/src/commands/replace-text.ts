import type { Mark, Node as ProseMirrorNode, NodeType } from 'prosemirror-model'
import type { EditorView } from 'prosemirror-view'

export const replaceText = (view: EditorView, newText: string) => {
  const { state } = view
  const { schema, doc } = state
  let marks: Mark[] = []
  let nodeType: NodeType = schema.nodes.paragraph!

  if (doc.content.size > 2) {
    const firstCharacter = doc.resolve(1)
    marks = [...firstCharacter.marks()]
    nodeType = firstCharacter.parent.type
  }

  const nodes: ProseMirrorNode[] = newText.split('\n').map(line => {
    if (line.trim() === '') return nodeType.create()
    return nodeType.create(null, schema.text(line, marks))
  })
  view.dispatch(state.tr.replaceWith(0, doc.content.size, nodes))
}
