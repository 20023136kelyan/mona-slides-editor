import type { Schema } from 'prosemirror-model'
import { AllSelection, TextSelection, type Transaction } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'

import { isList } from '../utils'

type IndentKey = 'indent' | 'textIndent'

const setNodeIndentMarkup = (
  tr: Transaction,
  pos: number,
  delta: number,
  indentKey: IndentKey,
) => {
  const node = tr.doc.nodeAt(pos)
  if (!node) return tr
  const indent = Math.min(8, Math.max(0, (Number(node.attrs[indentKey]) || 0) + delta))
  if (indent === node.attrs[indentKey]) return tr
  return tr.setNodeMarkup(pos, node.type, {
    ...node.attrs,
    [indentKey]: indent,
    ...(indentKey === 'indent' ? { paddingLeft: '' } : { textIndentCss: '' }),
  }, node.marks)
}

const setIndent = (
  input: Transaction,
  schema: Schema,
  delta: number,
  indentKey: IndentKey,
) => {
  let tr = input
  const { selection } = tr
  if (!(selection instanceof TextSelection || selection instanceof AllSelection)) return tr

  tr.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
    if (node.type.name === 'paragraph' || node.type.name === 'blockquote') {
      tr = setNodeIndentMarkup(tr, pos, delta, indentKey)
      return false
    }
    if (isList(node, schema)) return false
    return true
  })
  return tr
}

const runIndent = (view: EditorView, delta: number, indentKey: IndentKey) => {
  const { state } = view
  const tr = setIndent(state.tr.setSelection(state.selection), state.schema, delta, indentKey)
  if (!tr.docChanged) return false
  view.dispatch(tr)
  return true
}

export const indentCommand = (view: EditorView, delta: number) => runIndent(view, delta, 'indent')
export const textIndentCommand = (view: EditorView, delta: number) => runIndent(view, delta, 'textIndent')
