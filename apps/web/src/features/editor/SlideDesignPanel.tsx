import { useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import tinycolor from 'tinycolor2'

import CheckIcon from '~icons/icon-park-outline/check'
import DownIcon from '~icons/icon-park-outline/down'
import PaletteIcon from '~icons/icon-park-outline/platte'
import PlusIcon from '~icons/icon-park-outline/plus'
import RightIcon from '~icons/icon-park-outline/right'
import type {
  Gradient,
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
import { LinePreview } from '@/features/editor/ElementStyleCommons'
import { useEditorModalClose } from '@/features/editor/editor-modal-context'
import { startListReorder } from '@/features/editor/editor-list-reorder'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { fileToDataUrl } from '@/features/editor/editor-image'
import { lineStyleOptions } from '@/features/editor/editor-style-options'
import { editorFontOptions } from '@/features/editor/editor-text-options'
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

function DesignRow({ children, label, style }: { children: React.ReactNode; label: string; style?: React.CSSProperties }) {
  return <div className="mb-2.5 flex w-full items-center" style={style}><div className="w-2/5">{label}</div><div className="w-3/5 [&>*]:w-full">{children}</div></div>
}

function ThemeColorListButton({ colors, onClick }: { colors: readonly string[]; onClick: () => void }) {
  return (
    <Button aria-label="Theme colors" className="w-full justify-center" onClick={onClick} size="editor" type="button" variant="outline">
      <span className="ml-2 flex h-5 flex-1 outline outline-1 outline-dashed outline-[rgb(102_102_102/0.12)]">
        {colors.slice(0, 12).map((color, index) => <span className="mona-theme-color-block" key={`${color}-${index}`}><span style={{ backgroundColor: color }} /></span>)}
      </span>
      <PaletteIcon className="w-8 text-muted-foreground" />
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
    <div>
      <div className="mb-3.75 text-[17px] font-bold">{t('designPanel.customCanvas')}</div>
      <div className="mb-2.5 flex w-full items-center text-control [&>div:first-child]:w-12.5 [&>*:last-child]:flex-1"><div>{t('toolbar.width')}</div><InspectorNumberInput ariaLabel={t('toolbar.width')} max={max} min={min} onChange={setWidth} onEnter={value => apply(value, height)} value={width} /></div>
      <div className="mb-2.5 flex w-full items-center text-control [&>div:first-child]:w-12.5 [&>*:last-child]:flex-1"><div>{t('toolbar.height')}</div><InspectorNumberInput ariaLabel={t('toolbar.height')} max={max} min={min} onChange={setHeight} onEnter={value => apply(width, value)} value={height} /></div>
      <div className="mb-4.5 text-xs text-muted-foreground">{t('designPanel.sizeRange', { min, max })}</div>
      <div className="flex justify-end gap-2.5">
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
  const startReorder = (event: ReactPointerEvent<HTMLDivElement>, oldIndex: number) => startListReorder(event, oldIndex, {
    getRows: () => document.querySelectorAll<HTMLElement>('.mona-theme-colors-row'),
    onReorder: (from, to) => setColors(current => {
      const next = [...current]
      const item = next.splice(from, 1)[0]!
      next.splice(to, 0, item)
      return next
    }),
  })
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
    <div className="flex flex-col">
      <div className="mb-3.75 text-[17px] font-bold">{t('designPanel.editThemeColors')}</div>
      {colors.map((color, index) => (
        <div className="mona-theme-colors-row mb-2.5 flex w-full items-center [&>*:last-child]:w-3/5" key={index}>
          <div className="w-2/5 cursor-move text-control" onPointerDown={event => startReorder(event, index)}>{t('designPanel.slideThemeColor', { number: index + 1 })}</div>
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
    { key: 'fontName' as const, label: `${t('common.font')}:`, values: styles.fontNames, visual: (value: string) => <span className="h-6.25 w-37.5 truncate rounded-control border px-1.25 text-center text-xs leading-[25px]" style={{ fontFamily: value }}>{editorFontOptions.find(item => item.value === value)?.label || value}</span>, apply: (value: string) => updateTheme({ fontName: value }) },
    { key: 'fontColor' as const, label: `${t('toolbar.textColor')}:`, values: styles.fontColors, visual: (value: string) => <span className="h-6.25 w-37.5 truncate rounded-control border px-1.25 text-center text-xs leading-[25px]" style={{ backgroundColor: value, color: readable(value) }}>{hex(value)}</span>, apply: (value: string) => updateTheme({ fontColor: value }) },
    { key: 'backgroundColor' as const, label: `${t('common.backgroundColor')}:`, values: styles.backgroundColors, visual: (value: string) => <span className="h-6.25 w-37.5 truncate rounded-control border px-1.25 text-center text-xs leading-[25px]" style={{ backgroundColor: value, color: readable(value) }}>{hex(value)}</span>, apply: (value: string) => updateTheme({ backgroundColor: value }) },
  ]
  return (
    <div className="flex h-125 flex-col">
      <Tabs onValueChange={value => selectTab(value as 'single' | 'all')} value={activeTab}>
        <TabsList className="w-full justify-start border-b" variant="line">
          <TabsTrigger value="single">{t('designPanel.extractCurrent')}</TabsTrigger>
          <TabsTrigger value="all">{t('designPanel.extractAll')}</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="mr-[-20px] flex-1 overflow-auto pr-5">
        {optionRows.map(row => row.values.length ? (
          <div className="border-b border-dashed pt-3 pb-2.5 text-control" key={row.key}>
            <div className="mb-1.25 flex items-center [&_span]:text-xs [&_span]:text-muted-foreground">{row.label}</div>
            {row.values.map((value, index) => (
              <div className="mt-0.75 flex items-center justify-between" key={value}>
                {row.visual(value)}
                <div className="ml-2.5 flex flex-1 items-center justify-between text-xs">
                  <span className={selection[row.key] === index ? 'text-field opacity-100' : 'text-field opacity-0'}><CheckIcon /></span>
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
          <div className="border-b border-dashed pt-3 pb-2.5 text-control">
            <div className="mb-1.25 flex items-center [&_span]:text-xs [&_span]:text-muted-foreground">{`${t('common.themeColor')}: `}<span>({t('designPanel.excludeColorTip')})</span></div>
            <div className="grid grid-cols-10 gap-[1.111111%] [&_button]:relative [&_button]:h-6.25 [&_button]:rounded-control [&_button]:border [&_button]:p-0 [&_button.is-disabled]:opacity-20 [&_button.is-disabled]:before:absolute [&_button.is-disabled]:before:top-2.75 [&_button.is-disabled]:before:-left-px [&_button.is-disabled]:before:h-0.5 [&_button.is-disabled]:before:w-6 [&_button.is-disabled]:before:rotate-45 [&_button.is-disabled]:before:bg-black [&_button.is-disabled]:before:content-[''] [&_button.is-disabled]:after:absolute [&_button.is-disabled]:after:top-2.75 [&_button.is-disabled]:after:-left-px [&_button.is-disabled]:after:h-0.5 [&_button.is-disabled]:after:w-6 [&_button.is-disabled]:after:-rotate-45 [&_button.is-disabled]:after:bg-black [&_button.is-disabled]:after:content-['']">
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
    <div className="select-none">
      <div className="mb-2.5 flex justify-between">{t('designPanel.backgroundFill')}</div>
      <div className="mb-2.5 flex w-full items-center gap-2.5 [&>*]:min-w-0 [&>*]:flex-1">
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
        <label className="relative mb-2.5 block h-0 rounded-control border border-dashed pb-[56.25%] transition-colors hover:border-foreground hover:text-foreground">
          <input accept="image/*" hidden onChange={event => {
            const file = event.target.files?.[0]; if (file) void fileToDataUrl(file).then(src => updateImage({ src }))
          }} type="file" />
          <span className="absolute inset-0 flex items-center justify-center bg-contain bg-center bg-no-repeat" style={{ backgroundImage: `url(${background.image?.src})` }}><PlusIcon /></span>
        </label>
      ) : null}
      {background.type === 'gradient' && background.gradient ? (
        <div>
          <div className="flex w-full items-center mb-2.5"><EditorGradientBar index={Math.min(gradientIndex, background.gradient.colors.length - 1)} onChange={colors => updateGradient({ colors })} onIndexChange={setGradientIndex} value={background.gradient.colors} /></div>
          <DesignRow label={t('toolbar.currentStop')}><InspectorColorButton ariaLabel={t('toolbar.currentStop')} color={background.gradient.colors[gradientIndex]?.color || '#fff'} onChange={color => updateGradient({ colors: background.gradient!.colors.map((item, index) => index === gradientIndex ? { ...item, color } : item) })} /></DesignRow>
          {background.gradient.type === 'linear' ? <DesignRow label={t('toolbar.gradientAngle')}><InspectorSlider ariaLabel={t('toolbar.gradientAngle')} max={360} min={0} onChange={rotate => updateGradient({ rotate })} step={15} value={background.gradient.rotate || 0} /></DesignRow> : null}
        </div>
      ) : null}
      <div className="flex w-full items-center mb-2.5"><InspectorButton ariaLabel={t('designPanel.applyBackgroundAll')} onClick={applyBackgroundAll} style={{ width: '100%' }}><CheckIcon /> {t('designPanel.applyBackgroundAll')}</InspectorButton></div>
      <div className="my-6 w-full border-t border-black/[0.06]" />
      <div className="flex w-full items-center mb-2.5"><InspectorSelect ariaLabel={t('designPanel.customCanvas')} onChange={value => {
        if (value === 'custom') setViewportOpen(true); else if (typeof value === 'number') runtime.commit('Set viewport ratio', [{ type: 'presentation.viewport-ratio.set', ratio: value }], { historyKey: 'slide-design-viewport' }) 
      }} options={ratioOptions} value={ratioOptions.some(option => option.value === presentation.viewportRatio) ? presentation.viewportRatio : 'custom'} /></div>
      <div className="w-full text-center text-xs text-muted-foreground">{canvasSize}</div>
      <div className="my-6 w-full border-t border-black/[0.06]" />
      <div className="mb-2.5 flex justify-between"><span>{t('designPanel.globalTheme')}</span><Button className="gap-0.75 text-xs" onClick={() => setMore(value => !value)} size="xs" type="button" variant="ghost"><span>{t('common.more')}</span>{more ? <DownIcon /> : <RightIcon />}</Button></div>
      <DesignRow label={`${t('common.font')}:`}><InspectorSelect ariaLabel={t('common.font')} onChange={fontName => updateTheme({ fontName })} options={[{ label: t('common.defaultFont'), value: '' }, ...editorFontOptions]} search searchLabel={t('canvas.fontSearch')} value={presentation.theme.fontName} /></DesignRow>
      <DesignRow label={`${t('common.fontColor')}:`}><InspectorColorButton ariaLabel={t('common.fontColor')} color={presentation.theme.fontColor} onChange={fontColor => updateTheme({ fontColor })} /></DesignRow>
      <DesignRow label={`${t('common.backgroundColor')}:`}><InspectorColorButton ariaLabel={t('common.backgroundColor')} color={presentation.theme.backgroundColor} onChange={backgroundColor => updateTheme({ backgroundColor })} /></DesignRow>
      <DesignRow label={`${t('common.themeColor')}:`}><ThemeColorListButton colors={presentation.theme.themeColors} onClick={() => setThemeColorsOpen(true)} /></DesignRow>
      {more ? (
        <>
          <DesignRow label={t('toolbar.borderStyle')}><InspectorSelect ariaLabel={t('toolbar.borderStyle')} onChange={style => updateTheme({ outline: { ...presentation.theme.outline, style } })} options={lineStyleOptions} renderLabel={option => <LinePreview type={option?.value || 'solid'} />} renderOption={option => <LinePreview type={option.value} />} value={presentation.theme.outline.style || 'solid'} /></DesignRow>
          <DesignRow label={t('toolbar.borderColor')}><InspectorColorButton ariaLabel={t('toolbar.borderColor')} color={presentation.theme.outline.color || '#000'} onChange={color => updateTheme({ outline: { ...presentation.theme.outline, color } })} /></DesignRow>
          <DesignRow label={t('toolbar.borderWidth')}><InspectorNumberInput ariaLabel={t('toolbar.borderWidth')} onChange={width => updateTheme({ outline: { ...presentation.theme.outline, width } })} value={presentation.theme.outline.width || 0} /></DesignRow>
          <DesignRow label={t('toolbar.shadowHorizontal')} style={{ height: 30 }}><InspectorSlider ariaLabel={t('toolbar.shadowHorizontal')} max={20} min={-20} onChange={h => updateTheme({ shadow: { ...presentation.theme.shadow, h } })} value={presentation.theme.shadow.h} /></DesignRow>
          <DesignRow label={t('toolbar.shadowVertical')} style={{ height: 30 }}><InspectorSlider ariaLabel={t('toolbar.shadowVertical')} max={20} min={-20} onChange={v => updateTheme({ shadow: { ...presentation.theme.shadow, v } })} value={presentation.theme.shadow.v} /></DesignRow>
          <DesignRow label={t('toolbar.blurRadius')} style={{ height: 30 }}><InspectorSlider ariaLabel={t('toolbar.blurRadius')} max={30} min={1} onChange={blur => updateTheme({ shadow: { ...presentation.theme.shadow, blur } })} value={presentation.theme.shadow.blur} /></DesignRow>
          <DesignRow label={t('toolbar.shadowColor')}><InspectorColorButton ariaLabel={t('toolbar.shadowColor')} color={presentation.theme.shadow.color} onChange={color => updateTheme({ shadow: { ...presentation.theme.shadow, color } })} /></DesignRow>
        </>
      ) : null}
      <div className="flex w-full items-center mb-2.5"><InspectorButton ariaLabel={t('designPanel.applyThemeAll')} onClick={() => runtime.commit('Apply theme to all slides', [{ type: 'presentation.slides.replace', slides: applyThemeToSlides(presentation.slides, presentation.theme, more) }], { historyKey })} style={{ width: '100%' }}><CheckIcon /> {t('designPanel.applyThemeAll')}</InspectorButton></div>
      <div className="flex w-full items-center mb-2.5"><InspectorButton ariaLabel={t('designPanel.applyFontAll')} onClick={() => runtime.commit('Apply font to all slides', [{ type: 'presentation.slides.replace', slides: applyFontToSlides(presentation.slides, presentation.theme.fontName) }], { historyKey })} style={{ width: '100%' }}><CheckIcon /> {t('designPanel.applyFontAll')}</InspectorButton></div>
      <div className="flex w-full items-center mb-2.5"><InspectorButton ariaLabel={t('designPanel.extractTheme')} onClick={() => setThemeExtractOpen(true)} style={{ width: '100%' }}><PaletteIcon /> {t('designPanel.extractTheme')}</InspectorButton></div>
      <div className="my-6 w-full border-t border-black/[0.06]" />
      <div className="mb-2.5 flex justify-between">{t('designPanel.presetThemes')}</div>
      <div className="flex flex-wrap content-start">
        {PRESET_THEMES.map((preset, index) => (
          <div className="group/preset relative mb-[4%] w-[48%] rounded-control pb-[27%] [&:not(:nth-child(2n))]:mr-[4%]" key={index} style={{ backgroundColor: preset.background, fontFamily: preset.fontname }}>
            <div className="absolute inset-0 flex flex-col justify-center rounded-control border p-2">
              <div className="text-field" style={{ color: preset.fontColor }}>{t('designPanel.sampleText')}</div>
              <div className="mt-1.5 flex [&>span]:mr-0.5 [&>span]:size-3">{preset.colors.map((color, colorIndex) => <span key={colorIndex} style={{ backgroundColor: color }} />)}</div>
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.75 bg-black/25 opacity-0 transition-opacity group-hover/preset:opacity-100">
                <Button className="h-6 text-xs" onClick={() => applyPreset(preset)} size="xs" type="button">{t('designPanel.set')}</Button>
                <Button className="h-6 text-xs" onClick={() => applyPreset(preset, true)} size="xs" type="button">{t('designPanel.setAndApply')}</Button>
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
