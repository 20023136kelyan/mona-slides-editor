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
import { liftListItem, sinkListItem, splitListItem } from 'prosemirror-schema-list'
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
  bind('Enter', chainCommands(
    splitListItem(schema.nodes.list_item!),
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
