import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import tinycolor from 'tinycolor2'

import CheckIcon from '~icons/icon-park-outline/check'
import DownIcon from '~icons/icon-park-outline/down'
import PaletteIcon from '~icons/icon-park-outline/platte'
import PlusIcon from '~icons/icon-park-outline/plus'
import RightIcon from '~icons/icon-park-outline/right'
import type {
  Gradient,
  LineStyleType,
  SlideBackground,
  SlideBackgroundImage,
  SlideBackgroundType,
  SlideTheme,
} from '@mona/presentation-core/model'
import { selectPresentation } from '@mona/editor-state'

import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Toggle } from '@/components/ui/toggle'
import { EditorGradientBar } from '@/features/editor/EditorGradientBar'
import {
  InspectorButton,
  InspectorColorButton,
  InspectorNumberInput,
  InspectorSelect,
  InspectorSlider,
} from '@/features/editor/EditorInspectorPrimitives'
import { EditorModal } from '@/features/editor/EditorModal'
import { useEditorModalClose } from '@/features/editor/editor-modal-context'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { fileToDataUrl } from '@/features/editor/editor-image'
import { useEditorApplication } from '@/features/editor/services/editor-application'
import {
  applyFontToSlides,
  applyThemeToSlides,
  getSlidesThemeStyles,
  PRESET_THEMES,
  setSlideTheme,
  themeState,
  type PresetTheme,
} from '@/features/editor/editor-slide-theme'
import { useEditorSelector } from '@/features/editor/use-editor-selector'

const fontOptions = [
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
] as const

const lineStyleOptions: Array<{ label: string; value: LineStyleType }> = [
  { label: 'Solid', value: 'solid' },
  { label: 'Dashed', value: 'dashed' },
  { label: 'Dotted', value: 'dotted' },
]

function LineStylePreview({ type }: { type: LineStyleType }) {
  const dashArray = type === 'dashed' ? '10 5' : type === 'dotted' ? '3.6 3.2' : '0 0'
  return <svg aria-hidden="true" className="mona-line-style-preview" height="100%" viewBox="0 0 100 10" width="100%"><line stroke="#333" strokeDasharray={dashArray} strokeWidth="2" x1="0" x2="100" y1="5" y2="5" /></svg>
}

function DesignRow({ children, label, style }: { children: React.ReactNode; label: string; style?: React.CSSProperties }) {
  return <div className="mona-design-row" style={style}><div className="mona-design-row-label">{label}</div><div className="mona-design-row-control">{children}</div></div>
}

function ThemeColorListButton({ colors, onClick }: { colors: readonly string[]; onClick: () => void }) {
  return (
    <Button aria-label="Theme colors" className="mona-theme-color-list" onClick={onClick} size="editor" type="button" variant="outline">
      <span className="mona-theme-color-blocks">
        {colors.slice(0, 12).map((color, index) => <span className="mona-theme-color-block" key={`${color}-${index}`}><span style={{ backgroundColor: color }} /></span>)}
      </span>
      <PaletteIcon className="mona-theme-color-icon" />
    </Button>
  )
}

function ViewportSizeSetting({ runtime }: { runtime: EditorRuntime }) {
  const { t } = useTranslation()
  const { notifications } = useEditorApplication()
  const close = useEditorModalClose()
  const presentation = useEditorSelector(runtime.store, selectPresentation)
  const [width, setWidth] = useState(Math.round(presentation.viewportSize * 100) / 100)
  const [height, setHeight] = useState(Math.round(presentation.viewportSize * presentation.viewportRatio * 100) / 100)
  const min = 500
  const max = 2000
  const apply = (nextWidth = width, nextHeight = height) => {
    if (nextWidth < min || nextWidth > max || nextHeight < min || nextHeight > max) {
      notifications.notify({ text: t('designPanel.sizeRangeError', { min, max }), type: 'warning' })
      return
    }
    runtime.commit('Set custom viewport', [
      { type: 'presentation.viewport-size.set', size: nextWidth },
      { type: 'presentation.viewport-ratio.set', ratio: nextHeight / nextWidth },
    ], { historyKey: 'slide-design-viewport' })
    close()
  }
  return (
    <div className="mona-viewport-setting">
      <div className="mona-design-modal-title">{t('designPanel.customCanvas')}</div>
      <div className="mona-viewport-setting-row"><div>{t('toolbar.width')}</div><InspectorNumberInput ariaLabel={t('toolbar.width')} max={max} min={min} onChange={setWidth} onEnter={value => apply(value, height)} value={width} /></div>
      <div className="mona-viewport-setting-row"><div>{t('toolbar.height')}</div><InspectorNumberInput ariaLabel={t('toolbar.height')} max={max} min={min} onChange={setHeight} onEnter={value => apply(width, value)} value={height} /></div>
      <div className="mona-viewport-setting-tip">{t('designPanel.sizeRange', { min, max })}</div>
      <div className="mona-design-modal-buttons">
        <InspectorButton active ariaLabel={t('common.confirm')} onClick={apply}>{t('common.confirm')}</InspectorButton>
        <InspectorButton ariaLabel={t('common.cancel')} onClick={close}>{t('common.cancel')}</InspectorButton>
      </div>
    </div>
  )
}

function ThemeColorsSetting({ runtime }: { runtime: EditorRuntime }) {
  const { t } = useTranslation()
  const close = useEditorModalClose()
  const presentation = useEditorSelector(runtime.store, selectPresentation)
  const [colors, setColors] = useState(() => {
    const next = [...presentation.theme.themeColors]
    while (next.length < 6) next.push('#00000000')
    return next
  })
  const dragCleanupRef = useRef<(() => void) | null>(null)
  const startReorder = (event: ReactPointerEvent<HTMLDivElement>, oldIndex: number) => {
    if (event.button !== 0) return
    const startY = event.clientY
    let moved = false
    let nextIndex = oldIndex
    const move = (pointer: PointerEvent) => {
      if (!moved && Math.abs(pointer.clientY - startY) < 4) return
      moved = true
      const rows = [...document.querySelectorAll<HTMLElement>('.mona-theme-colors-row')]
      const target = rows.findIndex(row => pointer.clientY < row.getBoundingClientRect().top + (row.offsetHeight / 2))
      nextIndex = target < 0 ? rows.length - 1 : target
    }
    const stop = () => {
      cleanup()
      if (!moved || nextIndex === oldIndex) return
      setColors(current => {
        const next = [...current]
        const item = next.splice(oldIndex, 1)[0]!
        next.splice(nextIndex, 0, item)
        return next
      })
    }
    const cleanup = () => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', stop)
      dragCleanupRef.current = null
    }
    dragCleanupRef.current?.()
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', stop, { once: true })
    dragCleanupRef.current = cleanup
  }
  const confirm = () => {
    let next = colors.filter(color => color !== '#00000000')
    if (!next.length) next = ['#00000000']
    runtime.commit('Set theme colors', [{
      type: 'presentation.theme.update',
      props: { themeColors: next },
    }], { historyKey: 'slide-design-theme-colors' })
    close()
  }
  return (
    <div className="mona-theme-colors-setting">
      <div className="mona-design-modal-title">{t('designPanel.editThemeColors')}</div>
      {colors.map((color, index) => (
        <div className="mona-theme-colors-row" key={index}>
          <div className="mona-theme-colors-label" onPointerDown={event => startReorder(event, index)}>{t('designPanel.slideThemeColor', { number: index + 1 })}</div>
          <InspectorColorButton ariaLabel={t('designPanel.slideThemeColor', { number: index + 1 })} color={color} onChange={value => setColors(current => current.map((item, itemIndex) => itemIndex === index ? value : item))} />
        </div>
      ))}
      <InspectorButton active ariaLabel={t('common.confirm')} onClick={confirm} style={{ marginTop: 12, width: '100%' }}>{t('common.confirm')}</InspectorButton>
    </div>
  )
}

function ThemeStylesExtract({ runtime }: { runtime: EditorRuntime }) {
  const { t } = useTranslation()
  const { notifications } = useEditorApplication()
  const close = useEditorModalClose()
  const presentation = useEditorSelector(runtime.store, selectPresentation)
  const [activeTab, setActiveTab] = useState<'single' | 'all'>('single')
  // The source captures extraction results when the modal opens and only
  // recalculates them when its tab changes. Applying one extracted value to
  // the theme must not silently reorder the remaining choices mid-session.
  const [styles, setStyles] = useState(() => getSlidesThemeStyles(presentation.slides[presentation.slideIndex]!, presentation.theme))
  const [selection, setSelection] = useState({ backgroundColor: 0, fontColor: 0, fontName: 0, themeColors: styles.themeColors.map((_, index) => index) })
  const selectTab = (tab: 'single' | 'all') => {
    const nextStyles = getSlidesThemeStyles(tab === 'single' ? presentation.slides[presentation.slideIndex]! : presentation.slides, presentation.theme)
    setActiveTab(tab)
    setStyles(nextStyles)
    setSelection({ backgroundColor: 0, fontColor: 0, fontName: 0, themeColors: nextStyles.themeColors.map((_, index) => index) })
  }
  const updateTheme = (props: Partial<SlideTheme>) => runtime.commit('Update extracted theme', [{
    type: 'presentation.theme.update',
    props,
  }], { historyKey: 'slide-design-extracted-theme' })
  const apply = () => {
    let themeColors = styles.themeColors.filter((_, index) => selection.themeColors.includes(index))
    if (themeColors.length > 6) {
      themeColors = themeColors.slice(0, 6)
      notifications.notify({ text: t('designPanel.themeColorLimit'), type: 'warning' })
    }
    const props: Partial<SlideTheme> = {}
    const backgroundColor = styles.backgroundColors[selection.backgroundColor]
    const fontColor = styles.fontColors[selection.fontColor]
    const fontName = styles.fontNames[selection.fontName]
    if (backgroundColor) props.backgroundColor = backgroundColor
    if (fontColor) props.fontColor = fontColor
    if (fontName) props.fontName = fontName
    if (themeColors.length) props.themeColors = themeColors
    updateTheme(props)
    close()
  }
  const readable = (color: string) => tinycolor.mostReadable(color, ['#000', '#fff'], { includeFallbackColors: true }).toRgbString()
  const hex = (color: string) => {
    const value = tinycolor(color)
    return (value.getAlpha() < 1 ? value.toHex8String() : value.toHexString()).toUpperCase()
  }
  const optionRows = [
    { key: 'fontName' as const, label: `${t('common.font')}:`, values: styles.fontNames, visual: (value: string) => <span className="mona-extract-value" style={{ fontFamily: value }}>{fontOptions.find(item => item.value === value)?.label || value}</span>, apply: (value: string) => updateTheme({ fontName: value }) },
    { key: 'fontColor' as const, label: `${t('toolbar.textColor')}:`, values: styles.fontColors, visual: (value: string) => <span className="mona-extract-value" style={{ backgroundColor: value, color: readable(value) }}>{hex(value)}</span>, apply: (value: string) => updateTheme({ fontColor: value }) },
    { key: 'backgroundColor' as const, label: `${t('common.backgroundColor')}:`, values: styles.backgroundColors, visual: (value: string) => <span className="mona-extract-value" style={{ backgroundColor: value, color: readable(value) }}>{hex(value)}</span>, apply: (value: string) => updateTheme({ backgroundColor: value }) },
  ]
  return (
    <div className="mona-theme-extract">
      <Tabs onValueChange={value => selectTab(value as 'single' | 'all')} value={activeTab}>
        <TabsList className="mona-extract-tabs">
          <TabsTrigger value="single">{t('designPanel.extractCurrent')}</TabsTrigger>
          <TabsTrigger value="all">{t('designPanel.extractAll')}</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="mona-extract-content">
        {optionRows.map(row => row.values.length ? (
          <div className="mona-extract-config" key={row.key}>
            <div className="mona-extract-label">{row.label}</div>
            {row.values.map((value, index) => (
              <div className="mona-extract-value-wrap" key={value}>
                {row.visual(value)}
                <div className="mona-extract-handler">
                  <span className={selection[row.key] === index ? 'is-active' : ''}><CheckIcon /></span>
                  <Button onClick={() => setSelection(current => ({ ...current, [row.key]: index }))} size="xs" type="button" variant="ghost">{t('common.select')}</Button>
                  <Button onClick={() => {
                    row.apply(value); setSelection(current => ({ ...current, [row.key]: index })) 
                  }} size="xs" type="button" variant="ghost">{t('designPanel.applyToTheme')}</Button>
                </div>
              </div>
            ))}
          </div>
        ) : null)}
        {styles.themeColors.length ? (
          <div className="mona-extract-config">
            <div className="mona-extract-label">{`${t('common.themeColor')}: `}<span>({t('designPanel.excludeColorTip')})</span></div>
            <div className="mona-extract-colors">
              {styles.themeColors.map((color, index) => (
                <Toggle
                  aria-label={color}
                  className={selection.themeColors.includes(index) ? '' : 'is-disabled'}
                  key={color}
                  onPressedChange={() => setSelection(current => ({ ...current, themeColors: current.themeColors.includes(index) ? current.themeColors.filter(item => item !== index) : [...current.themeColors, index] }))}
                  pressed={selection.themeColors.includes(index)}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <InspectorButton active ariaLabel={t('designPanel.saveSelectedTheme')} onClick={apply} style={{ marginTop: 12, width: '100%' }}><CheckIcon /> {t('designPanel.saveSelectedTheme')}</InspectorButton>
    </div>
  )
}

export function SlideDesignPanel({ runtime }: { runtime: EditorRuntime }) {
  const { t } = useTranslation()
  const presentation = useEditorSelector(runtime.store, selectPresentation)
  const slide = presentation.slides[presentation.slideIndex]!
  const background: SlideBackground = slide.background || { type: 'solid', color: '#fff' }
  const [more, setMore] = useState(false)
  const [gradientIndex, setGradientIndex] = useState(0)
  const [themeColorsOpen, setThemeColorsOpen] = useState(false)
  const [themeExtractOpen, setThemeExtractOpen] = useState(false)
  const [viewportOpen, setViewportOpen] = useState(false)
  const historyKey = 'slide-design-panel'

  const updateBackground = (props: Partial<SlideBackground>) => runtime.commit('Update slide background', [{ type: 'slide.update', props: { background: { ...background, ...props } as SlideBackground } }], { historyKey })
  const updateBackgroundType = (type: SlideBackgroundType) => {
    if (type === 'solid') updateBackground({ type: 'solid', color: background.color || '#fff' })
    else if (type === 'image') updateBackground({ type: 'image', image: background.image || { src: '', size: 'cover' } })
    else {
      setGradientIndex(0)
      updateBackground({ type: 'gradient', gradient: background.gradient || { type: 'linear', colors: [{ pos: 0, color: '#fff' }, { pos: 100, color: '#fff' }], rotate: 0 } })
    }
  }
  const updateGradient = (props: Partial<Gradient>) => updateBackground({ gradient: { ...background.gradient!, ...props } })
  const updateImage = (props: Partial<SlideBackgroundImage>) => updateBackground({ image: { ...background.image!, ...props } })
  const updateTheme = (props: Partial<SlideTheme>) => runtime.commit('Update presentation theme', [{
    type: 'presentation.theme.update',
    props,
  }], { historyKey: 'slide-design-theme' })
  const applyBackgroundAll = () => runtime.commit('Apply background to all slides', [{
    type: 'presentation.slides.replace',
    slides: presentation.slides.map(candidate => ({ ...candidate, background: slide.background })),
  }], { historyKey })
  const applyPreset = (preset: PresetTheme, apply = false) => {
    const commands: Parameters<EditorRuntime['commit']>[1] = [{ type: 'presentation.theme.update', props: themeState(preset) }]
    if (apply) {
      const slides = JSON.parse(JSON.stringify(presentation.slides)) as typeof presentation.slides
      for (const candidate of slides) setSlideTheme(candidate, preset)
      commands.push({ type: 'presentation.slides.replace', slides })
    }
    runtime.commit('Apply preset theme', commands, { historyKey })
  }
  const ratioOptions: Array<{ label: string; value: number | string }> = [
    { label: t('designPanel.wide169'), value: .5625 },
    { label: t('designPanel.wide1610'), value: .625 },
    { label: t('designPanel.standard43'), value: .75 },
    { label: t('designPanel.paperLandscape'), value: .70710678 },
    { label: t('designPanel.paperPortrait'), value: 1.41421356 },
    { label: t('common.custom'), value: 'custom' },
  ]
  const canvasSize = t('designPanel.canvasSize', { width: presentation.viewportSize, height: Math.round(presentation.viewportSize * presentation.viewportRatio * 100) / 100 })

  return (
    <div className="mona-slide-design-panel">
      <div className="mona-design-title">{t('designPanel.backgroundFill')}</div>
      <div className="mona-design-split-row">
        <InspectorSelect ariaLabel={t('designPanel.backgroundFill')} onChange={value => updateBackgroundType(value)} options={[
          { label: t('toolbar.solidFill'), value: 'solid' },
          { label: t('toolbar.imageFill'), value: 'image' },
          { label: t('toolbar.gradientFill'), value: 'gradient' },
        ]} value={background.type} />
        {background.type === 'solid' ? <InspectorColorButton ariaLabel={t('designPanel.backgroundFill')} color={background.color || '#fff'} onChange={color => updateBackground({ color })} /> : null}
        {background.type === 'image' ? <InspectorSelect ariaLabel={t('designPanel.backgroundFill')} onChange={value => updateImage({ size: value })} options={[
          { label: t('designPanel.imageContain'), value: 'contain' },
          { label: t('designPanel.imageRepeat'), value: 'repeat' },
          { label: t('designPanel.imageCover'), value: 'cover' },
        ]} value={background.image?.size || 'cover'} /> : null}
        {background.type === 'gradient' ? <InspectorSelect ariaLabel={t('toolbar.gradientFill')} onChange={value => updateGradient({ type: value })} options={[
          { label: t('toolbar.linearGradient'), value: 'linear' },
          { label: t('toolbar.radialGradient'), value: 'radial' },
        ]} value={background.gradient?.type || 'linear'} /> : null}
      </div>
      {background.type === 'image' ? (
        <label className="mona-background-image-upload">
          <input accept="image/*" onChange={event => {
            const file = event.target.files?.[0]; if (file) void fileToDataUrl(file).then(src => updateImage({ src })) 
          }} type="file" />
          <span style={{ backgroundImage: `url(${background.image?.src})` }}><PlusIcon /></span>
        </label>
      ) : null}
      {background.type === 'gradient' && background.gradient ? (
        <div className="mona-background-gradient">
          <div className="mona-design-row-full"><EditorGradientBar index={Math.min(gradientIndex, background.gradient.colors.length - 1)} onChange={colors => updateGradient({ colors })} onIndexChange={setGradientIndex} value={background.gradient.colors} /></div>
          <DesignRow label={t('toolbar.currentStop')}><InspectorColorButton ariaLabel={t('toolbar.currentStop')} color={background.gradient.colors[gradientIndex]?.color || '#fff'} onChange={color => updateGradient({ colors: background.gradient!.colors.map((item, index) => index === gradientIndex ? { ...item, color } : item) })} /></DesignRow>
          {background.gradient.type === 'linear' ? <DesignRow label={t('toolbar.gradientAngle')}><InspectorSlider ariaLabel={t('toolbar.gradientAngle')} max={360} min={0} onChange={rotate => updateGradient({ rotate })} step={15} value={background.gradient.rotate || 0} /></DesignRow> : null}
        </div>
      ) : null}
      <div className="mona-design-row-full"><InspectorButton ariaLabel={t('designPanel.applyBackgroundAll')} onClick={applyBackgroundAll} style={{ width: '100%' }}><CheckIcon /> {t('designPanel.applyBackgroundAll')}</InspectorButton></div>
      <div className="mona-inspector-divider" />
      <div className="mona-design-row-full"><InspectorSelect ariaLabel={t('designPanel.customCanvas')} onChange={value => {
        if (value === 'custom') setViewportOpen(true); else if (typeof value === 'number') runtime.commit('Set viewport ratio', [{ type: 'presentation.viewport-ratio.set', ratio: value }], { historyKey: 'slide-design-viewport' }) 
      }} options={ratioOptions} value={ratioOptions.some(option => option.value === presentation.viewportRatio) ? presentation.viewportRatio : 'custom'} /></div>
      <div className="mona-design-canvas-size">{canvasSize}</div>
      <div className="mona-inspector-divider" />
      <div className="mona-design-title"><span>{t('designPanel.globalTheme')}</span><Button className="mona-design-more" onClick={() => setMore(value => !value)} size="xs" type="button" variant="ghost"><span>{t('common.more')}</span>{more ? <DownIcon /> : <RightIcon />}</Button></div>
      <DesignRow label={`${t('common.font')}:`}><InspectorSelect ariaLabel={t('common.font')} onChange={fontName => updateTheme({ fontName })} options={[{ label: t('common.defaultFont'), value: '' }, ...fontOptions]} search searchLabel={t('canvas.fontSearch')} value={presentation.theme.fontName} /></DesignRow>
      <DesignRow label={`${t('common.fontColor')}:`}><InspectorColorButton ariaLabel={t('common.fontColor')} color={presentation.theme.fontColor} onChange={fontColor => updateTheme({ fontColor })} /></DesignRow>
      <DesignRow label={`${t('common.backgroundColor')}:`}><InspectorColorButton ariaLabel={t('common.backgroundColor')} color={presentation.theme.backgroundColor} onChange={backgroundColor => updateTheme({ backgroundColor })} /></DesignRow>
      <DesignRow label={`${t('common.themeColor')}:`}><ThemeColorListButton colors={presentation.theme.themeColors} onClick={() => setThemeColorsOpen(true)} /></DesignRow>
      {more ? (
        <>
          <DesignRow label={t('toolbar.borderStyle')}><InspectorSelect ariaLabel={t('toolbar.borderStyle')} onChange={style => updateTheme({ outline: { ...presentation.theme.outline, style } })} options={lineStyleOptions} renderLabel={option => <LineStylePreview type={option?.value || 'solid'} />} renderOption={option => <LineStylePreview type={option.value} />} value={presentation.theme.outline.style || 'solid'} /></DesignRow>
          <DesignRow label={t('toolbar.borderColor')}><InspectorColorButton ariaLabel={t('toolbar.borderColor')} color={presentation.theme.outline.color || '#000'} onChange={color => updateTheme({ outline: { ...presentation.theme.outline, color } })} /></DesignRow>
          <DesignRow label={t('toolbar.borderWidth')}><InspectorNumberInput ariaLabel={t('toolbar.borderWidth')} onChange={width => updateTheme({ outline: { ...presentation.theme.outline, width } })} value={presentation.theme.outline.width || 0} /></DesignRow>
          <DesignRow label={t('toolbar.shadowHorizontal')} style={{ height: 30 }}><InspectorSlider ariaLabel={t('toolbar.shadowHorizontal')} max={20} min={-20} onChange={h => updateTheme({ shadow: { ...presentation.theme.shadow, h } })} value={presentation.theme.shadow.h} /></DesignRow>
          <DesignRow label={t('toolbar.shadowVertical')} style={{ height: 30 }}><InspectorSlider ariaLabel={t('toolbar.shadowVertical')} max={20} min={-20} onChange={v => updateTheme({ shadow: { ...presentation.theme.shadow, v } })} value={presentation.theme.shadow.v} /></DesignRow>
          <DesignRow label={t('toolbar.blurRadius')} style={{ height: 30 }}><InspectorSlider ariaLabel={t('toolbar.blurRadius')} max={30} min={1} onChange={blur => updateTheme({ shadow: { ...presentation.theme.shadow, blur } })} value={presentation.theme.shadow.blur} /></DesignRow>
          <DesignRow label={t('toolbar.shadowColor')}><InspectorColorButton ariaLabel={t('toolbar.shadowColor')} color={presentation.theme.shadow.color} onChange={color => updateTheme({ shadow: { ...presentation.theme.shadow, color } })} /></DesignRow>
        </>
      ) : null}
      <div className="mona-design-row-full"><InspectorButton ariaLabel={t('designPanel.applyThemeAll')} onClick={() => runtime.commit('Apply theme to all slides', [{ type: 'presentation.slides.replace', slides: applyThemeToSlides(presentation.slides, presentation.theme, more) }], { historyKey })} style={{ width: '100%' }}><CheckIcon /> {t('designPanel.applyThemeAll')}</InspectorButton></div>
      <div className="mona-design-row-full"><InspectorButton ariaLabel={t('designPanel.applyFontAll')} onClick={() => runtime.commit('Apply font to all slides', [{ type: 'presentation.slides.replace', slides: applyFontToSlides(presentation.slides, presentation.theme.fontName) }], { historyKey })} style={{ width: '100%' }}><CheckIcon /> {t('designPanel.applyFontAll')}</InspectorButton></div>
      <div className="mona-design-row-full"><InspectorButton ariaLabel={t('designPanel.extractTheme')} onClick={() => setThemeExtractOpen(true)} style={{ width: '100%' }}><PaletteIcon /> {t('designPanel.extractTheme')}</InspectorButton></div>
      <div className="mona-inspector-divider" />
      <div className="mona-design-title">{t('designPanel.presetThemes')}</div>
      <div className="mona-preset-theme-list">
        {PRESET_THEMES.map((preset, index) => (
          <div className="mona-preset-theme" key={index} style={{ backgroundColor: preset.background, fontFamily: preset.fontname }}>
            <div className="mona-preset-theme-content">
              <div className="mona-preset-theme-text" style={{ color: preset.fontColor }}>{t('designPanel.sampleText')}</div>
              <div className="mona-preset-theme-colors">{preset.colors.map((color, colorIndex) => <span key={colorIndex} style={{ backgroundColor: color }} />)}</div>
              <div className="mona-preset-theme-actions">
                <Button onClick={() => applyPreset(preset)} size="xs" type="button">{t('designPanel.set')}</Button>
                <Button onClick={() => applyPreset(preset, true)} size="xs" type="button">{t('designPanel.setAndApply')}</Button>
              </div>
            </div>
          </div>
        ))}
      </div>
      {themeColorsOpen ? <EditorModal onClose={() => setThemeColorsOpen(false)} open title={t('designPanel.editThemeColors')} width={310}><ThemeColorsSetting runtime={runtime} /></EditorModal> : null}
      {themeExtractOpen ? <EditorModal onClose={() => setThemeExtractOpen(false)} open title={t('designPanel.extractTheme')} width={320}><ThemeStylesExtract runtime={runtime} /></EditorModal> : null}
      {viewportOpen ? <EditorModal onClose={() => setViewportOpen(false)} open title={t('designPanel.customCanvas')} width={300}><ViewportSizeSetting runtime={runtime} /></EditorModal> : null}
    </div>
  )
}
