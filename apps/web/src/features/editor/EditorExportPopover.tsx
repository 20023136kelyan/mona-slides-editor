import { useCallback, useEffect, useId, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Code2, Download, Globe, Info, UserPlus, X } from 'lucide-react'

import { selectPresentation } from '@mona/editor-state'
import type { Slide } from '@mona/presentation-core/model'

import ImageIcon from '~icons/vscode-icons/file-type-image'
import JsonIcon from '~icons/vscode-icons/file-type-json'
import PdfIcon from '~icons/vscode-icons/file-type-pdf2'
import PowerPointIcon from '~icons/vscode-icons/file-type-powerpoint2'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { EditorFullscreenSpin } from '@/features/editor/EditorFullscreenSpin'
import { InspectorSelect } from '@/features/editor/EditorInspectorPrimitives'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { useEditorSelector } from '@/features/editor/use-editor-selector'
import { SlideRenderer } from '@/features/presentation-renderer/SlideRenderer'
import { cn } from '@/lib/utils'

type ShareTab = 'embed' | 'export' | 'invite' | 'public'

const SHARE_TABS: Array<{
  icon: ComponentType<{ className?: string }>
  id: ShareTab
  labelKey: string
}> = [
  { icon: UserPlus, id: 'invite', labelKey: 'share.invite' },
  { icon: Globe, id: 'public', labelKey: 'share.public' },
  { icon: Download, id: 'export', labelKey: 'share.export' },
  { icon: Code2, id: 'embed', labelKey: 'share.embed' },
]

function MonaIcon({ className }: { className?: string }) {
  return <img alt="" aria-hidden className={className} src="/favicon.svg" />
}

export type ExportType = 'image' | 'json' | 'native' | 'pdf' | 'pptx'
type RangeType = 'all' | 'current' | 'custom'

export interface EditorExportActions {
  exportImage: (node: HTMLElement, format: 'jpeg' | 'png', quality: number, ignoreWebfont: boolean) => Promise<void>
  exportImagePptx: (nodes: NodeListOf<Element>) => Promise<void>
  exportJson: () => void
  exportNative: (slides: Slide[]) => void
  exportPptx: (slides: Slide[], masterOverwrite: boolean, ignoreMedia: boolean) => Promise<void>
  printPdf: (node: HTMLElement, page: { height: number; margin: number; width: number }) => Promise<void>
}

function ExportField({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="mb-3">
      <div className="mb-1.5 text-xs font-medium text-muted-foreground">{label}</div>
      {children}
    </div>
  )
}

function ExportSwitchRow({ checked, label, onChange }: { checked: boolean; label: string; onChange: (checked: boolean) => void }) {
  const id = useId()
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <Label className="text-xs font-normal" htmlFor={id}>{label}</Label>
      <Switch checked={checked} id={id} onCheckedChange={onChange} size="sm" />
    </div>
  )
}

function ExportRadioGroup({ ariaLabel, items, onChange, value }: { ariaLabel: string; items: Array<{ label: string; value: string }>; onChange: (value: string) => void; value: string }) {
  return (
    <ToggleGroup
      aria-label={ariaLabel}
      className="w-full"
      onValueChange={next => {
        if (next) onChange(next)
      }}
      size="sm"
      spacing={0}
      type="single"
      value={value}
      variant="outline"
    >
      {items.map(item => (
        <ToggleGroupItem className="min-w-0 flex-1 px-1.5 text-xs whitespace-normal" key={item.value} value={item.value}>
          {item.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

function ExportTip({ children }: { children: ReactNode }) {
  return (
    <div className="mb-3 flex gap-2 rounded-[var(--radius-md)] border border-border bg-muted/60 px-2.5 py-2 text-xs leading-relaxed text-muted-foreground">
      <Info aria-hidden className="mt-0.5 size-3.5 shrink-0 text-foreground/45" />
      <p className="min-w-0">{children}</p>
    </div>
  )
}

/**
 * Off-viewport render layer for the slide surfaces that image/PDF exports
 * capture: `html-to-image` and the print iframe only need mounted nodes with
 * real layout, not visible ones. Captures must target a child of this layer
 * (never the layer itself) — `html-to-image` copies the captured node's own
 * computed styles, and this node's `fixed; left:-99999px` would shift the
 * clone out of frame.
 */
function ExportCaptureLayer({ children }: { children: ReactNode }) {
  return <div aria-hidden className="pointer-events-none fixed top-0 left-[-99999px]">{children}</div>
}

function HiddenSlideSurfaces({
  breakEvery,
  dataAttribute,
  slides,
  presentation,
}: {
  breakEvery?: number
  dataAttribute: string
  slides: Slide[]
  presentation: ReturnType<typeof selectPresentation>
}) {
  const scale = 1600 / presentation.viewportSize
  return <>{slides.map((slide, index) => (
    <div
      className={cn('overflow-hidden bg-background select-none', breakEvery && (index + 1) % breakEvery === 0 && 'break-after-page')}
      data-export-thumbnail={dataAttribute}
      key={slide.id}
      style={{ height: 1600 * presentation.viewportRatio, width: 1600 }}
    >
      <div style={{ height: presentation.viewportSize * presentation.viewportRatio, transform: `scale(${scale})`, transformOrigin: '0 0', width: presentation.viewportSize }}>
        <SlideRenderer slide={slide} sourcePackages={presentation.sourcePackages} theme={presentation.theme} thumbnail viewportRatio={presentation.viewportRatio} viewportSize={presentation.viewportSize} />
      </div>
    </div>
  ))}</>
}

const selectedSlides = (slides: Slide[], current: Slide, type: RangeType, range: [number, number]) => {
  if (type === 'all') return slides
  if (type === 'current') return [current]
  return slides.filter((_slide, index) => index >= range[0] - 1 && index <= range[1] - 1)
}

function useSlideRange(presentation: ReturnType<typeof selectPresentation>) {
  const [rangeType, setRangeType] = useState<RangeType>('all')
  const [range, setRange] = useState<[number, number]>([1, presentation.slides.length])
  const slides = selectedSlides(presentation.slides, presentation.slides[presentation.slideIndex]!, rangeType, range)
  return { range, rangeType, setRange, setRangeType, slides, total: presentation.slides.length }
}

function ExportRangeFields({ custom = true, state }: { custom?: boolean; state: ReturnType<typeof useSlideRange> }) {
  const { t } = useTranslation()
  return (
    <>
      <ExportField label={t('export.range')}>
        <ExportRadioGroup
          ariaLabel={t('export.range')}
          items={[
            { label: t('common.all'), value: 'all' },
            { label: t('common.currentSlide'), value: 'current' },
            ...custom ? [{ label: t('common.custom'), value: 'custom' }] : [],
          ]}
          onChange={value => state.setRangeType(value as RangeType)}
          value={state.rangeType}
        />
      </ExportField>
      {state.rangeType === 'custom' ? (
        <ExportField label={`${t('common.customRange')} (${state.range[0]}–${state.range[1]})`}>
          <Slider
            aria-label={t('common.customRange')}
            className="w-full"
            getValueLabel={entry => String(entry)}
            max={state.total}
            min={1}
            onValueChange={next => state.setRange([next[0] ?? state.range[0], next[1] ?? state.range[1]])}
            step={1}
            value={state.range}
          />
        </ExportField>
      ) : null}
    </>
  )
}

interface TypeOptionsProps {
  actions: EditorExportActions
  onExporting: (value: boolean) => void
  registerDownload: (download: () => void) => void
  runtime: EditorRuntime
}

function PptxOptions({ actions, onExporting, registerDownload, runtime }: TypeOptionsProps) {
  const { t } = useTranslation()
  const presentation = useEditorSelector(runtime.store, selectPresentation)
  const hiddenRef = useRef<HTMLDivElement>(null)
  const rangeState = useSlideRange(presentation)
  const [mode, setMode] = useState<'image' | 'standard'>('standard')
  const [ignoreMedia, setIgnoreMedia] = useState(true)
  const [masterOverwrite, setMasterOverwrite] = useState(true)
  useEffect(() => registerDownload(() => {
    onExporting(true)
    const promise = mode === 'standard'
      ? actions.exportPptx(rangeState.slides, masterOverwrite, ignoreMedia)
      : actions.exportImagePptx(hiddenRef.current!.querySelectorAll('[data-export-thumbnail="image-pptx"]'))
    void promise.finally(() => onExporting(false))
  }), [actions, ignoreMedia, masterOverwrite, mode, onExporting, rangeState.slides, registerDownload])
  return (
    <>
      <ExportCaptureLayer>
        <div ref={hiddenRef}>
          <HiddenSlideSurfaces dataAttribute="image-pptx" presentation={presentation} slides={mode === 'image' ? rangeState.slides : []} />
        </div>
      </ExportCaptureLayer>
      <ExportRangeFields state={rangeState} />
      <ExportField label={t('export.mode')}>
        <ExportRadioGroup ariaLabel={t('export.mode')} items={[{ label: t('export.standard'), value: 'standard' }, { label: t('export.imageOnly'), value: 'image' }]} onChange={value => setMode(value as 'image' | 'standard')} value={mode} />
      </ExportField>
      {mode === 'standard' ? (
        <>
          <ExportSwitchRow checked={ignoreMedia} label={t('export.ignoreMedia')} onChange={setIgnoreMedia} />
          <ExportSwitchRow checked={masterOverwrite} label={t('export.overwriteMaster')} onChange={setMasterOverwrite} />
          {!ignoreMedia ? <ExportTip>{t('export.mediaTip')}</ExportTip> : null}
        </>
      ) : null}
    </>
  )
}

function NativeOptions({ actions, registerDownload, runtime }: TypeOptionsProps) {
  const { t } = useTranslation()
  const presentation = useEditorSelector(runtime.store, selectPresentation)
  const rangeState = useSlideRange(presentation)
  useEffect(() => registerDownload(() => actions.exportNative(rangeState.slides)), [actions, rangeState.slides, registerDownload])
  return (
    <>
      <ExportRangeFields state={rangeState} />
      <ExportTip>{t('export.nativeFileTip')}</ExportTip>
    </>
  )
}

function JsonOptions({ actions, registerDownload }: TypeOptionsProps) {
  const { t } = useTranslation()
  useEffect(() => registerDownload(() => actions.exportJson()), [actions, registerDownload])
  return (
    <div className="mb-1 flex flex-col items-center gap-2 py-4">
      <JsonIcon aria-hidden className="size-14" />
      <p className="text-center text-xs text-muted-foreground">{t('export.jsonTip')}</p>
    </div>
  )
}

function ImageOptions({ actions, onExporting, registerDownload, runtime }: TypeOptionsProps) {
  const { t } = useTranslation()
  const presentation = useEditorSelector(runtime.store, selectPresentation)
  const hiddenRef = useRef<HTMLDivElement>(null)
  const rangeState = useSlideRange(presentation)
  const [format, setFormat] = useState<'jpeg' | 'png'>('jpeg')
  const [quality, setQuality] = useState(1)
  const [ignoreWebfont, setIgnoreWebfont] = useState(false)
  useEffect(() => registerDownload(() => {
    onExporting(true)
    void actions.exportImage(hiddenRef.current!, format, quality, ignoreWebfont).finally(() => onExporting(false))
  }), [actions, format, ignoreWebfont, onExporting, quality, registerDownload])
  return (
    <>
      <ExportCaptureLayer>
        <div ref={hiddenRef}>
          <HiddenSlideSurfaces dataAttribute="image" presentation={presentation} slides={rangeState.slides} />
        </div>
      </ExportCaptureLayer>
      <ExportField label={t('export.format')}>
        <ExportRadioGroup ariaLabel={t('export.format')} items={[{ label: 'JPEG', value: 'jpeg' }, { label: 'PNG', value: 'png' }]} onChange={value => setFormat(value as 'jpeg' | 'png')} value={format} />
      </ExportField>
      <ExportRangeFields state={rangeState} />
      <ExportField label={t('export.imageQuality')}>
        <Slider aria-label={t('export.imageQuality')} className="w-full" getValueLabel={entry => String(entry)} max={1} min={0} onValueChange={next => setQuality(next[0] ?? quality)} step={0.1} value={[quality]} />
      </ExportField>
      <ExportSwitchRow checked={ignoreWebfont} label={t('export.ignoreWebFonts')} onChange={setIgnoreWebfont} />
    </>
  )
}

function PdfOptions({ actions, onExporting, registerDownload, runtime }: TypeOptionsProps) {
  const { t } = useTranslation()
  const presentation = useEditorSelector(runtime.store, selectPresentation)
  const hiddenRef = useRef<HTMLDivElement>(null)
  const rangeState = useSlideRange(presentation)
  const [count, setCount] = useState(1)
  const [padding, setPadding] = useState(true)
  useEffect(() => registerDownload(() => {
    onExporting(true)
    void actions.printPdf(hiddenRef.current!, {
      width: 1600,
      height: 1600 * presentation.viewportRatio * (rangeState.rangeType === 'all' ? count : 1),
      margin: padding ? 50 : 0,
    }).finally(() => onExporting(false))
  }), [actions, count, onExporting, padding, presentation.viewportRatio, rangeState.rangeType, registerDownload])
  return (
    <>
      <ExportCaptureLayer>
        <div ref={hiddenRef}>
          <HiddenSlideSurfaces breakEvery={rangeState.rangeType === 'all' ? count : undefined} dataAttribute="pdf" presentation={presentation} slides={rangeState.slides} />
        </div>
      </ExportCaptureLayer>
      <ExportRangeFields custom={false} state={rangeState} />
      <ExportField label={t('export.slidesPerPage')}>
        <InspectorSelect ariaLabel={t('export.slidesPerPage')} className="w-full" onChange={value => setCount(+value)} options={[1, 2, 3].map(value => ({ label: `${value}`, value }))} value={count} />
      </ExportField>
      <ExportSwitchRow checked={padding} label={t('export.pageMargin')} onChange={setPadding} />
      <ExportTip>{t('export.printTip')}</ExportTip>
    </>
  )
}

const EXPORT_TARGETS: Array<{
  icon: ComponentType<{ className?: string }>
  labelKey: string
  options: ComponentType<TypeOptionsProps>
  type: ExportType
}> = [
  { icon: MonaIcon, labelKey: 'header.exportNative', options: NativeOptions, type: 'native' },
  { icon: PowerPointIcon, labelKey: 'header.exportPptx', options: PptxOptions, type: 'pptx' },
  { icon: ImageIcon, labelKey: 'header.exportImage', options: ImageOptions, type: 'image' },
  { icon: PdfIcon, labelKey: 'header.exportPdf', options: PdfOptions, type: 'pdf' },
  { icon: JsonIcon, labelKey: 'header.exportJson', options: JsonOptions, type: 'json' },
]

function ShareComingSoon({ description, icon: Icon, title }: {
  description: string
  icon: ComponentType<{ className?: string }>
  title: string
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[var(--radius-md)] border border-border bg-muted/40 px-4 py-8 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-background text-foreground/70 shadow-sm">
        <Icon aria-hidden className="size-5" />
      </span>
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-65 text-xs leading-relaxed text-muted-foreground">{description}</p>
    </div>
  )
}

/**
 * Share dropdown: invite / public link / export / embed. Export is the live
 * path today; the other tabs are staged for the full share model. File-menu
 * entries and Ctrl+P deep-link by preselecting the export file `type`.
 */
export function EditorExportPanel({
  actions,
  onClose,
  onExportingChange,
  onTypeChange,
  runtime,
  type,
}: {
  actions: EditorExportActions
  onClose?: () => void
  onExportingChange?: (value: boolean) => void
  onTypeChange: (type: ExportType) => void
  runtime: EditorRuntime
  type: ExportType
}) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<ShareTab>('export')
  const [exporting, setExporting] = useState(false)
  const downloadRef = useRef<() => void>(() => {})
  const registerDownload = useCallback((download: () => void) => {
    downloadRef.current = download
  }, [])
  const onExporting = useCallback((value: boolean) => {
    setExporting(value)
    onExportingChange?.(value)
  }, [onExportingChange])
  const target = EXPORT_TARGETS.find(candidate => candidate.type === type) ?? EXPORT_TARGETS[1]!
  const typeOptions = EXPORT_TARGETS.map(candidate => ({
    label: t(candidate.labelKey),
    value: candidate.type,
  }))
  const renderTypeOption = (option: { label: string; value: ExportType } | undefined) => {
    if (!option) return null
    const Icon = EXPORT_TARGETS.find(candidate => candidate.type === option.value)?.icon
    return (
      <span className="flex min-w-0 items-center gap-2">
        {Icon ? <Icon aria-hidden className="size-5 shrink-0" /> : null}
        <span className="truncate">{option.label}</span>
      </span>
    )
  }
  return (
    <>
      <Tabs
        className="gap-0"
        onValueChange={value => setTab(value as ShareTab)}
        value={tab}
      >
        <div className="flex items-center justify-between gap-2 px-3 pt-3">
          <h3 className="text-base font-semibold">{t('share.title')}</h3>
          <Button aria-label={t('common.close')} className="size-7" onClick={() => onClose?.()} size="icon-sm" type="button" variant="ghost">
            <X />
          </Button>
        </div>

        <div className="px-3 pt-3 pb-3">
          <TabsList className="h-9 w-full gap-0.5" variant="default">
            {SHARE_TABS.map(entry => {
              const Icon = entry.icon
              return (
                <TabsTrigger
                  className="min-w-0 flex-auto gap-1.5 px-2 text-xs font-medium"
                  key={entry.id}
                  value={entry.id}
                >
                  <Icon aria-hidden className="size-3.5" />
                  <span className="truncate">{t(entry.labelKey)}</span>
                </TabsTrigger>
              )
            })}
          </TabsList>
        </div>

        <TabsContent className="mt-0 px-3 pb-3 outline-none" value="invite">
          <ShareComingSoon
            description={t('share.inviteDescription')}
            icon={UserPlus}
            title={t('share.inviteSoon')}
          />
        </TabsContent>

        <TabsContent className="mt-0 px-3 pb-3 outline-none" value="public">
          <ShareComingSoon
            description={t('share.publicDescription')}
            icon={Globe}
            title={t('share.publicSoon')}
          />
        </TabsContent>

        <TabsContent className="mt-0 px-3 pb-3 outline-none" value="export">
          <p className="mb-3 text-xs leading-relaxed text-muted-foreground">{t('export.tip')}</p>

          <ExportField label={t('export.fileType')}>
            <InspectorSelect
              ariaLabel={t('export.fileType')}
              className="h-10"
              onChange={onTypeChange}
              options={typeOptions}
              renderLabel={renderTypeOption}
              renderOption={renderTypeOption}
              value={target.type}
            />
          </ExportField>

          <target.options
            actions={actions}
            key={target.type}
            onExporting={onExporting}
            registerDownload={registerDownload}
            runtime={runtime}
          />

          <Button className="mt-1 w-full" onClick={() => downloadRef.current()} size="editor">
            <Download /> {t('export.download')}
          </Button>
        </TabsContent>

        <TabsContent className="mt-0 px-3 pb-3 outline-none" value="embed">
          <ShareComingSoon
            description={t('share.embedDescription')}
            icon={Code2}
            title={t('share.embedSoon')}
          />
        </TabsContent>
      </Tabs>
      <EditorFullscreenSpin loading={exporting} tip={t('common.exporting')} />
    </>
  )
}
