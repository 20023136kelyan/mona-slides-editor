import {
  ellipsis,
  emDash,
  inputRules,
  InputRule,
  smartQuotes,
  wrappingInputRule,
} from 'prosemirror-inputrules'
import type { NodeType, Schema } from 'prosemirror-model'

const blockQuoteRule = (nodeType: NodeType) => wrappingInputRule(/^\s*>\s$/, nodeType)
const orderedListRule = (nodeType: NodeType) => wrappingInputRule(
  /^(\d+)\.\s$/,
  nodeType,
  match => ({ order: +match[1]! }),
  (match, node) => node.childCount + node.attrs.order === +match[1]!,
)
const bulletListRule = (nodeType: NodeType) => wrappingInputRule(/^\s*([-+*])\s$/, nodeType)
const codeRule = () => new InputRule(/(?:^|\s)((?:`)((?:[^`]+))(?:`))$/, (state, match, start, end) => {
  const tr = state.tr.insertText(`${match[2]} `, start, end)
  return tr.addMark(start, start + match[2]!.length, state.schema.marks.code!.create())
})
const linkRule = () => new InputRule(/(?:https?:\/\/)?[\w-]+(?:\.[\w-]+)+\.?(?:\d+)?(?:\/\S*)?$/, (state, match, start, end) => {
  const value = match[0]!
  const tr = state.tr.insertText(value, start, end)
  return tr.addMark(start, start + value.length, state.schema.marks.link!.create({ href: value, title: value }))
})

export const buildInputRules = (schema: Schema) => inputRules({
  rules: [
    ...smartQuotes,
    ellipsis,
    emDash,
    blockQuoteRule(schema.nodes.blockquote!),
    orderedListRule(schema.nodes.ordered_list!),
    bulletListRule(schema.nodes.bullet_list!),
    codeRule(),
    linkRule(),
  ],
})
