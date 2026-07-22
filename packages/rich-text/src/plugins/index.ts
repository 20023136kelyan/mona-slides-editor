import { baseKeymap } from 'prosemirror-commands'
import { dropCursor } from 'prosemirror-dropcursor'
import { gapCursor } from 'prosemirror-gapcursor'
import { history } from 'prosemirror-history'
import { keymap } from 'prosemirror-keymap'
import type { Schema } from 'prosemirror-model'

import { buildInputRules } from './inputrules'
import { buildKeymap } from './keymap'
import { placeholderPlugin } from './placeholder'

export interface PluginOptions {
  placeholder?: string
}

export const buildPlugins = (schema: Schema, options?: PluginOptions) => {
  const plugins = [
    buildInputRules(schema),
    keymap(buildKeymap(schema)),
    keymap(baseKeymap),
    dropCursor(),
    gapCursor(),
    history(),
  ]
  if (options?.placeholder) plugins.push(placeholderPlugin(options.placeholder))
  return plugins
}
