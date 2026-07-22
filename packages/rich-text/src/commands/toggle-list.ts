import type { Node, NodeType } from 'prosemirror-model'
import { liftListItem, wrapInList } from 'prosemirror-schema-list'
import type { EditorState, Transaction } from 'prosemirror-state'

import { findParentNode, isList } from '../utils'

type Attr = Record<string, number | string>

interface TextStyleAttr {
  color?: string
  fontsize?: string
}

export const toggleList = (
  listType: NodeType,
  itemType: NodeType,
  listStyleType: string,
  textStyleAttr: TextStyleAttr = {},
) => (state: EditorState, dispatch?: (tr: Transaction) => void) => {
  const { schema, selection } = state
  const range = selection.$from.blockRange(selection.$to)
  if (!range) return false

  const parentList = findParentNode((node: Node) => isList(node, schema))(selection)
  if (range.depth >= 1 && parentList && range.depth - parentList.depth <= 1) {
    if (parentList.node.type === listType && !listStyleType) {
      return liftListItem(itemType)(state, dispatch)
    }
    if (isList(parentList.node, schema) && listType.validContent(parentList.node.content)) {
      const attrs: Attr = { ...parentList.node.attrs, ...textStyleAttr }
      if (listStyleType) attrs.listStyleType = listStyleType
      const tr = state.tr.setNodeMarkup(parentList.pos, listType, attrs)
      dispatch?.(tr)
      return false
    }
  }

  const attrs: Attr = { ...textStyleAttr }
  if (listStyleType) attrs.listStyleType = listStyleType
  return wrapInList(listType, attrs)(state, dispatch)
}
