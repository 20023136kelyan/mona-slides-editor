import type { MarkSpec } from 'prosemirror-model'
import { marks } from 'prosemirror-schema-basic'

const subscript: MarkSpec = {
  excludes: 'subscript',
  parseDOM: [
    { tag: 'sub' },
    { style: 'vertical-align', getAttrs: value => value === 'sub' && null },
  ],
  toDOM: () => ['sub', 0],
}

const superscript: MarkSpec = {
  excludes: 'superscript',
  parseDOM: [
    { tag: 'sup' },
    { style: 'vertical-align', getAttrs: value => value === 'super' && null },
  ],
  toDOM: () => ['sup', 0],
}

const strikethrough: MarkSpec = {
  parseDOM: [
    { tag: 'strike' },
    { style: 'text-decoration', getAttrs: value => value === 'line-through' && null },
    { style: 'text-decoration-line', getAttrs: value => value === 'line-through' && null },
  ],
  toDOM: () => ['span', { style: 'text-decoration-line: line-through;' }, 0],
}

const underline: MarkSpec = {
  parseDOM: [
    { tag: 'u' },
    { style: 'text-decoration', getAttrs: value => value === 'underline' && null },
    { style: 'text-decoration-line', getAttrs: value => value === 'underline' && null },
  ],
  toDOM: () => ['span', { style: 'text-decoration: underline;' }, 0],
}

const forecolor: MarkSpec = {
  attrs: { color: {} },
  inline: true,
  group: 'inline',
  parseDOM: [{ style: 'color', getAttrs: color => color ? { color } : {} }],
  toDOM: mark => ['span', { style: mark.attrs.color ? `color: ${mark.attrs.color};` : '' }, 0],
}

const backcolor: MarkSpec = {
  attrs: { backcolor: {} },
  inline: true,
  group: 'inline',
  parseDOM: [{ style: 'background-color', getAttrs: backcolor => backcolor ? { backcolor } : {} }],
  toDOM: mark => ['span', { style: mark.attrs.backcolor ? `background-color: ${mark.attrs.backcolor};` : '' }, 0],
}

const textgradient: MarkSpec = {
  attrs: { gradient: {} },
  inline: true,
  group: 'inline',
  excludes: '',
  parseDOM: [{
    style: 'background',
    getAttrs: value => value && typeof value === 'string' && value.includes('linear-gradient')
      ? { gradient: value }
      : false,
  }],
  toDOM: mark => ['span', {
    style: mark.attrs.gradient
      ? `background: ${mark.attrs.gradient}; background-clip: text; -webkit-background-clip: text; color: transparent;`
      : '',
  }, 0],
}

const fontsize: MarkSpec = {
  attrs: { fontsize: {} },
  inline: true,
  group: 'inline',
  parseDOM: [{ style: 'font-size', getAttrs: value => value ? { fontsize: value } : {} }],
  toDOM: mark => ['span', { style: mark.attrs.fontsize ? `font-size: ${mark.attrs.fontsize};` : '' }, 0],
}

const fontname: MarkSpec = {
  attrs: { fontname: {} },
  inline: true,
  group: 'inline',
  parseDOM: [{
    style: 'font-family',
    getAttrs: value => ({
      fontname: value && typeof value === 'string' ? value.replace(/["']/g, '') : '',
    }),
  }],
  toDOM: mark => ['span', { style: mark.attrs.fontname ? `font-family: ${mark.attrs.fontname};` : '' }, 0],
}

const link: MarkSpec = {
  attrs: {
    href: {},
    title: { default: null },
    target: { default: '_blank' },
  },
  inclusive: false,
  parseDOM: [{
    tag: 'a[href]',
    getAttrs: dom => ({
      href: (dom as HTMLElement).getAttribute('href'),
      title: (dom as HTMLElement).getAttribute('title'),
    }),
  }],
  toDOM: node => ['a', node.attrs, 0],
}

const mark: MarkSpec = {
  attrs: { index: { default: null } },
  parseDOM: [{ tag: 'mark', getAttrs: dom => ({ index: (dom as HTMLElement).dataset.index }) }],
  toDOM: node => ['mark', { 'data-index': node.attrs.index }, 0],
}

const powerPointSource: MarkSpec = {
  attrs: {
    fieldId: { default: '' },
    fieldType: { default: '' },
    runId: {},
  },
  excludes: '',
  inclusive: false,
  parseDOM: [{
    tag: 'span[data-ppt-run-id]:not([data-ppt-run-kind="tab"])',
    getAttrs: dom => {
      const element = dom as HTMLElement
      return {
        fieldId: element.dataset.pptFieldId || '',
        fieldType: element.dataset.pptFieldType || '',
        runId: element.dataset.pptRunId,
      }
    },
  }],
  toDOM: node => ['span', {
    ...(node.attrs.fieldId ? { 'data-ppt-field-id': node.attrs.fieldId } : {}),
    ...(node.attrs.fieldType ? { 'data-ppt-field-type': node.attrs.fieldType } : {}),
    'data-ppt-run-id': node.attrs.runId,
  }, 0],
}

const { em, strong, code } = marks

export default {
  em,
  strong,
  fontsize,
  fontname,
  code,
  textgradient,
  forecolor,
  backcolor,
  subscript,
  superscript,
  strikethrough,
  underline,
  link,
  mark,
  pptSource: powerPointSource,
}
