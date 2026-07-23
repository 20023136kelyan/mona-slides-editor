import tinycolor from 'tinycolor2'

import type { PPTElementOutline, PPTElementShadow, Slide, SlideTheme } from '@mona/presentation-core/model'

export interface PresetTheme {
  background: string
  borderColor?: string
  colors: string[]
  fontColor: string
  fontname: string
  outline?: PPTElementOutline
  shadow?: PPTElementShadow
}

export const PRESET_THEMES: readonly PresetTheme[] = [
  { background: '#ffffff', fontColor: '#333333', borderColor: '#41719c', fontname: '', colors: ['#5b9bd5', '#ed7d31', '#a5a5a5', '#ffc000', '#4472c4', '#70ad47'] },
  { background: '#ffffff', fontColor: '#333333', borderColor: '#5f6f1c', fontname: '', colors: ['#83992a', '#3c9670', '#44709d', '#a23b32', '#d87728', '#deb340'] },
  { background: '#ffffff', fontColor: '#333333', borderColor: '#a75f0a', fontname: '', colors: ['#e48312', '#bd582c', '#865640', '#9b8357', '#c2bc80', '#94a088'] },
  { background: '#ffffff', fontColor: '#333333', borderColor: '#7c91a8', fontname: '', colors: ['#bdc8df', '#003fa9', '#f5ba00', '#ff7567', '#7676d9', '#923ffc'] },
  { background: '#ffffff', fontColor: '#333333', borderColor: '#688e19', fontname: '', colors: ['#90c225', '#54a121', '#e6b91e', '#e86618', '#c42f19', '#918756'] },
  { background: '#ffffff', fontColor: '#333333', borderColor: '#4495b0', fontname: '', colors: ['#1cade4', '#2683c6', '#27ced7', '#42ba97', '#3e8853', '#62a39f'] },
  { background: '#e9efd6', fontColor: '#333333', borderColor: '#782009', fontname: '', colors: ['#a5300f', '#de7e18', '#9f8351', '#728653', '#92aa4c', '#6aac91'] },
  { background: '#17444e', fontColor: '#ffffff', borderColor: '#800c0b', fontname: '', colors: ['#b01513', '#ea6312', '#e6b729', '#6bab90', '#55839a', '#9e5d9d'] },
  { background: '#36234d', fontColor: '#ffffff', borderColor: '#830949', fontname: '', colors: ['#b31166', '#e33d6f', '#e45f3c', '#e9943a', '#9b6bf2', '#d63cd0'] },
  { background: '#247fad', fontColor: '#ffffff', borderColor: '#032e45', fontname: '', colors: ['#052f61', '#a50e82', '#14967c', '#6a9e1f', '#e87d37', '#c62324'] },
  { background: '#103f55', fontColor: '#ffffff', borderColor: '#2d7f8a', fontname: '', colors: ['#40aebd', '#97e8d5', '#a1cf49', '#628f3e', '#f2df3a', '#fcb01c'] },
  { background: '#242367', fontColor: '#ffffff', borderColor: '#7d2b8d', fontname: '', colors: ['#ac3ec1', '#477bd1', '#46b298', '#90ba4c', '#dd9d31', '#e25345'] },
  { background: '#e4b75e', fontColor: '#333333', borderColor: '#b68317', fontname: '', colors: ['#a5644e', '#b58b80', '#c3986d', '#a19574', '#c17529', '#826277'] },
  { background: '#333333', fontColor: '#ffffff', borderColor: '#7c91a8', fontname: '', colors: ['#bdc8df', '#003fa9', '#f5ba00', '#ff7567', '#7676d9', '#923ffc'] },
  { background: '#2b2b2d', fontColor: '#ffffff', borderColor: '#893011', fontname: '', colors: ['#bc451b', '#d3ba68', '#bb8640', '#ad9277', '#a55a43', '#ad9d7b'] },
  { background: '#171b1e', fontColor: '#ffffff', borderColor: '#505050', fontname: '', colors: ['#6f6f6f', '#bfbfa5', '#dbd084', '#e7bf5f', '#e9a039', '#cf7133'] },
]

interface ThemeValueWithArea {
  area: number
  value: string
}

const lineLength = (slide: Slide, elementId: string) => {
  const element = slide.elements.find(candidate => candidate.id === elementId)
  if (!element || element.type !== 'line') return 0
  const deltaX = element.end[0] - element.start[0]
  const deltaY = element.end[1] - element.start[1]
  return Math.sqrt((deltaX * deltaX) + (deltaY * deltaY))
}

const rankColors = (values: readonly ThemeValueWithArea[]) => {
  const totals: Record<string, number> = {}
  for (const item of values) {
    const color = tinycolor(item.value).toRgbString()
    if (color === 'rgba(0, 0, 0, 0)') continue
    totals[color] = (totals[color] || 0) + item.area
  }
  return Object.keys(totals).sort((left, right) => totals[right]! - totals[left]!)
}

export function getSlidesThemeStyles(input: Slide | readonly Slide[], theme: SlideTheme) {
  const slides: readonly Slide[] = Array.isArray(input) ? input : [input as Slide]
  const backgroundColorValues: ThemeValueWithArea[] = []
  const themeColorValues: ThemeValueWithArea[] = []
  const fontColorValues: ThemeValueWithArea[] = []
  const fontNameValues: ThemeValueWithArea[] = []

  for (const slide of slides) {
    if (slide.background) {
      if (slide.background.type === 'solid' && slide.background.color) backgroundColorValues.push({ area: 1, value: slide.background.color })
      else if (slide.background.type === 'gradient' && slide.background.gradient) {
        const length = slide.background.gradient.colors.length
        backgroundColorValues.push(...slide.background.gradient.colors.map(item => ({ area: 1 / length, value: item.color })))
      }
      else backgroundColorValues.push({ area: 1, value: theme.backgroundColor })
    }

    for (const element of slide.elements) {
      const area = element.width * (element.type === 'line' ? lineLength(slide, element.id) : element.height)
      if (element.type === 'shape' || element.type === 'text') {
        if (element.fill) themeColorValues.push({ area, value: element.fill })
        if (element.type === 'shape' && element.gradient) {
          const length = element.gradient.colors.length
          themeColorValues.push(...element.gradient.colors.map(item => ({ area: area / length, value: item.color })))
        }
        const text = (element.type === 'shape' ? element.text?.content : element.content) || ''
        if (!text) continue
        const plainText = text.replace(/<[^>]+>/g, '').replace(/\s*/g, '')
        const matchesForColor = text.match(/<[^>]+color: .+?<\/.+?>/g)
        const matchesForFont = text.match(/<[^>]+font-family: .+?<\/.+?>/g)
        let defaultColorPercent = 1
        let defaultFontPercent = 1
        if (matchesForColor) {
          for (const item of matchesForColor) {
            const match = item.match(/color: (.+?);/)
            if (!match) continue
            const styledText = item.replace(/<[^>]+>/g, '').replace(/\s*/g, '')
            const percentage = styledText.length / plainText.length
            defaultColorPercent -= percentage
            fontColorValues.push({ area: area * percentage, value: match[1]! })
          }
        }
        if (matchesForFont) {
          for (const item of matchesForFont) {
            const match = item.match(/font-family: (.+?);/)
            if (!match) continue
            const styledText = item.replace(/<[^>]+>/g, '').replace(/\s*/g, '')
            const percentage = styledText.length / plainText.length
            defaultFontPercent -= percentage
            fontNameValues.push({ area: area * percentage, value: match[1]! })
          }
        }
        if (defaultColorPercent) {
          fontColorValues.push({
            area: area * defaultColorPercent,
            value: (element.type === 'shape' ? element.text?.defaultColor : element.defaultColor) || theme.fontColor,
          })
        }
        if (defaultFontPercent) {
          fontNameValues.push({
            area: area * defaultFontPercent,
            value: (element.type === 'shape' ? element.text?.defaultFontName : element.defaultFontName) || theme.fontName,
          })
        }
      }
      else if (element.type === 'table') {
        const cellCount = element.data.length * element.data[0]!.length
        let cellWithFillCount = 0
        for (const row of element.data) {
          for (const cell of row) {
            if (cell.style?.backcolor) {
              cellWithFillCount += 1
              themeColorValues.push({ area: area / cellCount, value: cell.style.backcolor })
            }
            if (cell.text) {
              const percent = cell.text.length >= 10 ? 1 : cell.text.length / 10
              if (cell.style?.color) fontColorValues.push({ area: (area / cellCount) * percent, value: cell.style.color })
              // Quirk retired: the source editor accumulated table cell font NAMES in
              // the font-color bucket; they belong to the font-name ranking.
              if (cell.style?.fontname) fontNameValues.push({ area: (area / cellCount) * percent, value: cell.style.fontname })
            }
          }
        }
        if (element.theme) themeColorValues.push({ area: area * (1 - (cellWithFillCount / cellCount)), value: element.theme.color })
      }
      else if (element.type === 'chart') {
        if (element.fill) themeColorValues.push({ area: area * .6, value: element.fill })
        if (element.themeColors[0]) themeColorValues.push({ area: area * .3, value: element.themeColors[0] })
        for (const color of element.themeColors) {
          if (tinycolor(color).getAlpha() !== 0) themeColorValues.push({ area: (area / element.themeColors.length) * .1, value: color })
        }
      }
      else if (element.type === 'line') themeColorValues.push({ area, value: element.color })
      else if (element.type === 'audio') themeColorValues.push({ area, value: element.color })
      else if (element.type === 'latex') fontColorValues.push({ area, value: element.color })
    }
  }

  const fontNames: Record<string, number> = {}
  for (const item of fontNameValues) fontNames[item.value] = (fontNames[item.value] || 0) + item.area
  return {
    backgroundColors: rankColors(backgroundColorValues),
    themeColors: rankColors(themeColorValues),
    fontColors: rankColors(fontColorValues),
    fontNames: Object.keys(fontNames).sort((left, right) => fontNames[right]! - fontNames[left]!),
  }
}

export function getSlideAllColors(slide: Slide) {
  const colors: Record<string, number> = {}
  const record = (color: string, area: number) => {
    const normalized = tinycolor(color).setAlpha(1).toRgbString()
    colors[normalized] = (colors[normalized] || 0) + area
  }
  for (const element of slide.elements) {
    const area = element.width * (element.type === 'line' ? lineLength(slide, element.id) : element.height)
    if (element.type === 'shape' && tinycolor(element.fill).getAlpha() !== 0) record(element.fill, area)
    if (element.type === 'text' && element.fill && tinycolor(element.fill).getAlpha() !== 0) record(element.fill, area)
    if (element.type === 'image' && element.colorMask && tinycolor(element.colorMask).getAlpha() !== 0) record(element.colorMask, area)
    if (element.type === 'table' && element.theme && tinycolor(element.theme.color).getAlpha() !== 0) record(element.theme.color, area)
    if (element.type === 'chart') {
      for (const color of element.themeColors) {
        if (tinycolor(color).getAlpha() !== 0) record(color, (area / element.themeColors.length) * .1)
      }
      if (element.themeColors[0] && tinycolor(element.themeColors[0]).getAlpha() !== 0) record(element.themeColors[0], area * .3)
      if (element.fill && tinycolor(element.fill).getAlpha() !== 0) record(element.fill, area * .6)
    }
    if (element.type === 'line' && tinycolor(element.color).getAlpha() !== 0) record(element.color, area)
    if (element.type === 'audio' && tinycolor(element.color).getAlpha() !== 0) record(element.color, area)
  }
  return Object.keys(colors).sort((left, right) => colors[right]! - colors[left]!)
}

export function createSlideThemeColorMap(slide: Slide, inputColors: readonly string[]) {
  const newColors = [...inputColors]
  const oldColors = getSlideAllColors(slide)
  const map: Record<string, string> = {}
  if (oldColors.length > newColors.length) {
    const analogous = tinycolor(newColors[0]).analogous(oldColors.length - newColors.length + 10)
    newColors.push(...analogous.map(item => item.toHexString()).slice(1))
  }
  for (let index = 0; index < oldColors.length; index += 1) map[oldColors[index]!] = newColors[index]!
  return map
}

export function setSlideTheme(slide: Slide, theme: PresetTheme) {
  const colorMap = createSlideThemeColorMap(slide, theme.colors)
  const getColor = (color: string) => {
    const alpha = tinycolor(color).getAlpha()
    const replacement = colorMap[tinycolor(color).setAlpha(1).toRgbString()]
    return replacement ? tinycolor(replacement).setAlpha(alpha).toRgbString() : color
  }
  if (!slide.background || slide.background.type !== 'image') slide.background = { type: 'solid', color: theme.background }
  for (const element of slide.elements) {
    if (element.type === 'shape') {
      if (element.fill) element.fill = getColor(element.fill)
      if (element.gradient) delete element.gradient
      if (element.text) {
        element.text.defaultColor = theme.fontColor
        element.text.defaultFontName = theme.fontname
        if (element.text.content) element.text.content = element.text.content.replace(/color: .+?;/g, '').replace(/font-family: .+?;/g, '')
      }
    }
    if (element.type === 'text') {
      if (element.fill) element.fill = getColor(element.fill)
      element.defaultColor = theme.fontColor
      element.defaultFontName = theme.fontname
      if (element.content) element.content = element.content.replace(/color: .+?;/g, '').replace(/font-family: .+?;/g, '')
    }
    if (element.type === 'image' && element.colorMask) element.colorMask = getColor(element.colorMask)
    if (element.type === 'table') {
      if (element.theme) element.theme.color = getColor(element.theme.color)
      for (const row of element.data) {
        for (const cell of row) {
          if (cell.style) {
            cell.style.color = theme.fontColor
            cell.style.fontname = theme.fontname
          }
        }
      }
    }
    if (element.type === 'chart') {
      element.themeColors = [...theme.colors]
      element.textColor = theme.fontColor
    }
    if (element.type === 'line') element.color = getColor(element.color)
    if (element.type === 'audio') element.color = getColor(element.color)
    if (element.type === 'latex') element.color = theme.fontColor
    if ('outline' in element && element.outline) {
      if (theme.outline) element.outline = { ...theme.outline }
      if (theme.borderColor) element.outline.color = theme.borderColor
    }
    if ('shadow' in element && element.shadow && theme.shadow) element.shadow = theme.shadow
  }
}

export function themeState(theme: PresetTheme): Partial<SlideTheme> {
  return {
    backgroundColor: theme.background,
    themeColors: theme.colors,
    fontColor: theme.fontColor,
    outline: { width: 2, style: 'solid', color: theme.borderColor },
    fontName: theme.fontname,
  }
}

export function applyThemeToSlides(slides: readonly Slide[], theme: SlideTheme, applyAll: boolean) {
  // the source editor deliberately clones through JSON before applying a theme. Besides
  // detaching proxies, this removes optional properties whose value is
  // `undefined`; preserving them here would make the observable document graph
  // diverge after an otherwise identical command.
  const next = JSON.parse(JSON.stringify(slides)) as Slide[]
  const preset: PresetTheme = {
    background: theme.backgroundColor,
    fontColor: theme.fontColor,
    borderColor: applyAll ? theme.outline.color : undefined,
    fontname: theme.fontName,
    colors: theme.themeColors,
    outline: applyAll ? theme.outline : undefined,
    shadow: applyAll ? theme.shadow : undefined,
  }
  for (const slide of next) setSlideTheme(slide, preset)
  return next
}

export function applyFontToSlides(slides: readonly Slide[], fontname: string) {
  const next = JSON.parse(JSON.stringify(slides)) as Slide[]
  for (const slide of next) {
    for (const element of slide.elements) {
      if (element.type === 'shape' && element.text) {
        element.text.defaultFontName = fontname
        if (element.text.content) element.text.content = element.text.content.replace(/font-family: .+?;/g, '')
      }
      if (element.type === 'text') {
        element.defaultFontName = fontname
        if (element.content) element.content = element.content.replace(/font-family: .+?;/g, '')
      }
      if (element.type === 'table') {
        for (const row of element.data) {
          for (const cell of row) if (cell.style) cell.style.fontname = fontname
        }
      }
    }
  }
  return next
}
