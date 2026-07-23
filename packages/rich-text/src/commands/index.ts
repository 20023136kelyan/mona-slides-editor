import { lift, toggleMark, wrapIn } from 'prosemirror-commands'
import type { EditorView } from 'prosemirror-view'

import { alignmentCommand } from './set-text-align'
import { indentCommand, textIndentCommand } from './set-text-indent'
import { setListStyle } from './set-list-style'
import { toggleList } from './toggle-list'
import { replaceText } from './replace-text'
import {
  addMark,
  autoSelectAll,
  findNodesWithSameMark,
  getFontsize,
  isActiveOfParentNodeType,
  markActive,
  type RichTextAttrs,
} from '../utils'

export type RichTextCommandName =
  | 'fontname'
  | 'fontsize'
  | 'fontsize-add'
  | 'fontsize-reduce'
  | 'color'
  | 'backcolor'
  | 'bold'
  | 'em'
  | 'underline'
  | 'strikethrough'
  | 'subscript'
  | 'superscript'
  | 'blockquote'
  | 'code'
  | 'align'
  | 'indent'
  | 'textIndent'
  | 'bulletList'
  | 'orderedList'
  | 'clear'
  | 'link'
  | 'insert'
  | 'replace'

export interface RichTextAction {
  command: RichTextCommandName
  value?: string
}

export interface RichTextActionOptions {
  onFontUnavailable?: (fontname: string) => void
}

export const executeRichTextActions = (
  editorView: EditorView,
  action: RichTextAction | readonly RichTextAction[],
  attrs: Pick<RichTextAttrs, 'color' | 'fontsize'>,
  options?: RichTextActionOptions,
) => {
  const actions = Array.isArray(action) ? action : [action]
  for (const item of actions) {
    if (item.command === 'fontname' && item.value !== undefined) {
      autoSelectAll(editorView)
      addMark(editorView, editorView.state.schema.marks.fontname!.create({ fontname: item.value }))
      if (item.value && typeof document !== 'undefined' && !document.fonts.check(`16px ${item.value}`)) {
        options?.onFontUnavailable?.(item.value)
      }
    }
    else if (item.command === 'fontsize' && item.value) {
      autoSelectAll(editorView)
      addMark(editorView, editorView.state.schema.marks.fontsize!.create({ fontsize: item.value }))
      setListStyle(editorView, { key: 'fontsize', value: item.value })
    }
    else if (item.command === 'fontsize-add') {
      // the source editor selects all first, then samples the base size from the
      // resulting selection.
      autoSelectAll(editorView)
      const fontsize = `${getFontsize(editorView) + (item.value ? Number(item.value) : 2)}px`
      addMark(editorView, editorView.state.schema.marks.fontsize!.create({ fontsize }))
      setListStyle(editorView, { key: 'fontsize', value: fontsize })
    }
    else if (item.command === 'fontsize-reduce') {
      autoSelectAll(editorView)
      const fontsize = `${Math.max(12, getFontsize(editorView) - (item.value ? Number(item.value) : 2))}px`
      addMark(editorView, editorView.state.schema.marks.fontsize!.create({ fontsize }))
      setListStyle(editorView, { key: 'fontsize', value: fontsize })
    }
    else if (item.command === 'color' && item.value) {
      autoSelectAll(editorView)
      addMark(editorView, editorView.state.schema.marks.forecolor!.create({ color: item.value }))
      setListStyle(editorView, { key: 'color', value: item.value })
    }
    else if (item.command === 'backcolor' && item.value) {
      autoSelectAll(editorView)
      addMark(editorView, editorView.state.schema.marks.backcolor!.create({ backcolor: item.value }))
    }
    else if (item.command === 'bold') {
      autoSelectAll(editorView)
      toggleMark(editorView.state.schema.marks.strong!)(editorView.state, editorView.dispatch)
    }
    else if (item.command === 'em') {
      autoSelectAll(editorView)
      toggleMark(editorView.state.schema.marks.em!)(editorView.state, editorView.dispatch)
    }
    else if (item.command === 'underline') {
      autoSelectAll(editorView)
      toggleMark(editorView.state.schema.marks.underline!)(editorView.state, editorView.dispatch)
    }
    else if (item.command === 'strikethrough') {
      autoSelectAll(editorView)
      toggleMark(editorView.state.schema.marks.strikethrough!)(editorView.state, editorView.dispatch)
    }
    else if (item.command === 'subscript') {
      toggleMark(editorView.state.schema.marks.subscript!)(editorView.state, editorView.dispatch)
    }
    else if (item.command === 'superscript') {
      toggleMark(editorView.state.schema.marks.superscript!)(editorView.state, editorView.dispatch)
    }
    else if (item.command === 'blockquote') {
      const active = isActiveOfParentNodeType('blockquote', editorView.state)
      if (active) lift(editorView.state, editorView.dispatch)
      else wrapIn(editorView.state.schema.nodes.blockquote!)(editorView.state, editorView.dispatch)
    }
    else if (item.command === 'code') {
      toggleMark(editorView.state.schema.marks.code!)(editorView.state, editorView.dispatch)
    }
    else if (item.command === 'align' && item.value) alignmentCommand(editorView, item.value)
    else if (item.command === 'indent' && item.value) indentCommand(editorView, Number(item.value))
    else if (item.command === 'textIndent' && item.value) textIndentCommand(editorView, Number(item.value))
    else if (item.command === 'bulletList') {
      const { bullet_list: list, list_item: itemType } = editorView.state.schema.nodes
      toggleList(list!, itemType!, item.value || '', {
        color: attrs.color,
        fontsize: attrs.fontsize,
      })(editorView.state, editorView.dispatch)
    }
    else if (item.command === 'orderedList') {
      const { ordered_list: list, list_item: itemType } = editorView.state.schema.nodes
      toggleList(list!, itemType!, item.value || '', {
        color: attrs.color,
        fontsize: attrs.fontsize,
      })(editorView.state, editorView.dispatch)
    }
    else if (item.command === 'clear') {
      autoSelectAll(editorView)
      const { $from, $to } = editorView.state.selection
      editorView.dispatch(editorView.state.tr.removeMark($from.pos, $to.pos))
      setListStyle(editorView, [
        { key: 'fontsize', value: '' },
        { key: 'color', value: '' },
      ])
    }
    else if (item.command === 'link') {
      const markType = editorView.state.schema.marks.link!
      const { from, to } = editorView.state.selection
      const matchingNodes = findNodesWithSameMark(editorView.state.doc, from, to, markType)
      if (matchingNodes) {
        if (item.value) {
          const mark = markType.create({ href: item.value, title: item.value })
          addMark(editorView, mark, {
            from: matchingNodes.from.pos,
            to: matchingNodes.to.pos + 1,
          })
        }
        else {
          editorView.dispatch(editorView.state.tr.removeMark(
            matchingNodes.from.pos,
            matchingNodes.to.pos + 1,
            markType,
          ))
        }
      }
      else if (markActive(editorView.state, markType)) {
        if (item.value) addMark(editorView, markType.create({ href: item.value, title: item.value }))
        else toggleMark(markType)(editorView.state, editorView.dispatch)
      }
      else if (item.value) {
        autoSelectAll(editorView)
        toggleMark(markType, { href: item.value, title: item.value })(editorView.state, editorView.dispatch)
      }
    }
    else if (item.command === 'insert' && item.value) {
      editorView.dispatch(editorView.state.tr.insertText(item.value))
    }
    else if (item.command === 'replace' && item.value) replaceText(editorView, item.value)
  }
  editorView.focus()
}

export { alignmentCommand, indentCommand, replaceText, setListStyle, textIndentCommand, toggleList }
