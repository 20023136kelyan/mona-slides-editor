import type { Node, NodeSpec } from 'prosemirror-model'
import { nodes } from 'prosemirror-schema-basic'
import { listItem as baseListItem } from 'prosemirror-schema-list'

type Attr = Record<string, number | string>

const orderedList: NodeSpec = {
  attrs: {
    order: { default: 1 },
    listStyleType: { default: '' },
    fontsize: { default: '' },
    color: { default: '' },
    // An imported PowerPoint list indents its text by the authored margin.
    // Without an attribute for it the editing surface drops the indent and
    // every marker collapses against its text.
    indent: { default: '' },
    pptLevel: { default: '' },
  },
  content: 'list_item+',
  group: 'block',
  parseDOM: [{
    tag: 'ol',
    getAttrs: dom => {
      const element = dom as HTMLElement
      const order = (element.hasAttribute('start') ? element.getAttribute('start') : 1) || 1
      const attr: Attr = { order: +order }
      const { listStyleType, fontSize, color, paddingLeft } = element.style
      if (listStyleType) attr.listStyleType = listStyleType
      if (fontSize) attr.fontsize = fontSize
      if (color) attr.color = color
      if (paddingLeft) attr.indent = paddingLeft
      if (element.dataset.pptLevel) attr.pptLevel = element.dataset.pptLevel
      return attr
    },
  }],
  toDOM: (node: Node) => {
    const { order, listStyleType, fontsize, color, indent, pptLevel } = node.attrs
    let style = ''
    if (listStyleType) style += `list-style-type: ${listStyleType};`
    if (fontsize) style += `font-size: ${fontsize};`
    if (color) style += `color: ${color};`
    if (indent) style += `padding-left: ${indent};`
    const attr: Attr = { style }
    if (order !== 1) attr.start = order
    if (pptLevel !== '') attr['data-ppt-level'] = pptLevel
    return ['ol', attr, 0]
  },
}

const bulletList: NodeSpec = {
  attrs: {
    listStyleType: { default: '' },
    fontsize: { default: '' },
    color: { default: '' },
    // An imported PowerPoint list indents its text by the authored margin.
    // Without an attribute for it the editing surface drops the indent and
    // every marker collapses against its text.
    indent: { default: '' },
    pptLevel: { default: '' },
  },
  content: 'list_item+',
  group: 'block',
  parseDOM: [{
    tag: 'ul',
    getAttrs: dom => {
      const attr: Attr = {}
      const { listStyleType, fontSize, color, paddingLeft } = (dom as HTMLElement).style
      if (listStyleType) attr.listStyleType = listStyleType
      if (fontSize) attr.fontsize = fontSize
      if (color) attr.color = color
      if (paddingLeft) attr.indent = paddingLeft
      if ((dom as HTMLElement).dataset.pptLevel) attr.pptLevel = (dom as HTMLElement).dataset.pptLevel!
      return attr
    },
  }],
  toDOM: (node: Node) => {
    const { listStyleType, fontsize, color, indent, pptLevel } = node.attrs
    let style = ''
    if (listStyleType) style += `list-style-type: ${listStyleType};`
    if (fontsize) style += `font-size: ${fontsize};`
    if (color) style += `color: ${color};`
    if (indent) style += `padding-left: ${indent};`
    const attr: Attr = { style }
    if (pptLevel !== '') attr['data-ppt-level'] = pptLevel
    return ['ul', attr, 0]
  },
}

const listItem: NodeSpec = {
  ...baseListItem,
  content: 'paragraph block*',
  group: 'block',
}

const paragraph: NodeSpec = {
  attrs: {
    align: { default: '' },
    color: { default: '' },
    direction: { default: '' },
    fontFamily: { default: '' },
    fontSize: { default: '' },
    fontStyle: { default: '' },
    fontVariantCaps: { default: '' },
    fontWeight: { default: '' },
    indent: { default: 0 },
    letterSpacing: { default: '' },
    lineHeight: { default: '' },
    marginBottom: { default: '' },
    marginTop: { default: '' },
    paddingLeft: { default: '' },
    pptLevel: { default: '' },
    pptParagraphId: { default: '' },
    textDecorationLine: { default: '' },
    textIndent: { default: 0 },
    textIndentCss: { default: '' },
    textTransform: { default: '' },
    unicodeBidi: { default: '' },
  },
  content: 'inline*',
  group: 'block',
  parseDOM: [
    {
      tag: 'p',
      getAttrs: dom => {
        const element = dom as HTMLElement
        const {
          color,
          direction,
          fontFamily,
          fontSize,
          fontStyle,
          fontVariantCaps,
          fontWeight,
          letterSpacing,
          lineHeight,
          marginBottom,
          marginTop,
          paddingLeft,
          textAlign,
          textDecorationLine,
          textIndent,
          textTransform,
          unicodeBidi,
        } = element.style
        let align = element.getAttribute('align') || textAlign || ''
        align = /(left|right|center|justify)/.test(align) ? align : ''
        let textIndentLevel = 0
        if (/em/.test(textIndent)) textIndentLevel = parseInt(textIndent)
        else if (/px/.test(textIndent)) {
          textIndentLevel = Math.floor(parseInt(textIndent) / 16)
          if (!textIndentLevel) textIndentLevel = 1
        }
        return {
          align,
          color,
          direction,
          fontFamily,
          fontSize,
          fontStyle,
          fontVariantCaps,
          fontWeight,
          indent: +(element.getAttribute('data-indent') || 0),
          letterSpacing,
          lineHeight,
          marginBottom,
          marginTop,
          paddingLeft,
          pptLevel: element.dataset.pptLevel || '',
          pptParagraphId: element.dataset.pptParagraphId || '',
          textDecorationLine,
          textIndent: textIndentLevel,
          textIndentCss: textIndent,
          textTransform,
          unicodeBidi,
        }
      },
    },
    { tag: 'img', ignore: true },
    { tag: 'pre', skip: true },
  ],
  toDOM: (node: Node) => {
    const {
      align,
      color,
      direction,
      fontFamily,
      fontSize,
      fontStyle,
      fontVariantCaps,
      fontWeight,
      indent,
      letterSpacing,
      lineHeight,
      marginBottom,
      marginTop,
      paddingLeft,
      pptLevel,
      pptParagraphId,
      textDecorationLine,
      textIndent,
      textIndentCss,
      textTransform,
      unicodeBidi,
    } = node.attrs
    let style = ''
    if (align && align !== 'left') style += `text-align: ${align};`
    if (direction) style += `direction: ${direction};`
    if (unicodeBidi) style += `unicode-bidi: ${unicodeBidi};`
    if (paddingLeft) style += `padding-left: ${paddingLeft};`
    if (textIndentCss || textIndent) style += `text-indent: ${textIndentCss || `${textIndent}em`};`
    if (lineHeight) style += `line-height: ${lineHeight};`
    if (marginTop) style += `margin-top: ${marginTop};`
    if (marginBottom) style += `margin-bottom: ${marginBottom};`
    if (fontFamily) style += `font-family: ${fontFamily};`
    if (fontSize) style += `font-size: ${fontSize};`
    if (color) style += `color: ${color};`
    if (fontWeight) style += `font-weight: ${fontWeight};`
    if (fontStyle) style += `font-style: ${fontStyle};`
    if (textDecorationLine) style += `text-decoration-line: ${textDecorationLine};`
    if (letterSpacing) style += `letter-spacing: ${letterSpacing};`
    if (textTransform) style += `text-transform: ${textTransform};`
    if (fontVariantCaps) style += `font-variant-caps: ${fontVariantCaps};`
    const attr: Attr = { style }
    if (indent) attr['data-indent'] = indent
    if (pptLevel !== '') attr['data-ppt-level'] = pptLevel
    if (pptParagraphId) attr['data-ppt-paragraph-id'] = pptParagraphId
    return ['p', attr, 0]
  },
}

const hardBreak: NodeSpec = {
  attrs: {
    pptRunId: { default: '' },
  },
  group: 'inline',
  inline: true,
  parseDOM: [{
    tag: 'br',
    getAttrs: dom => ({
      pptRunId: (dom as HTMLElement).dataset.pptRunId || '',
    }),
  }],
  selectable: false,
  toDOM: node => [
    'br',
    node.attrs.pptRunId ? { 'data-ppt-run-id': node.attrs.pptRunId } : {},
  ],
}

const powerPointTab: NodeSpec = {
  atom: true,
  attrs: {
    pptRunId: { default: '' },
    width: { default: '' },
  },
  group: 'inline',
  inline: true,
  parseDOM: [{
    tag: 'span[data-ppt-run-kind="tab"]',
    getAttrs: dom => {
      const element = dom as HTMLElement
      return {
        pptRunId: element.dataset.pptRunId || '',
        width: element.style.width || '',
      }
    },
  }],
  selectable: true,
  toDOM: node => [
    'span',
    {
      ...(node.attrs.pptRunId ? { 'data-ppt-run-id': node.attrs.pptRunId } : {}),
      'data-ppt-run-kind': 'tab',
      style: `display: inline-block;${node.attrs.width ? ` width: ${node.attrs.width};` : ''}`,
    },
  ],
}

const { doc, blockquote, text } = nodes

export default {
  doc,
  paragraph,
  blockquote,
  text,
  hard_break: hardBreak,
  ppt_tab: powerPointTab,
  ordered_list: orderedList,
  bullet_list: bulletList,
  list_item: listItem,
}
