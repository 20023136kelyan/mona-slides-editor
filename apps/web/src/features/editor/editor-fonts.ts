// Fonts an imported PPTX references are resolved in a fixed order — embedded
// package payload, locally installed face, Google Fonts, metric-compatible
// substitute — and every face is registered under the document's ORIGINAL
// family name (including "Family SemiBold Italic" style suffixes), so the
// deck's font-family declarations resolve without rewriting content.

import { editorFontOptions } from '@/features/editor/editor-text-options'

const PRESET_FONTS: ReadonlyArray<{ label: string; value: string }> = editorFontOptions

const GOOGLE_FONTS_API = 'https://fonts.googleapis.com/css2'

const FONT_WEIGHTS: Record<string, number> = {
  black: 900,
  bold: 700,
  demibold: 600,
  extrabold: 800,
  extralight: 200,
  heavy: 900,
  light: 300,
  medium: 500,
  regular: 400,
  semibold: 600,
  thin: 100,
  ultrabold: 800,
  ultralight: 200,
}

// Google serves none of the Microsoft core fonts to a browser user agent — a
// request for Calibri, Cambria, or Times New Roman answers 400. What it does
// serve is the metric-compatible clone of each, which is the better target
// anyway: identical advance widths mean imported text breaks into the same
// lines PowerPoint produced. Entries without a metric twin fall back to the
// closest widely available face, which fixes the category but not the metrics.
const SUBSTITUTE_FAMILIES: Record<string, string> = {
  arial: 'Arimo',
  'book antiqua': 'EB Garamond',
  calibri: 'Carlito',
  cambria: 'Caladea',
  candara: 'Open Sans',
  'century gothic': 'Questrial',
  consolas: 'Cousine',
  corbel: 'Open Sans',
  'courier new': 'Cousine',
  'franklin gothic book': 'Libre Franklin',
  'franklin gothic medium': 'Libre Franklin',
  garamond: 'EB Garamond',
  georgia: 'Gelasio',
  'gill sans mt': 'Lato',
  helvetica: 'Arimo',
  palatino: 'EB Garamond',
  'palatino linotype': 'EB Garamond',
  'segoe ui': 'Open Sans',
  tahoma: 'Open Sans',
  'times new roman': 'Tinos',
  'trebuchet ms': 'Lato',
  verdana: 'Open Sans',
}

// Symbol fonts place glyphs at codepoints no text font shares, so substituting
// one renders unrelated letters — worse than the browser's own fallback. They
// are reported instead of replaced.
const SYMBOL_FAMILIES = new Set([
  'marlett',
  'symbol',
  'webdings',
  'wingdings',
  'wingdings 2',
  'wingdings 3',
])

/** Fired on `document` once a presentation's faces have been resolved. */
export const PRESENTATION_FONTS_CHANGED = 'mona:presentation-fonts-changed'

export interface EmbeddedPresentationFont {
  /** Base64 payload of the font part, exactly as stored in the package. */
  data: string
  italic: boolean
  typeface: string
  weight: number
}

export interface PresentationFontSubstitution {
  family: string
  substitute: string
}

export interface PresentationFontReport {
  /** Families satisfied by a payload embedded in the package. */
  embedded: string[]
  /** Families with no embedded, local, remote, or substitute face. */
  missing: string[]
  substituted: PresentationFontSubstitution[]
}

type FontResolution =
  | { kind: 'embedded' | 'local' | 'missing' | 'remote' }
  | { kind: 'substituted'; substitute: string }

export const isSystemFont = (font: string) => {
  if (typeof font !== 'string') return false
  const arial = 'Arial'
  if (font.toLowerCase() === arial.toLowerCase()) return true
  const glyph = 'a'
  const size = 100
  const width = 100
  const height = 100

  const canvas = document.createElement('canvas')
  // Probing a deck's fonts reads this canvas back once per family.
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return false

  canvas.width = width
  canvas.height = height
  context.textAlign = 'center'
  context.fillStyle = 'black'
  context.textBaseline = 'middle'

  const getDotArray = (family: string) => {
    context.clearRect(0, 0, width, height)
    context.font = `${size}px ${family}, ${arial}`
    context.fillText(glyph, width / 2, height / 2)
    const imageData = context.getImageData(0, 0, width, height).data
    return [...imageData].filter(item => item !== 0)
  }

  return getDotArray(arial).join('') !== getDotArray(font).join('')
}

// Resolutions are cached so reimporting the same deck neither refetches faces
// nor under-reports: the second import returns the same diagnostic as the first.
const resolvedFamilies = new Map<string, FontResolution>()

const decodeBase64 = (value: string) => {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

const FONT_SIGNATURES = new Set([
  String.fromCharCode(0, 1, 0, 0), // TrueType outlines
  'OTTO', // OpenType with CFF outlines
  'true',
  'ttcf',
  'wOFF',
  'wOF2',
])

const signatureAt = (bytes: Uint8Array, offset: number) => (
  String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!)
)

/**
 * Finds the font inside an embedded font part.
 *
 * PowerPoint does not store a bare TrueType file: it wraps the face in an EOT
 * container whose first two little-endian words are the container length and
 * the font length, putting the font itself at their difference. Handing the
 * container straight to `FontFace` fails, and every text box in the deck then
 * silently measures against a substitute instead of the face the deck ships.
 *
 * Producers that do write a bare font are returned untouched. A container
 * whose payload is compressed — MicroType Express — has no recognisable
 * signature and is reported rather than guessed at.
 */
export const extractFontPayload = (bytes: Uint8Array): Uint8Array | undefined => {
  if (bytes.byteLength < 16) return undefined
  if (FONT_SIGNATURES.has(signatureAt(bytes, 0))) return bytes
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const containerLength = view.getUint32(0, true)
  const fontLength = view.getUint32(4, true)
  if (containerLength !== bytes.byteLength || fontLength <= 0 || fontLength >= containerLength) {
    return undefined
  }
  const offset = containerLength - fontLength
  return FONT_SIGNATURES.has(signatureAt(bytes, offset)) ? bytes.subarray(offset) : undefined
}

const registerEmbeddedFont = async (font: EmbeddedPresentationFont) => {
  try {
    const payload = extractFontPayload(decodeBase64(font.data))
    if (!payload) return false
    const face = new FontFace(font.typeface, payload as BufferSource, {
      style: font.italic ? 'italic' : 'normal',
      weight: String(font.weight),
    })
    document.fonts.add(await face.load())
    return true
  }
  catch {
    return false
  }
}

const fetchFontFaceBlocks = async (family: string, weight?: number, italic = false) => {
  const fontFamily = encodeURIComponent(family).replace(/%20/g, '+')
  let fontStyle = ''
  if (italic && weight) fontStyle = `:ital,wght@1,${weight}`
  else if (italic) fontStyle = ':ital@1'
  else if (weight) fontStyle = `:wght@${weight}`
  const response = await fetch(`${GOOGLE_FONTS_API}?family=${fontFamily}${fontStyle}`)
  if (!response.ok) return []
  const cssText = await response.text()
  return [...cssText.matchAll(/@font-face\s*{([^}]+)}/g)].map(match => match[1]!)
}

const registerFontFaceBlocks = async (registerAs: string, fontFaceBlocks: string[]) => {
  if (!fontFaceBlocks.length) return false
  let loaded = false
  await Promise.all(fontFaceBlocks.map(async fontFaceBlock => {
    const urlMatch = fontFaceBlock.match(/src:\s*url\((['"]?)(https:\/\/fonts\.gstatic\.com\/[^'")]+)\1\)/)
    if (!urlMatch) return
    const descriptors: FontFaceDescriptors = {}
    const styleMatch = fontFaceBlock.match(/font-style:\s*([^;]+);/)
    const weightMatch = fontFaceBlock.match(/font-weight:\s*([^;]+);/)
    const unicodeRangeMatch = fontFaceBlock.match(/unicode-range:\s*([^;]+);/)
    if (styleMatch) descriptors.style = styleMatch[1]!.trim()
    if (weightMatch) descriptors.weight = weightMatch[1]!.trim()
    if (unicodeRangeMatch) descriptors.unicodeRange = unicodeRangeMatch[1]!.trim()
    try {
      const fontFace = await new FontFace(registerAs, `url("${urlMatch[2]}")`, descriptors).load()
      document.fonts.add(fontFace)
      loaded = true
    }
    catch { /* Ignore */ }
  }))
  return loaded
}

/**
 * Requests one remote family and registers it under `registerAs`, retrying
 * once without a trailing weight/style word so "Calibri Light" resolves to
 * Calibri at weight 300 rather than failing outright.
 */
const loadRemoteFamily = async (family: string, registerAs: string) => {
  try {
    if (await registerFontFaceBlocks(registerAs, await fetchFontFaceBlocks(family))) return true

    const parts = family.split(/\s+/)
    const suffix = parts[parts.length - 1]!.toLowerCase()
    const italic = suffix === 'italic' || suffix === 'oblique'
    if (italic) parts.pop()

    const weightSuffix = parts[parts.length - 1]?.toLowerCase()
    const weight = weightSuffix ? FONT_WEIGHTS[weightSuffix] : undefined
    if (weight) parts.pop()
    if ((!italic && !weight) || !parts.length) return false

    return await registerFontFaceBlocks(registerAs, await fetchFontFaceBlocks(parts.join(' '), weight, italic))
  }
  catch {
    return false
  }
}

/** Drops one trailing weight or style word: "Calibri Light" -> "Calibri". */
const baseFamilyName = (family: string) => {
  const parts = family.split(/\s+/)
  const suffix = parts[parts.length - 1]?.toLowerCase() ?? ''
  if (suffix === 'italic' || suffix === 'oblique') parts.pop()
  const weightSuffix = parts[parts.length - 1]?.toLowerCase()
  if (weightSuffix && FONT_WEIGHTS[weightSuffix]) parts.pop()
  return parts.join(' ')
}

const substituteFor = (family: string) => (
  SUBSTITUTE_FAMILIES[family.toLowerCase()]
  ?? SUBSTITUTE_FAMILIES[baseFamilyName(family).toLowerCase()]
)

const resolveFamily = async (
  family: string,
  embedded: readonly EmbeddedPresentationFont[],
): Promise<FontResolution> => {
  // An embedded payload is the deck's own answer for this family and outranks
  // any same-named face that happens to be installed locally.
  if (embedded.length) {
    const registered = await Promise.all(embedded.map(registerEmbeddedFont))
    if (registered.some(Boolean)) return { kind: 'embedded' }
  }
  if (isSystemFont(family)) return { kind: 'local' }

  // Symbol fonts place glyphs where no text font has matching ones, and no
  // remote family is named after them; requesting one only produces noise.
  if (SYMBOL_FAMILIES.has(family.toLowerCase())) return { kind: 'missing' }

  // A known substitute means the direct request is known to fail, so it is
  // skipped entirely rather than issued and discarded.
  const substitute = substituteFor(family)
  if (substitute) {
    return await loadRemoteFamily(substitute, family)
      ? { kind: 'substituted', substitute }
      : { kind: 'missing' }
  }
  if (await loadRemoteFamily(family, family)) return { kind: 'remote' }
  return { kind: 'missing' }
}

/**
 * Resolves every typeface an imported presentation references and reports the
 * families that could not be honoured exactly.
 *
 * Rendering is never blocked on this: unresolved text paints in the browser
 * fallback and reflows once a face arrives.
 */
export const loadPresentationFonts = async ({
  embeddedFonts = [],
  usedFonts,
}: {
  embeddedFonts?: readonly EmbeddedPresentationFont[]
  usedFonts: readonly string[]
}): Promise<PresentationFontReport> => {
  const presetFontNames = new Set<string>()
  for (const font of PRESET_FONTS) {
    presetFontNames.add(font.label.toLowerCase())
    presetFontNames.add(font.value.toLowerCase())
  }

  const embeddedByFamily = new Map<string, EmbeddedPresentationFont[]>()
  for (const font of embeddedFonts) {
    const key = font.typeface.trim().toLowerCase()
    if (!key) continue
    embeddedByFamily.set(key, [...(embeddedByFamily.get(key) ?? []), font])
  }

  const families = [...new Set(
    [...usedFonts, ...embeddedFonts.map(font => font.typeface)]
      .map(font => font.replace(/^['"]|['"]$/g, '').trim())
      .filter(font => font && !presetFontNames.has(font.toLowerCase())),
  )]

  const report: PresentationFontReport = { embedded: [], missing: [], substituted: [] }
  const resolutions = await Promise.all(families.map(async family => {
    const key = family.toLowerCase()
    const cached = resolvedFamilies.get(key)
    if (cached) return [family, cached] as const
    const resolution = await resolveFamily(family, embeddedByFamily.get(key) ?? [])
    resolvedFamilies.set(key, resolution)
    return [family, resolution] as const
  }))

  for (const [family, resolution] of resolutions) {
    if (resolution.kind === 'embedded') report.embedded.push(family)
    else if (resolution.kind === 'missing') report.missing.push(family)
    else if (resolution.kind === 'substituted') {
      report.substituted.push({ family, substitute: resolution.substitute })
    }
  }
  // A FontFace added after it already resolved emits no `loadingdone`, so
  // anything that measured text against the fallback metrics — autofit above
  // all — would never learn that the real faces arrived.
  document.dispatchEvent(new Event(PRESENTATION_FONTS_CHANGED))
  return report
}
