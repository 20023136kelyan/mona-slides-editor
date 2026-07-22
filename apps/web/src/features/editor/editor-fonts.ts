// Port of PPTist's src/utils/font.ts: fonts used by an imported PPTX are
// fetched from Google Fonts and registered under the document's ORIGINAL
// family name (including "Family SemiBold Italic" style suffixes), so the
// deck's font-family declarations resolve without rewriting content.

const PRESET_FONTS: ReadonlyArray<{ label: string; value: string }> = [
  { label: '思源黑体', value: 'SourceHanSans' },
  { label: '思源宋体', value: 'SourceHanSerif' },
  { label: '文鼎PL楷体', value: 'WenDingPLKaiTi' },
  { label: '文鼎PL宋体', value: 'WenDingPLSongTi' },
  { label: '朱雀仿宋', value: 'ZhuQueFangSong' },
  { label: '霞鹜文楷', value: 'LXGWWenKai' },
  { label: '霞鹜新致宋', value: 'LXGWNeoZhiSong' },
  { label: '霞鹜新晰黑', value: 'LXGWNeoXiHei' },
  { label: '阿里巴巴普惠体', value: 'AlibabaPuHuiTi' },
  { label: '得意黑', value: 'DeYiHei' },
  { label: 'MiSans', value: 'MiSans' },
  { label: 'Source Serif 4', value: 'SourceSerif4' },
  { label: 'JetBrains Mono', value: 'JetBrainsMono' },
  { label: 'Literata', value: 'Literata' },
  { label: 'Inter', value: 'Inter' },
  { label: 'Roboto', value: 'Roboto' },
  { label: 'Open Sans', value: 'OpenSans' },
  { label: 'Montserrat', value: 'Montserrat' },
  { label: 'Source Sans Pro', value: 'SourceSansPro' },
  { label: 'Merriweather', value: 'Merriweather' },
  { label: 'Lato', value: 'Lato' },
]

export const isSystemFont = (font: string) => {
  if (typeof font !== 'string') return false
  const arial = 'Arial'
  if (font.toLowerCase() === arial.toLowerCase()) return true
  const glyph = 'a'
  const size = 100
  const width = 100
  const height = 100

  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
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

const requestedCustomFonts = new Set<string>()

export const loadGoogleFonts = (usedFonts: string[]) => {
  const GOOGLE_FONTS_API = 'https://fonts.googleapis.com/css2'
  const fontWeightMap: Record<string, number> = {
    thin: 100,
    extralight: 200,
    ultralight: 200,
    light: 300,
    regular: 400,
    medium: 500,
    semibold: 600,
    demibold: 600,
    bold: 700,
    extrabold: 800,
    ultrabold: 800,
    black: 900,
    heavy: 900,
  }
  const presetFontNames = new Set<string>()
  for (const font of PRESET_FONTS) {
    presetFontNames.add(font.label.toLowerCase())
    presetFontNames.add(font.value.toLowerCase())
  }

  const fontNames = [...new Set(
    usedFonts
      .map(font => font.replace(/^['"]|['"]$/g, '').trim())
      .filter(font => font && !presetFontNames.has(font.toLowerCase()) && !isSystemFont(font)),
  )]

  for (const fontName of fontNames) {
    const fontKey = fontName.toLowerCase()
    if (requestedCustomFonts.has(fontKey)) continue
    requestedCustomFonts.add(fontKey)

    void (async () => {
      try {
        const getFontFaceBlocks = async (family: string, weight?: number, italic = false) => {
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

        const loadFontFaceBlocks = async (fontFaceBlocks: string[]) => {
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
              const fontFace = await new FontFace(fontName, `url("${urlMatch[2]}")`, descriptors).load()
              document.fonts.add(fontFace)
              loaded = true
            }
            catch { /* Ignore */ }
          }))
          return loaded
        }

        const loaded = await loadFontFaceBlocks(await getFontFaceBlocks(fontName))
        if (loaded) return

        const fontNameParts = fontName.split(/\s+/)
        const suffix = fontNameParts[fontNameParts.length - 1]!.toLowerCase()
        const italic = suffix === 'italic' || suffix === 'oblique'
        if (italic) fontNameParts.pop()

        const weightSuffix = fontNameParts[fontNameParts.length - 1]?.toLowerCase()
        const weight = weightSuffix ? fontWeightMap[weightSuffix] : undefined
        if (weight) fontNameParts.pop()
        if ((!italic && !weight) || !fontNameParts.length) return

        await loadFontFaceBlocks(await getFontFaceBlocks(fontNameParts.join(' '), weight, italic))
      }
      catch { /* Ignore */ }
    })()
  }
}
