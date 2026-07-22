import type { Node } from 'prosemirror-model'
import { Plugin } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'

const isEmptyParagraph = (node: Node) => node.type.name === 'paragraph' && node.nodeSize === 2

export const placeholderPlugin = (placeholder: string) => new Plugin({
  props: {
    decorations(state) {
      const { $from } = state.selection
      if (!isEmptyParagraph($from.parent)) return undefined
      return DecorationSet.create(state.doc, [Decoration.node($from.before(), $from.after(), {
        'data-placeholder': placeholder,
      })])
    },
  },
})
