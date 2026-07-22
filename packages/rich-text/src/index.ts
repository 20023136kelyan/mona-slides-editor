import { Schema, DOMParser, DOMSerializer } from 'prosemirror-model'
import { EditorState } from 'prosemirror-state'
import { type DirectEditorProps, EditorView } from 'prosemirror-view'

import { buildPlugins, type PluginOptions } from './plugins'
import { schemaMarks, schemaNodes } from './schema'

export const richTextSchema = new Schema({
  nodes: schemaNodes,
  marks: schemaMarks,
})

export const createDocument = (content: string) => {
  const parser = new window.DOMParser()
  const element = parser.parseFromString(`<div>${content}</div>`, 'text/html').body.firstElementChild
  return DOMParser.fromSchema(richTextSchema).parse(element as Element)
}

/** Round-trip HTML through PPTist's ProseMirror schema and DOM serializer. */
export const normalizeRichTextHtml = (content: string) => {
  const container = document.createElement('div')
  const fragment = DOMSerializer.fromSchema(richTextSchema).serializeFragment(createDocument(content).content)
  container.appendChild(fragment)
  return container.innerHTML
}

export const initProsemirrorEditor = (
  dom: Element,
  content: string,
  props: Omit<DirectEditorProps, 'state'>,
  pluginOptions?: PluginOptions,
) => new EditorView(dom, {
  state: EditorState.create({
    doc: createDocument(content),
    plugins: buildPlugins(richTextSchema, pluginOptions),
  }),
  ...props,
})

export type { PluginOptions }
export {
  alignmentCommand,
  executeRichTextActions,
  indentCommand,
  replaceText,
  setListStyle,
  textIndentCommand,
  toggleList,
  type RichTextAction,
  type RichTextCommandName,
} from './commands/index'
export {
  addMark,
  autoSelectAll,
  defaultRichTextAttrs,
  findNodesWithSameMark,
  findParentNode,
  findParentNodeOfType,
  getFontsize,
  getTextAttrs,
  isActiveOfParentNodeType,
  markActive,
  type RichTextAttrs,
  type TextAlign,
} from './utils'
