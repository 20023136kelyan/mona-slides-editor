import type { EditorView } from 'prosemirror-view'

import { isList } from '../utils'

interface Style {
  key: string
  value: string
}

export const setListStyle = (view: EditorView, style: Style | Style[]) => {
  const { state } = view
  const { schema, selection } = state
  const tr = state.tr.setSelection(selection)
  const { from, to } = selection

  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (isList(node, schema) && from - 3 <= pos && to + 3 >= pos + node.nodeSize) {
      const styles = Array.isArray(style) ? style : [style]
      for (const item of styles) {
        if (item) tr.setNodeAttribute(pos, item.key, item.value)
      }
    }
    return false
  })

  view.dispatch(tr)
}
