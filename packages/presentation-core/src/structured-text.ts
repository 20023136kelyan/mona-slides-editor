import type {
  StructuredTextBody,
  StructuredTextBodyProperties,
  StructuredTextColor,
  StructuredTextParagraph,
  StructuredTextParagraphProperties,
  StructuredTextRun,
  StructuredTextRunProperties,
  StructuredTextSpacing,
} from './model'
import type {
  PowerPointColorMap,
  PowerPointMasterTextStyles,
  PowerPointTextStyleLevel,
  PowerPointTheme,
} from './source'

export interface StructuredTextCompileContext {
  colorMap?: PowerPointColorMap
  defaultTextStyle?: PowerPointTextStyleLevel[]
  fallbackColor: string
  fallbackFontName: string
  layoutBody?: StructuredTextBody
  masterBody?: StructuredTextBody
  masterTextStyles?: PowerPointMasterTextStyles
  slideNumber: number
  textStyleKind: 'body' | 'other' | 'title'
  theme?: PowerPointTheme
}

export interface CompiledStructuredText {
  body: StructuredTextBody
  bodyProperties: StructuredTextBodyProperties
  defaultColor: string
  defaultFontName: string
  html: string
}

const mergeRunProperties = (
  ...values: Array<StructuredTextRunProperties | undefined>
): StructuredTextRunProperties => Object.assign({}, ...values.filter(Boolean))

const mergeParagraphProperties = (
  ...values: Array<StructuredTextParagraphProperties | undefined>
): StructuredTextParagraphProperties => {
  const filtered = values.filter((value): value is StructuredTextParagraphProperties => Boolean(value))
  const merged = Object.assign({}, ...filtered)
  const defaultRun = mergeRunProperties(...filtered.map(value => value.defaultRun))
  if (Object.keys(defaultRun).length) merged.defaultRun = defaultRun
  return merged
}

const legacyStyleParagraph = (
  style: PowerPointTextStyleLevel | undefined,
): StructuredTextParagraphProperties | undefined => {
  if (!style) return undefined
  if (style.paragraph) return style.paragraph
  const paragraph: StructuredTextParagraphProperties = {
    ...(style.alignment ? { alignment: style.alignment } : {}),
    ...(style.bulletCharacter ? { bullet: { character: style.bulletCharacter, type: 'character' } } : {}),
    ...(style.indent !== undefined ? { indent: style.indent } : {}),
    ...(style.marginLeft !== undefined ? { marginLeft: style.marginLeft } : {}),
    ...(style.rightToLeft !== undefined ? { rightToLeft: style.rightToLeft } : {}),
  }
  return Object.keys(paragraph).length ? paragraph : undefined
}

const legacyStyleRun = (
  style: PowerPointTextStyleLevel | undefined,
): StructuredTextRunProperties | undefined => {
  if (!style) return undefined
  if (style.run) return style.run
  const run: StructuredTextRunProperties = {
    ...(style.bold !== undefined ? { bold: style.bold } : {}),
    ...(style.fontColor
      ? { color: { type: style.fontColor.type, value: style.fontColor.value } }
      : {}),
    ...(style.fontFamily ? { fontFamily: style.fontFamily } : {}),
    ...(style.fontSize !== undefined ? { fontSize: style.fontSize } : {}),
    ...(style.italic !== undefined ? { italic: style.italic } : {}),
    ...(style.language ? { language: style.language } : {}),
    ...(style.underline ? { underline: style.underline } : {}),
  }
  return Object.keys(run).length ? run : undefined
}

const levelStyle = (
  styles: readonly PowerPointTextStyleLevel[] | undefined,
  level: number,
) => styles?.find(style => style.level === level + 1)

const bodyLevelParagraph = (
  body: StructuredTextBody | undefined,
  level: number,
): StructuredTextParagraphProperties | undefined => {
  if (!body) return undefined
  const promptParagraph = body.paragraphs.find(paragraph => paragraph.level === level)
    ?? body.paragraphs[0]
  return mergeParagraphProperties(
    body.defaultParagraph,
    body.listStyle.find(style => style.level === level)?.paragraph,
    promptParagraph?.properties,
  )
}

const masterStyleForKind = (
  styles: PowerPointMasterTextStyles | undefined,
  kind: StructuredTextCompileContext['textStyleKind'],
) => styles?.[kind]

const escapeHtml = (value: string): string => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')

// Runs keep their authored spacing verbatim. Escaping every space to &nbsp;
// would preserve the spacing but remove every soft wrap opportunity, leaving
// the paragraph as one unbreakable token that the browser then breaks
// mid-word. Exact spacing is preserved by `white-space: pre-wrap` on the
// compiled paragraph instead, which keeps runs and leading indentation intact
// while still wrapping at spaces the way PowerPoint does.
const escapeText = (value: string): string => escapeHtml(value)
  .replace(/\r\n?|\n/g, '<br>')

const normalizeHex = (value: string | undefined): string | undefined => {
  if (!value) return undefined
  if (/^#[\da-f]{3,8}$/i.test(value)) return value
  if (/^[\da-f]{6}$/i.test(value)) return `#${value}`
  return undefined
}

const presetColors: Record<string, string> = {
  black: '#000000',
  blue: '#0000ff',
  cyan: '#00ffff',
  dkBlue: '#00008b',
  dkGray: '#a9a9a9',
  dkGreen: '#006400',
  dkRed: '#8b0000',
  gray: '#808080',
  green: '#008000',
  ltBlue: '#add8e6',
  ltGray: '#d3d3d3',
  ltGreen: '#90ee90',
  red: '#ff0000',
  white: '#ffffff',
  yellow: '#ffff00',
}

const defaultColorMap: PowerPointColorMap = {
  accent1: 'accent1',
  accent2: 'accent2',
  accent3: 'accent3',
  accent4: 'accent4',
  accent5: 'accent5',
  accent6: 'accent6',
  bg1: 'lt1',
  bg2: 'lt2',
  folHlink: 'folHlink',
  hlink: 'hlink',
  tx1: 'dk1',
  tx2: 'dk2',
}

const colorWithAlpha = (color: string, alpha: number | undefined): string => {
  if (alpha === undefined || alpha >= 100) return color
  const hex = normalizeHex(color)
  if (!hex || hex.length !== 7) return color
  return `rgba(${Number.parseInt(hex.slice(1, 3), 16)}, ${Number.parseInt(hex.slice(3, 5), 16)}, ${Number.parseInt(hex.slice(5, 7), 16)}, ${Math.max(0, alpha) / 100})`
}

const resolveColor = (
  color: StructuredTextColor | undefined,
  context: StructuredTextCompileContext,
): string | undefined => {
  if (!color) return undefined
  if (color.type === 'srgb' || color.type === 'system') {
    return colorWithAlpha(normalizeHex(color.value) ?? color.value, color.alpha)
  }
  if (color.type === 'preset') {
    return colorWithAlpha(presetColors[color.value] ?? color.value, color.alpha)
  }
  const mapped = context.colorMap?.[color.value] ?? defaultColorMap[color.value] ?? color.value
  const themeColor = context.theme?.colors.find(candidate => candidate.name === mapped)
  const resolved = normalizeHex(themeColor?.value) ?? normalizeHex(mapped)
  return resolved ? colorWithAlpha(resolved, color.alpha) : undefined
}

const scriptForLanguage = (language: string | undefined): string | undefined => {
  if (!language) return undefined
  const normalized = language.toLowerCase()
  if (normalized.startsWith('zh')) return normalized.includes('tw') || normalized.includes('hk') ? 'Hant' : 'Hans'
  if (normalized.startsWith('ja')) return 'Jpan'
  if (normalized.startsWith('ko')) return 'Hang'
  if (normalized.startsWith('ar') || normalized.startsWith('fa') || normalized.startsWith('ur')) return 'Arab'
  if (normalized.startsWith('he')) return 'Hebr'
  if (normalized.startsWith('th')) return 'Thai'
  return undefined
}

const resolveThemeFont = (
  token: string | undefined,
  language: string | undefined,
  context: StructuredTextCompileContext,
): string | undefined => {
  const familyKind = token?.startsWith('+mj') || (!token && context.textStyleKind === 'title')
    ? 'majorFont'
    : 'minorFont'
  const scheme = context.theme?.[familyKind]
  if (token && !token.startsWith('+')) return token
  const script = scriptForLanguage(language)
  if (script) {
    const supplemental = scheme?.supplemental.find(candidate => candidate.script === script)?.typeface
    if (supplemental) return supplemental
  }
  if (token?.endsWith('-ea')) return scheme?.eastAsian || scheme?.latin
  if (token?.endsWith('-cs')) return scheme?.complexScript || scheme?.latin
  return scheme?.latin
    ?? (familyKind === 'majorFont' ? context.theme?.majorLatinFont : context.theme?.minorLatinFont)
}

const resolvedRunProperties = (
  properties: StructuredTextRunProperties,
  context: StructuredTextCompileContext,
): StructuredTextRunProperties => {
  const language = properties.language ?? properties.alternativeLanguage
  const script = scriptForLanguage(language)
  const authoredFamily = script === 'Arab' || script === 'Hebr'
    ? properties.complexScriptFontFamily ?? properties.fontFamily
    : script
      ? properties.eastAsianFontFamily ?? properties.fontFamily
      : properties.fontFamily
  const fontFamily = resolveThemeFont(authoredFamily, language, context)
  const color = resolveColor(properties.color, context)
  return {
    ...properties,
    ...(color ? { color: { type: 'srgb', value: color } } : {}),
    ...(fontFamily ? { fontFamily } : {}),
  }
}

const spacingStyle = (
  spacing: StructuredTextSpacing | undefined,
  scale: number,
): string | undefined => {
  if (!spacing) return undefined
  return spacing.unit === 'points'
    ? `${spacing.value * scale}px`
    : `${spacing.value / 100}em`
}

const alignmentMap: Record<string, string> = {
  ctr: 'center',
  dist: 'justify',
  just: 'justify',
  justLow: 'justify',
  l: 'left',
  r: 'right',
  thaiDist: 'justify',
}

const paragraphStyle = (
  properties: StructuredTextParagraphProperties,
  scale: number,
  lineSpacingReduction: number,
  inListItem: boolean,
): string => {
  const styles: string[] = []
  if (properties.alignment) styles.push(`text-align:${alignmentMap[properties.alignment] ?? properties.alignment}`)
  if (properties.rightToLeft) styles.push('direction:rtl', 'unicode-bidi:plaintext')
  // A bulleted paragraph's indent belongs to its list, which owns the space
  // the marker hangs in; applying it here as well would double it.
  if (!inListItem && properties.marginLeft !== undefined) styles.push(`padding-left:${properties.marginLeft * scale}px`)
  if (!inListItem && properties.indent !== undefined) styles.push(`text-indent:${properties.indent * scale}px`)
  if (properties.lineSpacing) {
    const reduction = Math.max(0, 1 - lineSpacingReduction / 100)
    if (properties.lineSpacing.unit === 'percent') {
      const value = properties.lineSpacing.value / 100 * reduction
      styles.push(`line-height:${Math.max(0, value)}`)
    }
    else styles.push(`line-height:${Math.max(0, properties.lineSpacing.value * scale * reduction)}px`)
  }
  const before = spacingStyle(properties.spaceBefore, scale)
  const after = spacingStyle(properties.spaceAfter, scale)
  if (before) styles.push(`margin-top:${before}`)
  if (after) styles.push(`margin-bottom:${after}`)
  return styles.join(';')
}

const serifFamilies = /^(baskerville|book antiqua|bookman|cambria|caslon|century schoolbook|constantia|didot|garamond|georgia|minion|palatino|rockwell|sabon|times)/i
const monospaceFamilies = /^(consolas|courier|lucida console|menlo|monaco|sf mono|source code)/i

/**
 * A run names one family. When that family is unavailable the browser falls
 * back to the document default — a serif — because an inline declaration
 * replaces the inherited stack rather than extending it. Naming the matching
 * generic keeps an unresolved face in the right category instead of turning
 * every corporate sans into Times.
 */
const fontFamilyStack = (family: string): string => {
  const generic = monospaceFamilies.test(family)
    ? 'monospace'
    : serifFamilies.test(family) ? 'serif' : 'sans-serif'
  return `${JSON.stringify(family)}, ${generic}`
}

const runStyle = (
  properties: StructuredTextRunProperties,
  scale: number,
  fontScale: number,
): string => {
  const styles: string[] = []
  if (properties.fontFamily) styles.push(`font-family:${fontFamilyStack(properties.fontFamily)}`)
  if (properties.fontSize !== undefined) styles.push(`font-size:${properties.fontSize * scale * fontScale}px`)
  if (properties.color?.value) styles.push(`color:${properties.color.value}`)
  if (properties.bold !== undefined) styles.push(`font-weight:${properties.bold ? '700' : '400'}`)
  if (properties.italic !== undefined) styles.push(`font-style:${properties.italic ? 'italic' : 'normal'}`)
  const decorations = [
    properties.underline && properties.underline !== 'none' ? 'underline' : '',
    properties.strike && properties.strike !== 'noStrike' ? 'line-through' : '',
  ].filter(Boolean)
  if (decorations.length) styles.push(`text-decoration-line:${decorations.join(' ')}`)
  if (properties.spacing !== undefined) styles.push(`letter-spacing:${properties.spacing * scale}px`)
  if (properties.capitalization === 'all') styles.push('text-transform:uppercase')
  else if (properties.capitalization === 'small') styles.push('font-variant-caps:small-caps')
  if (properties.baseline !== undefined && properties.baseline !== 0) {
    styles.push(`vertical-align:${properties.baseline > 0 ? 'super' : 'sub'}`)
  }
  return styles.join(';')
}

const numberingStyle: Record<string, string> = {
  alphaLcParenBoth: 'lower-alpha',
  alphaLcParenR: 'lower-alpha',
  alphaLcPeriod: 'lower-alpha',
  alphaUcParenBoth: 'upper-alpha',
  alphaUcParenR: 'upper-alpha',
  alphaUcPeriod: 'upper-alpha',
  arabicParenBoth: 'decimal',
  arabicParenR: 'decimal',
  arabicPeriod: 'decimal',
  romanLcParenBoth: 'lower-roman',
  romanLcParenR: 'lower-roman',
  romanLcPeriod: 'lower-roman',
  romanUcParenBoth: 'upper-roman',
  romanUcParenR: 'upper-roman',
  romanUcPeriod: 'upper-roman',
}

/** En space: a fixed half-em gap that does not collapse. */
const BULLET_SEPARATOR = '\u2002'

const symbolBulletFonts = new Set([
  'monotype sorts',
  'symbol',
  'webdings',
  'wingdings',
  'wingdings 2',
  'wingdings 3',
  'zapfdingbats',
])

// The glyph a symbol face draws for a codepoint, expressed in Unicode. These
// faces are licensed and cannot be fetched, so without the mapping a deck's
// square bullet renders as a literal section sign.
const symbolBulletEquivalents: Record<string, string> = {
  '¨': '□',
  '·': '•',
  l: '●',
  n: '■',
  u: '◆',
  v: '❖',
  '§': '▪',
  Ø: '➢',
  û: '✘',
  ü: '✔',
}

/**
 * Resolves a bullet character to something the rendering font can actually
 * draw. PowerPoint stores symbol-face bullets either as the raw character or
 * offset into the private use area, so both forms are normalised before the
 * lookup.
 */
const resolveBulletCharacter = (
  bullet: NonNullable<StructuredTextParagraphProperties['bullet']>,
): { authoredFont: boolean; character: string } => {
  const character = bullet.character ?? ''
  if (!character || !bullet.fontFamily || !symbolBulletFonts.has(bullet.fontFamily.toLowerCase())) {
    return { authoredFont: true, character }
  }
  const code = character.codePointAt(0) ?? 0
  const normalized = code >= 0xF000 && code <= 0xF0FF ? String.fromCodePoint(code - 0xF000) : character
  const equivalent = symbolBulletEquivalents[normalized]
  // A substituted glyph must render in the body font, not the symbol face it
  // was translated out of.
  return equivalent ? { authoredFont: false, character: equivalent } : { authoredFont: true, character }
}

/**
 * Styles the list so its markers match the text they belong to.
 *
 * `::marker` inherits from its list item, and a list item inherits from the
 * list, so the marker's size and colour are set on the list itself rather than
 * through a rule of their own. A bullet with no authored size is the size of
 * its paragraph's text — leaving it unset makes markers render at whatever the
 * container's font size happens to be, which is why they came out tiny.
 *
 * The indent goes here too. PowerPoint puts the text at `marL`, and expressing
 * that as the list's own padding keeps it in one place, where the editing
 * surface's schema can preserve it.
 */
const bulletListStyle = (
  bullet: NonNullable<StructuredTextParagraphProperties['bullet']>,
  properties: StructuredTextParagraphProperties,
  markerFontSize: number | undefined,
  context: StructuredTextCompileContext,
  scale: number,
  fontScale: number,
  authoredFont: boolean,
): string => {
  const styles: string[] = []
  if (bullet.size?.unit === 'percent' && markerFontSize === undefined) {
    // Without a known text size the authored percentage still resolves, just
    // against whatever the list inherits.
    styles.push(`font-size:${bullet.size.value}%`)
  }
  else {
    const size = bullet.size?.unit === 'percent'
      ? markerFontSize! * bullet.size.value / 100
      : bullet.size?.unit === 'points'
        ? bullet.size.value
        : markerFontSize
    if (size !== undefined) styles.push(`font-size:${size * scale * fontScale}px`)
  }
  const color = resolveColor(bullet.color, context)
  if (color) styles.push(`color:${color}`)
  if (bullet.fontFamily && authoredFont) styles.push(`font-family:${JSON.stringify(bullet.fontFamily)}`)
  if (properties.marginLeft) styles.push(`padding-left:${properties.marginLeft * scale}px`)
  return styles.join(';')
}

const materializedFieldText = (
  run: StructuredTextRun,
  context: StructuredTextCompileContext,
): string => {
  const fieldType = run.fieldType?.toLowerCase()
  if (fieldType?.includes('slidenum')) return String(context.slideNumber)
  return run.text ?? ''
}

const renderRun = (
  run: StructuredTextRun,
  scale: number,
  fontScale: number,
  defaultTabSize: number,
  context: StructuredTextCompileContext,
): string => {
  const source = `data-ppt-run-id="${escapeHtml(run.sourceId)}"`
  const style = runStyle(run.properties ?? {}, scale, fontScale)
  if (run.kind === 'break') return `<br ${source}>`
  if (run.kind === 'tab') {
    return `<span ${source} data-ppt-run-kind="tab" style="display:inline-block;width:${defaultTabSize * scale}px"></span>`
  }
  const value = run.kind === 'field' ? materializedFieldText(run, context) : run.text ?? ''
  const field = run.kind === 'field'
    ? ` data-ppt-field-id="${escapeHtml(run.fieldId ?? '')}" data-ppt-field-type="${escapeHtml(run.fieldType ?? '')}"`
    : ''
  const content = escapeText(value)
  const span = `<span ${source}${field}${style ? ` style="${escapeHtml(style)}"` : ''}>${content}</span>`
  return run.hyperlink
    ? `<a href="${escapeHtml(run.hyperlink)}" target="_blank">${span}</a>`
    : span
}

const paragraphFontSize = (
  paragraph: StructuredTextParagraph,
  properties: StructuredTextParagraphProperties,
): number | undefined => {
  const sizes = paragraph.runs
    .map(run => run.properties?.fontSize)
    .filter((size): size is number => typeof size === 'number')
  // PowerPoint sizes a line from the text on it, so the largest run wins; an
  // empty paragraph takes its height from the end-paragraph properties.
  if (sizes.length) return Math.max(...sizes)
  return paragraph.endProperties?.fontSize ?? properties.defaultRun?.fontSize
}

/**
 * The size a body's blank lines fall back to.
 *
 * Layouts built in web editors space their content with empty paragraphs, and
 * those paragraphs often declare no size at all. Letting them fall through to
 * the browser default shrinks every blank line to roughly half its height,
 * which walks whatever follows up the slide — labels end up on top of the
 * artwork they were meant to sit beneath.
 */
const bodyFontSize = (body: StructuredTextBody): number | undefined => {
  for (const paragraph of body.paragraphs) {
    const size = paragraphFontSize(paragraph, paragraph.properties ?? {})
    if (size !== undefined) return size
  }
  return undefined
}

/**
 * The run properties that establish a paragraph's line box: the inherited
 * defaults, but at the size its own runs render at.
 */
const paragraphRunContext = (
  paragraph: StructuredTextParagraph,
  properties: StructuredTextParagraphProperties,
  fallbackFontSize?: number,
): StructuredTextRunProperties => {
  const defaultRun = properties.defaultRun ?? {}
  const fontSize = paragraphFontSize(paragraph, properties) ?? fallbackFontSize
  return fontSize === undefined ? defaultRun : { ...defaultRun, fontSize }
}

const renderParagraph = (
  paragraph: StructuredTextParagraph,
  context: StructuredTextCompileContext,
  scale: number,
  fontScale: number,
  lineSpacingReduction: number,
  inListItem = false,
  fallbackFontSize?: number,
): string => {
  const properties = paragraph.properties ?? {}
  const defaultTabSize = properties.defaultTabSize ?? 36
  const content = paragraph.runs.map(run => renderRun(
    run,
    scale,
    fontScale,
    defaultTabSize,
    context,
  )).join('')
  // PowerPoint paragraph defaults are also the CSS formatting context for the
  // line box. Applying them only to child spans makes relative line spacing
  // resolve against the browser's default 16px paragraph size instead of the
  // inherited PowerPoint font size.
  //
  // The size that context uses has to be the size the runs actually render at,
  // not the inherited default they override. Percentage line spacing is a
  // multiplier on the element's own font size, so a paragraph left at an
  // inherited 18pt while its runs are 13pt spaces every line for text half
  // again as tall as the glyphs, and a centre-anchored body then overflows in
  // both directions. PowerPoint sizes a line from the text on it, so the
  // largest run wins.
  const style = [
    paragraphStyle(properties, scale, lineSpacingReduction, inListItem),
    runStyle(paragraphRunContext(paragraph, properties, fallbackFontSize), scale, fontScale),
  ].filter(Boolean).join(';')
  return `<p data-ppt-paragraph-id="${escapeHtml(paragraph.sourceId)}" data-ppt-level="${paragraph.level}"${style ? ` style="${escapeHtml(style)}"` : ''}>${content || '<br>'}</p>`
}

const renderHtml = (
  body: StructuredTextBody,
  context: StructuredTextCompileContext,
): string => {
  const fontScale = (body.bodyProperties?.autoFit?.fontScale ?? 100) / 100
  const lineSpacingReduction = body.bodyProperties?.autoFit?.lineSpacingReduction ?? 0
  const fallbackFontSize = bodyFontSize(body)
  let html = ''
  const listStack: Array<{ level: number; tag: 'ol' | 'ul'; style: string }> = []
  const listItem = () => '<li>'
  const closeTopList = () => {
    const openList = listStack.pop()
    if (!openList) return
    html += `</li></${openList.tag}>`
  }
  const closeLists = () => {
    while (listStack.length) closeTopList()
  }
  const openList = (
    level: number,
    tag: 'ol' | 'ul',
    style: string,
    startAt: number | undefined,
    marker: string,
  ) => {
    const listStyle = [`list-style-type:${style}`, marker].filter(Boolean).join(';')
    html += `<${tag} data-ppt-level="${level}" style="${escapeHtml(listStyle)}"${tag === 'ol' && startAt ? ` start="${startAt}"` : ''}>${listItem()}`
    listStack.push({ level, style, tag })
  }
  for (const paragraph of body.paragraphs) {
    const bullet = paragraph.properties?.bullet
    if (!bullet || bullet.type === 'none') {
      closeLists()
      html += renderParagraph(paragraph, context, body.scale, fontScale, lineSpacingReduction, false, fallbackFontSize)
      continue
    }
    const tag = bullet.type === 'auto-number' ? 'ol' : 'ul'
    const resolved = resolveBulletCharacter(bullet)
    const style = bullet.type === 'auto-number'
      ? numberingStyle[bullet.numberingScheme ?? ''] ?? 'decimal'
      : resolved.character
        // A string marker gets no separation from the text, unlike the `disc`
        // keyword, so the separator belongs in the string. An en space is a
        // fixed half-em that approximates the authored hanging indent on
        // surfaces whose schema drops the exact indent declared below.
        ? JSON.stringify(`${resolved.character}${BULLET_SEPARATOR}`)
        : 'disc'
    const marker = bulletListStyle(
      bullet,
      paragraph.properties ?? {},
      paragraphRunContext(paragraph, paragraph.properties ?? {}, fallbackFontSize).fontSize,
      context,
      body.scale,
      fontScale,
      resolved.authoredFont,
    )

    while (listStack.length && listStack[listStack.length - 1]!.level > paragraph.level) {
      closeTopList()
    }

    const current = listStack[listStack.length - 1]
    if (!current || current.level < paragraph.level) {
      openList(paragraph.level, tag, style, bullet.startAt, marker)
    }
    else if (current.tag === tag && current.style === style) {
      html += `</li>${listItem()}`
    }
    else {
      closeTopList()
      openList(paragraph.level, tag, style, bullet.startAt, marker)
    }
    html += renderParagraph(paragraph, context, body.scale, fontScale, lineSpacingReduction, true, fallbackFontSize)
  }
  closeLists()
  return html
}

const compileParagraph = (
  paragraph: StructuredTextParagraph,
  body: StructuredTextBody,
  context: StructuredTextCompileContext,
): StructuredTextParagraph => {
  const masterStyles = masterStyleForKind(context.masterTextStyles, context.textStyleKind)
  const presentationStyle = levelStyle(context.defaultTextStyle, paragraph.level)
  const masterStyle = levelStyle(masterStyles, paragraph.level)
  const properties = mergeParagraphProperties(
    legacyStyleParagraph(presentationStyle),
    legacyStyleParagraph(masterStyle),
    bodyLevelParagraph(context.masterBody, paragraph.level),
    bodyLevelParagraph(context.layoutBody, paragraph.level),
    body.defaultParagraph,
    body.listStyle.find(style => style.level === paragraph.level)?.paragraph,
    paragraph.properties,
  )
  const baseRun = mergeRunProperties(
    legacyStyleRun(presentationStyle),
    legacyStyleRun(masterStyle),
    properties.defaultRun,
  )
  return {
    ...paragraph,
    endProperties: resolvedRunProperties(
      mergeRunProperties(baseRun, paragraph.endProperties),
      context,
    ),
    properties: {
      ...properties,
      defaultRun: resolvedRunProperties(baseRun, context),
    },
    runs: paragraph.runs.map(run => ({
      ...run,
      properties: resolvedRunProperties(
        mergeRunProperties(baseRun, run.properties),
        context,
      ),
    })),
  }
}

export const compileStructuredText = (
  body: StructuredTextBody,
  context: StructuredTextCompileContext,
): CompiledStructuredText => {
  const bodyProperties = Object.assign(
    {},
    context.masterBody?.bodyProperties,
    context.layoutBody?.bodyProperties,
    body.bodyProperties,
  )
  const compiledBody: StructuredTextBody = {
    ...body,
    bodyProperties,
    paragraphs: body.paragraphs.map(paragraph => compileParagraph(paragraph, body, context)),
  }
  const firstRun = compiledBody.paragraphs.flatMap(paragraph => paragraph.runs)[0]
  const defaultFontName = firstRun?.properties?.fontFamily
    ?? resolveThemeFont(undefined, firstRun?.properties?.language, context)
    ?? context.fallbackFontName
  const defaultColor = firstRun?.properties?.color?.value ?? context.fallbackColor
  return {
    body: compiledBody,
    bodyProperties,
    defaultColor,
    defaultFontName,
    html: renderHtml(compiledBody, context),
  }
}
