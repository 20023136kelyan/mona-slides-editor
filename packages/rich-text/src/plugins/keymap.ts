import {
  chainCommands,
  createParagraphNear,
  joinDown,
  joinUp,
  liftEmptyBlock,
  newlineInCode,
  selectParentNode,
  splitBlockKeepMarks,
  toggleMark,
} from 'prosemirror-commands'
import { redo, undo } from 'prosemirror-history'
import { undoInputRule } from 'prosemirror-inputrules'
import type { Schema } from 'prosemirror-model'
import { liftListItem, sinkListItem, splitListItemKeepMarks } from 'prosemirror-schema-list'
import type { Command } from 'prosemirror-state'

export const buildKeymap = (schema: Schema) => {
  const keys: Record<string, Command> = {}
  const bind = (key: string, command: Command) => {
    keys[key] = command 
  }
  bind('Alt-ArrowUp', joinUp)
  bind('Alt-ArrowDown', joinDown)
  bind('Mod-z', undo)
  bind('Mod-y', redo)
  bind('Backspace', undoInputRule)
  bind('Escape', selectParentNode)
  bind('Mod-b', toggleMark(schema.marks.strong!))
  bind('Mod-i', toggleMark(schema.marks.em!))
  bind('Mod-u', toggleMark(schema.marks.underline!))
  bind('Mod-d', toggleMark(schema.marks.strikethrough!))
  bind('Mod-e', toggleMark(schema.marks.code!))
  bind('Mod-;', toggleMark(schema.marks.superscript!))
  bind("Mod-'", toggleMark(schema.marks.subscript!))
  // Every branch of this chain keeps the active marks. Using plain
  // `splitListItem` here while the fallback is `splitBlockKeepMarks` made
  // Enter behave differently inside a list than in a paragraph: the same
  // keystroke dropped bold, colour and size in one and kept them in the other.
  bind('Enter', chainCommands(
    splitListItemKeepMarks(schema.nodes.list_item!),
    newlineInCode,
    createParagraphNear,
    liftEmptyBlock,
    splitBlockKeepMarks,
  ))
  bind('Mod-[', liftListItem(schema.nodes.list_item!))
  bind('Mod-]', sinkListItem(schema.nodes.list_item!))
  bind('Tab', sinkListItem(schema.nodes.list_item!))
  return keys
}
