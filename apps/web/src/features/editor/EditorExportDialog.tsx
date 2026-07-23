import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { selectPresentation } from '@mona/editor-state'
import type { Slide } from '@mona/presentation-core/model'

import DownloadIcon from '~icons/icon-park-outline/download'

import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { EditorFullscreenSpin } from '@/features/editor/EditorFullscreenSpin'
import { InspectorSelect } from '@/features/editor/EditorInspectorPrimitives'
import { EditorModal } from '@/features/editor/EditorModal'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { useEditorSelector } from '@/features/editor/use-editor-selector'
import { SlideRenderer } from '@/features/presentation-renderer/SlideRenderer'

export type ExportDialogType = 'image' | 'json' | 'native' | 'pdf' | 'pptx'
type RangeType = 'all' | 'current' | 'custom'

export interface EditorExportActions {
  exportImage: (node: HTMLElement, format: 'jpeg' | 'png', quality: number, ignoreWebfont: boolean) => Promise<void>
  exportImagePptx: (nodes: NodeListOf<Element>) => Promise<void>
  exportJson: () => void
  exportNative: (slides: Slide[]) => void
  exportPptx: (slides: Slide[], masterOverwrite: boolean, ignoreMedia: boolean) => Promise<void>
  printPdf: (node: HTMLElement, page: { height: number; margin: number; width: number }) => Promise<void>
}

function ExportButton({ children, className = '', onClick, primary = false }: { children: ReactNode; className?: string; onClick: () => void; primary?: boolean }) {
  return <Button className={`mona-export-button ${primary ? 'is-primary' : 'is-default'} ${className}`} onClick={onClick} size="editor" variant={primary ? 'default' : 'outline'}>{children}</Button>
}

function ExportRadioGroup({ ariaLabel, items, onChange, value }: { ariaLabel: string; items: Array<{ label: string; value: string }>; onChange: (value: string) => void; value: string }) {
  return <ToggleGroup aria-label={ariaLabel} className="mona-export-radio-group" onValueChange={next => {
    if (next) onChange(next)
  }} spacing={0} type="single" value={value} variant="outline">{items.map(item => <ToggleGroupItem className="mona-export-radio" key={item.value} value={item.value}>{item.label}</ToggleGroupItem>)}</ToggleGroup>
}

function ExportSwitch({ ariaLabel, checked, onChange }: { ariaLabel: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <Switch aria-label={ariaLabel} checked={checked} className="mona-export-switch" onCheckedChange={onChange} />
}

function ExportSlider({ ariaLabel, max, min, onChange, step, value }: { ariaLabel: string; max: number; min: number; onChange: (value: number) => void; step: number; value: number }) {
  return <Slider aria-label={ariaLabel} className="mona-export-slider" getValueLabel={entry => String(entry)} max={max} min={min} onValueChange={next => onChange(next[0] ?? value)} step={step} value={[value]} />
}

function ExportRangeSlider({ ariaLabel, max, min, onChange, step, value }: { ariaLabel: string; max: number; min: number; onChange: (value: [number, number]) => void; step: number; value: [number, number] }) {
  return <Slider aria-label={ariaLabel} className="mona-export-slider" getValueLabel={entry => String(entry)} max={max} min={min} onValueChange={next => onChange([next[0] ?? value[0], next[1] ?? value[1]])} step={step} value={value} />
}

function HiddenSlideSurfaces({ breakEvery, className, slides, presentation }: { breakEvery?: number; className: string; slides: Slide[]; presentation: ReturnType<typeof selectPresentation> }) {
  const scale = 1600 / presentation.viewportSize
  return <>{slides.map((slide, index) => <div className={`mona-export-thumbnail ${className}${breakEvery && (index + 1) % breakEvery === 0 ? ' break-page' : ''}`} key={slide.id} style={{ height: 1600 * presentation.viewportRatio, width: 1600 }}><div style={{ height: presentation.viewportSize * presentation.viewportRatio, transform: `scale(${scale})`, transformOrigin: '0 0', width: presentation.viewportSize }}><SlideRenderer slide={slide} sourcePackages={presentation.sourcePackages} theme={presentation.theme} thumbnail viewportRatio={presentation.viewportRatio} viewportSize={presentation.viewportSize} /></div></div>)}</>
}

const selectedSlides = (slides: Slide[], current: Slide, type: RangeType, range: [number, number]) => {
  if (type === 'all') return slides
  if (type === 'current') return [current]
  return slides.filter((_slide, index) => index >= range[0] - 1 && index <= range[1] - 1)
}

function PptxExport({ actions, close, onExporting, runtime }: ExportPanelProps) {
  const { t } = useTranslation()
  const presentation = useEditorSelector(runtime.store, selectPresentation)
  const current = presentation.slides[presentation.slideIndex]!
  const hiddenRef = useRef<HTMLDivElement>(null)
  const [rangeType, setRangeType] = useState<RangeType>('all')
  const [mode, setMode] = useState<'image' | 'standard'>('standard')
  const [range, setRange] = useState<[number, number]>([1, presentation.slides.length])
  const [ignoreMedia, setIgnoreMedia] = useState(true)
  const [masterOverwrite, setMasterOverwrite] = useState(true)
  const slides = selectedSlides(presentation.slides, current, rangeType, range)
  const execute = () => {
    onExporting(true)
    const promise = mode === 'standard'
      ? actions.exportPptx(slides, masterOverwrite, ignoreMedia)
      : actions.exportImagePptx(hiddenRef.current!.querySelectorAll('.mona-export-image-pptx-thumbnail'))
    void promise.finally(() => onExporting(false))
  }
  return <div className="mona-export-panel mona-export-pptx-panel">
    <div className="mona-export-thumbnails-view"><div ref={hiddenRef}><HiddenSlideSurfaces className="mona-export-image-pptx-thumbnail" presentation={presentation} slides={mode === 'image' ? slides : []} /></div></div>
    <div className="mona-export-configs is-wide">
      <ExportRow label={t('export.range')}><ExportRadioGroup ariaLabel={t('export.range')} items={[{ label: t('common.all'), value: 'all' }, { label: t('common.currentSlide'), value: 'current' }, { label: t('common.custom'), value: 'custom' }]} onChange={value => setRangeType(value as RangeType)} value={rangeType} /></ExportRow>
      <ExportRow label={t('export.mode')}><ExportRadioGroup ariaLabel={t('export.mode')} items={[{ label: t('export.standard'), value: 'standard' }, { label: t('export.imageOnly'), value: 'image' }]} onChange={value => setMode(value as 'image' | 'standard')} value={mode} /></ExportRow>
      {rangeType === 'custom' ? <ExportRow extra={`(${range[0]}–${range[1]})`} label={`${t('common.customRange')}:`} marginBottom={32}><ExportRangeSlider ariaLabel={t('common.customRange')} max={presentation.slides.length} min={1} onChange={setRange} step={1} value={range} /></ExportRow> : null}
      {mode === 'standard' ? <>
        <ExportRow label={t('export.ignoreMedia')}><ExportSwitch ariaLabel={t('export.ignoreMedia')} checked={ignoreMedia} onChange={setIgnoreMedia} /></ExportRow>
        <ExportRow label={t('export.overwriteMaster')}><ExportSwitch ariaLabel={t('export.overwriteMaster')} checked={masterOverwrite} onChange={setMasterOverwrite} /></ExportRow>
        {!ignoreMedia ? <div className="mona-export-tip is-compact">{t('export.mediaTip')}</div> : null}
      </> : null}
    </div>
    <ExportButtons close={close} label={t('export.exportPptx')} onExport={execute} />
  </div>
}

function NativeExport({ actions, close, runtime }: ExportPanelProps) {
  const { t } = useTranslation()
  const presentation = useEditorSelector(runtime.store, selectPresentation)
  const current = presentation.slides[presentation.slideIndex]!
  const [rangeType, setRangeType] = useState<RangeType>('all')
  const [range, setRange] = useState<[number, number]>([1, presentation.slides.length])
  const slides = selectedSlides(presentation.slides, current, rangeType, range)
  return <div className="mona-export-panel mona-export-native-panel"><div className="mona-export-configs is-wide">
    <ExportRow label={t('export.range')}><ExportRadioGroup ariaLabel={t('export.range')} items={[{ label: t('common.all'), value: 'all' }, { label: t('common.currentSlide'), value: 'current' }, { label: t('common.custom'), value: 'custom' }]} onChange={value => setRangeType(value as RangeType)} value={rangeType} /></ExportRow>
    {rangeType === 'custom' ? <ExportRow extra={`(${range[0]}–${range[1]})`} label={`${t('common.customRange')}:`}><ExportRangeSlider ariaLabel={t('common.customRange')} max={presentation.slides.length} min={1} onChange={setRange} step={1} value={range} /></ExportRow> : null}
    <div className="mona-export-tip">{t('export.nativeFileTip')}</div>
  </div><ExportButtons close={close} label={t('export.exportNative')} onExport={() => actions.exportNative(slides)} /></div>
}

function JsonExport({ actions, close, runtime }: ExportPanelProps) {
  const { t } = useTranslation()
  const presentation = useEditorSelector(runtime.store, selectPresentation)
  const json = { title: presentation.title, width: presentation.viewportSize, height: presentation.viewportSize * presentation.viewportRatio, theme: presentation.theme, slides: presentation.slides }
  return <div className="mona-export-panel mona-export-json-panel"><div className="mona-export-json-preview"><pre>{JSON.stringify(json, null, 2)}</pre></div><ExportButtons close={close} label={t('export.exportJson')} onExport={actions.exportJson} /></div>
}

function ImageExport({ actions, close, onExporting, runtime }: ExportPanelProps) {
  const { t } = useTranslation()
  const presentation = useEditorSelector(runtime.store, selectPresentation)
  const current = presentation.slides[presentation.slideIndex]!
  const hiddenRef = useRef<HTMLDivElement>(null)
  const [format, setFormat] = useState<'jpeg' | 'png'>('jpeg')
  const [rangeType, setRangeType] = useState<RangeType>('all')
  const [range, setRange] = useState<[number, number]>([1, presentation.slides.length])
  const [quality, setQuality] = useState(1)
  const [ignoreWebfont, setIgnoreWebfont] = useState(false)
  const slides = selectedSlides(presentation.slides, current, rangeType, range)
  const execute = () => {
    onExporting(true)
    void actions.exportImage(hiddenRef.current!, format, quality, ignoreWebfont).finally(() => onExporting(false))
  }
  return <div className="mona-export-panel mona-export-image-panel"><div className="mona-export-thumbnails-view"><div ref={hiddenRef}><HiddenSlideSurfaces className="mona-export-image-thumbnail" presentation={presentation} slides={slides} /></div></div><div className="mona-export-configs is-wide">
    <ExportRow label={t('export.format')}><ExportRadioGroup ariaLabel={t('export.format')} items={[{ label: 'JPEG', value: 'jpeg' }, { label: 'PNG', value: 'png' }]} onChange={value => setFormat(value as 'jpeg' | 'png')} value={format} /></ExportRow>
    <ExportRow label={t('export.range')}><ExportRadioGroup ariaLabel={t('export.range')} items={[{ label: t('common.all'), value: 'all' }, { label: t('common.currentSlide'), value: 'current' }, { label: t('common.custom'), value: 'custom' }]} onChange={value => setRangeType(value as RangeType)} value={rangeType} /></ExportRow>
    {rangeType === 'custom' ? <ExportRow extra={`(${range[0]}–${range[1]})`} label={`${t('common.customRange')}:`} marginBottom={32}><ExportRangeSlider ariaLabel={t('common.customRange')} max={presentation.slides.length} min={1} onChange={setRange} step={1} value={range} /></ExportRow> : null}
    <ExportRow label={t('export.imageQuality')}><ExportSlider ariaLabel={t('export.imageQuality')} max={1} min={0} onChange={setQuality} step={0.1} value={quality} /></ExportRow>
    <ExportRow label={t('export.ignoreWebFonts')}><ExportSwitch ariaLabel={t('export.ignoreWebFonts')} checked={ignoreWebfont} onChange={setIgnoreWebfont} /></ExportRow>
  </div><ExportButtons close={close} label={t('export.exportImage')} onExport={execute} /></div>
}

function PdfExport({ actions, close, onExporting, runtime }: ExportPanelProps) {
  const { t } = useTranslation()
  const presentation = useEditorSelector(runtime.store, selectPresentation)
  const current = presentation.slides[presentation.slideIndex]!
  const hiddenRef = useRef<HTMLDivElement>(null)
  const [rangeType, setRangeType] = useState<'all' | 'current'>('all')
  const [count, setCount] = useState(1)
  const [padding, setPadding] = useState(true)
  const slides = rangeType === 'current' ? [current] : presentation.slides
  const execute = () => {
    onExporting(true)
    void actions.printPdf(hiddenRef.current!, { width: 1600, height: 1600 * presentation.viewportRatio * (rangeType === 'all' ? count : 1), margin: padding ? 50 : 0 })
      .finally(() => onExporting(false))
  }
  return <div className="mona-export-panel mona-export-pdf-panel"><div className="mona-export-thumbnails-view"><div ref={hiddenRef}><HiddenSlideSurfaces breakEvery={rangeType === 'all' ? count : undefined} className="mona-export-pdf-thumbnail" presentation={presentation} slides={slides} /></div></div><div className="mona-export-configs is-pdf">
    <ExportRow label={t('export.range')}><ExportRadioGroup ariaLabel={t('export.range')} items={[{ label: t('common.all'), value: 'all' }, { label: t('common.currentSlide'), value: 'current' }]} onChange={value => setRangeType(value as 'all' | 'current')} value={rangeType} /></ExportRow>
    <ExportRow label={t('export.slidesPerPage')}><InspectorSelect ariaLabel={t('export.slidesPerPage')} onChange={value => setCount(+value)} options={[1, 2, 3].map(value => ({ label: `${value}`, value }))} value={count} /></ExportRow>
    <ExportRow label={t('export.pageMargin')}><ExportSwitch ariaLabel={t('export.pageMargin')} checked={padding} onChange={setPadding} /></ExportRow>
    <div className="mona-export-tip">{t('export.printTip')}</div>
  </div><ExportButtons close={close} label={t('export.exportPdf')} onExport={execute} /></div>
}

function ExportRow({ children, extra, label, marginBottom }: { children: ReactNode; extra?: string; label: string; marginBottom?: number }) {
  return <div className="mona-export-row" style={marginBottom ? { marginBottom } : undefined}><div className="mona-export-row-title" data-range={extra}>{label}</div><div className="mona-export-row-control">{children}</div></div>
}

function ExportButtons({ close, label, onExport }: { close: () => void; label: string; onExport: () => void }) {
  const { t } = useTranslation()
  return <div className="mona-export-buttons"><ExportButton className="mona-export-submit" onClick={onExport} primary><DownloadIcon /> {label}</ExportButton><ExportButton className="mona-export-close" onClick={close}>{t('common.close')}</ExportButton></div>
}

interface ExportPanelProps {
  actions: EditorExportActions
  close: () => void
  onExporting: (value: boolean) => void
  runtime: EditorRuntime
}

export function EditorExportDialog({ actions, onClose, openType, runtime }: { actions: EditorExportActions; onClose: () => void; openType: ExportDialogType | null; runtime: EditorRuntime }) {
  if (!openType) return null
  return <EditorExportDialogContent actions={actions} initialType={openType} key={openType} onClose={onClose} runtime={runtime} />
}

function EditorExportDialogContent({ actions, initialType, onClose, runtime }: { actions: EditorExportActions; initialType: ExportDialogType; onClose: () => void; runtime: EditorRuntime }) {
  const { t } = useTranslation()
  const [exporting, setExporting] = useState(false)
  const tabs = useMemo<Array<{ label: string; type: ExportDialogType }>>(() => [
    { label: t('export.exportNative'), type: 'native' }, { label: t('export.exportPptx'), type: 'pptx' }, { label: t('export.exportImage'), type: 'image' }, { label: t('export.exportJson'), type: 'json' }, { label: t('export.exportPdf'), type: 'pdf' },
  ], [t])
  const [type, setType] = useState<ExportDialogType>(initialType)
  const props = { actions, close: onClose, onExporting: setExporting, runtime }
  return <><EditorModal onClose={onClose} open title={t('header.export')} width={680}>
    <Tabs className="mona-export-dialog" onValueChange={value => setType(value as ExportDialogType)} value={type}>
      {/* Full-bleed strip: neutralize the pill-list defaults (w-fit, muted
          background, inner padding) so the five triggers span the dialog. */}
      <TabsList className="h-10 w-full rounded-none bg-transparent p-0 mona-export-tabs">
        {tabs.map(tab => <TabsTrigger key={tab.type} value={tab.type}>{tab.label}</TabsTrigger>)}
      </TabsList>
      <TabsContent className="mona-export-content" value="native"><NativeExport {...props} /></TabsContent>
      <TabsContent className="mona-export-content" value="pptx"><PptxExport {...props} /></TabsContent>
      <TabsContent className="mona-export-content" value="image"><ImageExport {...props} /></TabsContent>
      <TabsContent className="mona-export-content" value="json"><JsonExport {...props} /></TabsContent>
      <TabsContent className="mona-export-content" value="pdf"><PdfExport {...props} /></TabsContent>
    </Tabs>
  </EditorModal><EditorFullscreenSpin loading={exporting} tip={t('common.exporting')} /></>
}
