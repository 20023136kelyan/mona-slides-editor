/* oxlint-disable jsx-a11y/prefer-tag-over-role -- PPTist's two-thumb slider is a direct-manipulation div; an input cannot preserve its source geometry or range semantics. */
import { useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { selectPresentation } from '@mona/editor-state'
import type { Slide } from '@mona/presentation-core/model'

import DownloadIcon from '~icons/icon-park-outline/download'

import { EditorFullscreenSpin } from '@/features/editor/EditorFullscreenSpin'
import { InspectorSelect } from '@/features/editor/EditorInspectorPrimitives'
import { EditorModal } from '@/features/editor/EditorModal'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { useEditorSelector } from '@/features/editor/use-editor-selector'
import { SlideRenderer } from '@/features/presentation-renderer/SlideRenderer'

export type ExportDialogType = 'image' | 'json' | 'pdf' | 'pptist' | 'pptx'
type RangeType = 'all' | 'current' | 'custom'

export interface EditorExportActions {
  exportImage: (node: HTMLElement, format: 'jpeg' | 'png', quality: number, ignoreWebfont: boolean) => Promise<void>
  exportImagePptx: (nodes: NodeListOf<Element>) => Promise<void>
  exportJson: () => void
  exportNative: (slides: Slide[]) => void
  exportPptx: (slides: Slide[], masterOverwrite: boolean, ignoreMedia: boolean) => Promise<void>
  printPdf: (node: HTMLElement, page: { height: number; margin: number; width: number }) => void
}

function ExportButton({ children, className = '', onClick, primary = false }: { children: ReactNode; className?: string; onClick: () => void; primary?: boolean }) {
  return <button className={`mona-export-button ${primary ? 'is-primary' : 'is-default'} ${className}`} onClick={onClick} type="button">{children}</button>
}

function ExportRadioGroup({ items, onChange, value }: { items: Array<{ label: string; value: string }>; onChange: (value: string) => void; value: string }) {
  return <div className="mona-export-radio-group">{items.map(item => <button className={`mona-export-radio${value === item.value ? ' is-checked' : ''}`} key={item.value} onClick={() => onChange(item.value)} type="button">{item.label}</button>)}</div>
}

function ExportSwitch({ ariaLabel, checked, onChange }: { ariaLabel: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <span aria-checked={checked} aria-label={ariaLabel} className={`mona-export-switch${checked ? ' is-active' : ''}`} onClick={() => onChange(!checked)} onKeyDown={event => {
    if (event.key === 'Enter' || event.key === ' ') onChange(!checked) 
  }} role="switch" tabIndex={0}><span /></span>
}

const valueAt = (clientX: number, element: HTMLElement, min: number, max: number, step: number) => {
  const rect = element.getBoundingClientRect()
  const percentage = Math.min(1, Math.max(0, (clientX - rect.left) / element.clientWidth))
  const stepped = Math.round((percentage * (max - min)) / step) * step + min
  const decimals = `${step}`.split('.')[1]?.length ?? 0
  return +Math.min(max, Math.max(min, stepped)).toFixed(decimals)
}

function ExportSlider({ max, min, onChange, step, value }: { max: number; min: number; onChange: (value: number) => void; step: number; value: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const percentage = max === min ? 0 : (value - min) / (max - min) * 100
  const start = (event: ReactMouseEvent) => {
    const element = ref.current
    if (!element) return
    const move = (moveEvent: MouseEvent) => onChange(valueAt(moveEvent.clientX, element, min, max, step))
    const end = (endEvent: MouseEvent) => {
      onChange(valueAt(endEvent.clientX, element, min, max, step))
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', end)
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', end)
    event.preventDefault()
  }
  return <div aria-label="slider" aria-valuemax={max} aria-valuemin={min} aria-valuenow={value} className="mona-export-slider" onMouseDown={start} ref={ref} role="slider" tabIndex={0}><div className="mona-export-slider-bar"><div className="mona-export-slider-track" style={{ width: `${percentage}%` }} /><div className="mona-export-slider-thumb" data-tooltip={value} style={{ left: `${percentage}%` }} /></div></div>
}

function ExportRangeSlider({ max, min, onChange, step, value }: { max: number; min: number; onChange: (value: [number, number]) => void; step: number; value: [number, number] }) {
  const ref = useRef<HTMLDivElement>(null)
  const toPercent = (entry: number) => max === min ? 0 : (entry - min) / (max - min) * 100
  const start = (event: ReactMouseEvent) => {
    const element = ref.current
    if (!element) return
    const selected = valueAt(event.clientX, element, min, max, step)
    const side = Math.abs(selected - value[0]) < Math.abs(selected - value[1]) ? 0 : 1
    const update = (clientX: number) => {
      const next: [number, number] = [...value]
      next[side] = valueAt(clientX, element, min, max, step)
      if (next[0] > next[1]) next.reverse()
      onChange(next)
    }
    const move = (moveEvent: MouseEvent) => update(moveEvent.clientX)
    const end = (endEvent: MouseEvent) => {
      update(endEvent.clientX)
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', end)
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', end)
    event.preventDefault()
  }
  const startPercent = toPercent(value[0])
  const endPercent = toPercent(value[1])
  return <div aria-label="range slider" aria-valuemax={max} aria-valuemin={min} aria-valuenow={value[1]} aria-valuetext={`${value[0]}–${value[1]}`} className="mona-export-slider" onMouseDown={start} ref={ref} role="slider" tabIndex={0}><div className="mona-export-slider-bar"><div className="mona-export-slider-track" style={{ left: `${startPercent}%`, width: `${endPercent - startPercent}%` }} /><div className="mona-export-slider-thumb" data-tooltip={value[0]} style={{ left: `${startPercent}%` }} /><div className="mona-export-slider-thumb" data-tooltip={value[1]} style={{ left: `${endPercent}%` }} /></div></div>
}

function HiddenSlideSurfaces({ breakEvery, className, slides, presentation }: { breakEvery?: number; className: string; slides: Slide[]; presentation: ReturnType<typeof selectPresentation> }) {
  const scale = 1600 / presentation.viewportSize
  return <>{slides.map((slide, index) => <div className={`mona-export-thumbnail ${className}${breakEvery && (index + 1) % breakEvery === 0 ? ' break-page' : ''}`} key={slide.id} style={{ height: 1600 * presentation.viewportRatio, width: 1600 }}><div style={{ height: presentation.viewportSize * presentation.viewportRatio, transform: `scale(${scale})`, transformOrigin: '0 0', width: presentation.viewportSize }}><SlideRenderer slide={slide} theme={presentation.theme} thumbnail viewportRatio={presentation.viewportRatio} viewportSize={presentation.viewportSize} /></div></div>)}</>
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
      <ExportRow label={t('export.range')}><ExportRadioGroup items={[{ label: t('common.all'), value: 'all' }, { label: t('common.currentSlide'), value: 'current' }, { label: t('common.custom'), value: 'custom' }]} onChange={value => setRangeType(value as RangeType)} value={rangeType} /></ExportRow>
      <ExportRow label={t('export.mode')}><ExportRadioGroup items={[{ label: t('export.standard'), value: 'standard' }, { label: t('export.imageOnly'), value: 'image' }]} onChange={value => setMode(value as 'image' | 'standard')} value={mode} /></ExportRow>
      {rangeType === 'custom' ? <ExportRow extra={`(${range[0]}–${range[1]})`} label={`${t('common.customRange')}:`} marginBottom={32}><ExportRangeSlider max={presentation.slides.length} min={1} onChange={setRange} step={1} value={range} /></ExportRow> : null}
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
    <ExportRow label={t('export.range')}><ExportRadioGroup items={[{ label: t('common.all'), value: 'all' }, { label: t('common.currentSlide'), value: 'current' }, { label: t('common.custom'), value: 'custom' }]} onChange={value => setRangeType(value as RangeType)} value={rangeType} /></ExportRow>
    {rangeType === 'custom' ? <ExportRow extra={`(${range[0]}–${range[1]})`} label={`${t('common.customRange')}:`}><ExportRangeSlider max={presentation.slides.length} min={1} onChange={setRange} step={1} value={range} /></ExportRow> : null}
    <div className="mona-export-tip">{t('export.nativeFileTip')}</div>
  </div><ExportButtons close={close} label={t('export.exportPptist')} onExport={() => actions.exportNative(slides)} /></div>
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
    <ExportRow label={t('export.format')}><ExportRadioGroup items={[{ label: 'JPEG', value: 'jpeg' }, { label: 'PNG', value: 'png' }]} onChange={value => setFormat(value as 'jpeg' | 'png')} value={format} /></ExportRow>
    <ExportRow label={t('export.range')}><ExportRadioGroup items={[{ label: t('common.all'), value: 'all' }, { label: t('common.currentSlide'), value: 'current' }, { label: t('common.custom'), value: 'custom' }]} onChange={value => setRangeType(value as RangeType)} value={rangeType} /></ExportRow>
    {rangeType === 'custom' ? <ExportRow extra={`(${range[0]}–${range[1]})`} label={`${t('common.customRange')}:`} marginBottom={32}><ExportRangeSlider max={presentation.slides.length} min={1} onChange={setRange} step={1} value={range} /></ExportRow> : null}
    <ExportRow label={t('export.imageQuality')}><ExportSlider max={1} min={0} onChange={setQuality} step={0.1} value={quality} /></ExportRow>
    <ExportRow label={t('export.ignoreWebFonts')}><ExportSwitch ariaLabel={t('export.ignoreWebFonts')} checked={ignoreWebfont} onChange={setIgnoreWebfont} /></ExportRow>
  </div><ExportButtons close={close} label={t('export.exportImage')} onExport={execute} /></div>
}

function PdfExport({ actions, close, runtime }: ExportPanelProps) {
  const { t } = useTranslation()
  const presentation = useEditorSelector(runtime.store, selectPresentation)
  const current = presentation.slides[presentation.slideIndex]!
  const hiddenRef = useRef<HTMLDivElement>(null)
  const [rangeType, setRangeType] = useState<'all' | 'current'>('all')
  const [count, setCount] = useState(1)
  const [padding, setPadding] = useState(true)
  const slides = rangeType === 'current' ? [current] : presentation.slides
  const execute = () => actions.printPdf(hiddenRef.current!, { width: 1600, height: 1600 * presentation.viewportRatio * (rangeType === 'all' ? count : 1), margin: padding ? 50 : 0 })
  return <div className="mona-export-panel mona-export-pdf-panel"><div className="mona-export-thumbnails-view"><div ref={hiddenRef}><HiddenSlideSurfaces breakEvery={rangeType === 'all' ? count : undefined} className="mona-export-pdf-thumbnail" presentation={presentation} slides={slides} /></div></div><div className="mona-export-configs is-pdf">
    <ExportRow label={t('export.range')}><ExportRadioGroup items={[{ label: t('common.all'), value: 'all' }, { label: t('common.currentSlide'), value: 'current' }]} onChange={value => setRangeType(value as 'all' | 'current')} value={rangeType} /></ExportRow>
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
    { label: t('export.exportPptist'), type: 'pptist' }, { label: t('export.exportPptx'), type: 'pptx' }, { label: t('export.exportImage'), type: 'image' }, { label: t('export.exportJson'), type: 'json' }, { label: t('export.exportPdf'), type: 'pdf' },
  ], [t])
  const [type, setType] = useState<ExportDialogType>(initialType)
  const props = { actions, close: onClose, onExporting: setExporting, runtime }
  return <><EditorModal onClose={onClose} open width={680}><div className="mona-export-dialog"><div className="mona-export-tabs">{tabs.map(tab => <button className={type === tab.type ? 'is-active' : ''} key={tab.type} onClick={() => setType(tab.type)} type="button">{tab.label}</button>)}</div><div className="mona-export-content" key={type}>{type === 'pptist' ? <NativeExport {...props} /> : type === 'pptx' ? <PptxExport {...props} /> : type === 'image' ? <ImageExport {...props} /> : type === 'json' ? <JsonExport {...props} /> : <PdfExport {...props} />}</div></div></EditorModal><EditorFullscreenSpin loading={exporting} tip={t('common.exporting')} /></>
}
