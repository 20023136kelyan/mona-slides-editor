import { useCallback, useEffect, useRef, useState } from 'react'
import type { TFunction } from 'i18next'

import { editorActions } from '@mona/editor-state'
import type { PowerPointIngestionStage } from '@mona/pptx-ingestion'
import { validateImportedSlides, type PresentationCommand } from '@mona/presentation-core'
import type { Slide, SlideTheme } from '@mona/presentation-core/model'

import { sanitizePowerPointPackageReference, sanitizeSlides } from '@/lib/deck-sanitizer'
import { monaBridge } from '@/lib/mona-bridge'

import { getActiveDocumentId } from '@/features/documents/active-document'
import { storeDeckAssetBytes } from '@/features/editor/editor-deck-assets'
import { decryptNativePresentation } from '@/features/editor/editor-file-format'
import { loadPresentationFonts } from '@/features/editor/editor-fonts'
import { getImportedAspectRatio } from '@/features/editor/editor-import-geometry'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import type { EditorNotificationService } from '@/features/editor/services/editor-notifications'

export type ImportFileType = 'json' | 'native' | 'pptx'

export interface ImportRequestDetail {
  files: FileList | File[]
  options?: { cover?: boolean; fixedViewport?: boolean }
  signal?: AbortSignal
  type: ImportFileType
}

interface SerializedPresentation {
  height?: number
  slides: Slide[]
  theme?: Partial<SlideTheme>
  title?: string
  width?: number
}

const readText = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.addEventListener('load', () => resolve(reader.result as string))
  reader.addEventListener('error', () => reject(reader.error ?? new Error('File read failed')))
  reader.readAsText(file)
})

const readArrayBuffer = (file: File) => new Promise<ArrayBuffer>((resolve, reject) => {
  const reader = new FileReader()
  reader.addEventListener('load', () => resolve(reader.result as ArrayBuffer))
  reader.addEventListener('error', () => reject(reader.error ?? new Error('File read failed')))
  reader.readAsArrayBuffer(file)
})

const isEmptyPresentation = (runtime: EditorRuntime) => {
  const slides = runtime.store.getState().presentation.slides
  return slides.length === 1 && slides[0]?.elements.length === 0
}

const resetDocumentInteractionState = (runtime: EditorRuntime) => {
  runtime.store.dispatch(editorActions.selectionChanged([]))
  runtime.store.dispatch(editorActions.selectedSlideIndexesChanged([]))
  runtime.store.dispatch(editorActions.hiddenElementsChanged([]))
  runtime.store.dispatch(editorActions.cropElementChanged(null))
  runtime.store.dispatch(editorActions.activeToolChanged(null))
  runtime.store.dispatch(editorActions.creatingCustomShapeChanged(false))
  runtime.store.dispatch(editorActions.drawingModeChanged(false))
}

const replaceImportedPresentation = ({
  height,
  runtime,
  slides,
  theme,
  title,
  width,
}: SerializedPresentation & { runtime: EditorRuntime }) => {
  const presentation = runtime.store.getState().presentation
  const commands: PresentationCommand[] = [
    { type: 'presentation.source-packages.replace', sourcePackages: [] },
    { type: 'slide.focus', index: 0 },
  ]
  commands.push({ type: 'presentation.slides.replace', slides, theme: theme ?? {} })
  if (title !== undefined) commands.push({ type: 'presentation.title.set', fallbackTitle: '', title })
  const ratio = getImportedAspectRatio(width ?? 0, height ?? 0)
  if (ratio !== presentation.viewportRatio) commands.push({ type: 'presentation.viewport-ratio.set', ratio })
  if (width) commands.push({ type: 'presentation.viewport-size.set', size: width })
  if (!runtime.commit('Import presentation', commands, { recordHistory: false })) {
    throw new Error('Imported presentation was rejected')
  }
  resetDocumentInteractionState(runtime)
  runtime.recordHistorySnapshot('import-file')
}

const applySerializedPresentation = (runtime: EditorRuntime, serialized: SerializedPresentation, cover: boolean) => {
  if (cover || isEmptyPresentation(runtime)) replaceImportedPresentation({ ...serialized, runtime })
  else if (runtime.insertImportedSlides(serialized.slides).length !== serialized.slides.length) {
    throw new Error('Imported slides were rejected')
  }
}


const replacePackagedAssetOwner = (value: unknown, fromId: string, toId: string): unknown => {
  if (typeof value === 'string') {
    const prefix = `mona://asset/${encodeURIComponent(fromId)}/`
    return value.startsWith(prefix)
      ? `mona://asset/${encodeURIComponent(toId)}/${value.slice(prefix.length)}`
      : value
  }
  if (Array.isArray(value)) return value.map(entry => replacePackagedAssetOwner(entry, fromId, toId))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      replacePackagedAssetOwner(entry, fromId, toId),
    ]),
  )
}

const readNativePackage = async (file: File): Promise<SerializedPresentation | null> => {
  const bytes = await readArrayBuffer(file)
  const signature = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 4))
  if (signature[0] !== 0x50 || signature[1] !== 0x4b) return null
  const { default: JSZip } = await import('jszip')
  const archive = await JSZip.loadAsync(bytes, { checkCRC32: true })
  if (Object.keys(archive.files).length > 20_000) {
    throw new Error('This Mona document contains too many package entries.')
  }
  const manifestEntry = archive.file('manifest.json')
  const deckEntry = archive.file('deck.json')
  if (!manifestEntry || !deckEntry) throw new Error('This is not a complete Mona document.')
  const manifest = JSON.parse(await manifestEntry.async('string')) as {
    documentId?: unknown
    format?: unknown
    version?: unknown
  }
  if (
    manifest.format !== 'mona.presentation'
    || manifest.version !== 1
    || typeof manifest.documentId !== 'string'
  ) {
    throw new Error('This Mona document has an invalid manifest.')
  }
  const deck = JSON.parse(await deckEntry.async('string')) as {
    presentation?: unknown
  }
  if (!deck.presentation || typeof deck.presentation !== 'object') {
    throw new Error('This Mona document has an invalid presentation model.')
  }

  const currentDocumentId = getActiveDocumentId()
  const assetEntries = Object.entries(archive.files).filter(([path, entry]) => (
    !entry.dir
    && path.startsWith('assets/')
    && !path.slice('assets/'.length).includes('/')
  ))
  await Promise.all(assetEntries.map(async ([path, entry]) => {
    const name = path.slice('assets/'.length)
    const asset = await entry.async('arraybuffer')
    await storeDeckAssetBytes(name, asset)
  }))

  const presentation = replacePackagedAssetOwner(
    deck.presentation,
    manifest.documentId,
    currentDocumentId,
  ) as Record<string, unknown>
  return {
    height: typeof presentation.viewportSize === 'number'
      && typeof presentation.viewportRatio === 'number'
      ? presentation.viewportSize * presentation.viewportRatio
      : undefined,
    slides: presentation.slides as Slide[],
    theme: presentation.theme as Partial<SlideTheme> | undefined,
    title: typeof presentation.title === 'string' ? presentation.title : undefined,
    width: typeof presentation.viewportSize === 'number' ? presentation.viewportSize : undefined,
  }
}

const importSerialized = async (runtime: EditorRuntime, file: File, type: 'json' | 'native', cover: boolean) => {
  const packaged = type === 'native' ? await readNativePackage(file) : null
  const source = packaged ? '' : await readText(file)
  const parsed: unknown = packaged ?? JSON.parse(type === 'native' ? decryptNativePresentation(source) : source)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Imported file is not a presentation envelope')
  const envelope = parsed as Partial<SerializedPresentation> & Record<string, unknown>
  const validation = validateImportedSlides(envelope.slides)
  if (!validation.valid) {
    throw new Error(`Imported slides failed validation: ${validation.issues.map(issue => issue.message).join('; ')}`)
  }
  const serialized: SerializedPresentation = {
    slides: sanitizeSlides(envelope.slides as Slide[]),
    height: typeof envelope.height === 'number' && Number.isFinite(envelope.height) ? envelope.height : undefined,
    theme: envelope.theme && typeof envelope.theme === 'object' && !Array.isArray(envelope.theme) ? envelope.theme as Partial<SlideTheme> : undefined,
    title: typeof envelope.title === 'string' ? envelope.title : undefined,
    width: typeof envelope.width === 'number' && Number.isFinite(envelope.width) ? envelope.width : undefined,
  }
  applySerializedPresentation(runtime, serialized, cover)
}

const importPptx = async (
  runtime: EditorRuntime,
  file: File,
  t: TFunction,
  options: NonNullable<ImportRequestDetail['options']>,
  signal: AbortSignal,
  onProgress: (stage: PowerPointIngestionStage) => void,
  notify: EditorNotificationService['notify'],
) => {
  const bytes = await readArrayBuffer(file)
  if (signal.aborted) throw Object.assign(new Error('PowerPoint import was cancelled'), { name: 'AbortError' })
  const presentation = runtime.store.getState().presentation
  const operationId = globalThis.crypto.randomUUID()
  const abortDesktopImport = () => {
    void monaBridge().documents.cancelPowerPoint(operationId)
  }
  signal.addEventListener('abort', abortDesktopImport, { once: true })
  onProgress('inventory')
  const ingestion = await monaBridge().documents.ingestPowerPoint(
    getActiveDocumentId(),
    bytes,
    {
      coordinateLabels: Array.from(
        { length: 128 },
        (_, index) => t('chartData.coordinate', { number: index + 1 }),
      ),
      fileName: file.name,
      fixedViewport: options.fixedViewport,
      operationId,
      theme: presentation.theme,
    },
  ).finally(() => signal.removeEventListener('abort', abortDesktopImport))
  if (signal.aborted) {
    throw Object.assign(new Error('PowerPoint import was cancelled'), { name: 'AbortError' })
  }
  onProgress('parse')
  // Font resolution runs alongside conversion rather than gating it: slides
  // paint immediately and reflow as faces arrive. Only families with no
  // deterministic stand-in are worth telling the user about.
  void loadPresentationFonts({
    embeddedFonts: ingestion.embeddedFonts,
    usedFonts: ingestion.usedFonts,
  }).then(report => {
    if (!report.missing.length) return
    notify({
      text: t('runtime.fontsUnavailable', { fonts: report.missing.join(', ') }),
      type: 'warning',
    })
  }, () => { /* Font resolution never fails an import. */ })
  const slides = sanitizeSlides(ingestion.presentation.slides)
  const sourceReference = {
    ...sanitizePowerPointPackageReference(ingestion.sourcePackage),
    importReport: ingestion.report,
  }
  const replacing = options.cover || isEmptyPresentation(runtime)
  const sourcePackages = replacing
    ? [sourceReference]
    : [
        ...(presentation.sourcePackages ?? []).filter(source => source.packageId !== sourceReference.packageId),
        sourceReference,
      ]
  const previousPackageIds = (presentation.sourcePackages ?? []).map(source => source.packageId)
  if (!await runtime.pptxBackingStore.restore(sourceReference)) {
    throw new Error('The desktop host ingested the PowerPoint but did not retain its source package.')
  }
  const commands: PresentationCommand[] = [
    { type: 'presentation.source-packages.replace', sourcePackages },
    {
      type: 'presentation.theme.update',
      // The desktop host compiles the retained DrawingML theme into Mona's
      // editable theme. Keeping only its accent colors made the active deck
      // disagree with the writeback baseline (notably dk1/lt1 and fonts), so a
      // title-only export was misclassified as a native theme edit.
      props: ingestion.presentation.theme,
    },
  ]
  if (!options.fixedViewport) {
    commands.push({
      type: 'presentation.viewport-size.set',
      size: ingestion.presentation.viewportSize,
    })
  }
  try {
    if (replacing) {
      const latest = runtime.store.getState().presentation
      const replace: PresentationCommand[] = [...commands, { type: 'slide.focus', index: 0 }]
      replace.push({ type: 'presentation.slides.replace', slides })
      const aspectRatio = ingestion.presentation.viewportRatio
      if (aspectRatio !== latest.viewportRatio) replace.push({ type: 'presentation.viewport-ratio.set', ratio: aspectRatio })
      if (!runtime.commit('Import PowerPoint', replace, { recordHistory: false })) {
        throw new Error('Imported PowerPoint was rejected')
      }
      resetDocumentInteractionState(runtime)
      runtime.recordHistorySnapshot('import-file')
    }
    else if (runtime.insertImportedSlides(slides, commands).length !== slides.length) {
      throw new Error('Imported PowerPoint was rejected')
    }
    await runtime.pptxBackingStore.retain(sourcePackages.map(source => source.packageId))
  }
  catch (error) {
    await runtime.pptxBackingStore.retain(previousPackageIds).catch(() => {})
    throw error
  }
}

export function useEditorImport(
  runtime: EditorRuntime,
  t: TFunction,
  notify: EditorNotificationService['notify'],
) {
  const [importing, setImporting] = useState(false)
  const [importStage, setImportStage] = useState<PowerPointIngestionStage | null>(null)
  const importInFlightRef = useRef(false)
  const activeImportControllerRef = useRef<AbortController | null>(null)

  useEffect(() => () => {
    activeImportControllerRef.current?.abort()
  }, [])

  const importFiles = useCallback(async (request: ImportRequestDetail) => {
    if (importInFlightRef.current) return
    const file = request.files[0]
    if (!file) return
    const controller = new AbortController()
    activeImportControllerRef.current = controller
    const abortFromRequest = () => controller.abort()
    request.signal?.addEventListener('abort', abortFromRequest, { once: true })
    if (request.signal?.aborted) controller.abort()
    importInFlightRef.current = true
    setImporting(true)
    const cover = request.options?.cover ?? false
    try {
      if (request.type === 'pptx') {
        await importPptx(runtime, file, t, {
          cover,
          fixedViewport: request.options?.fixedViewport ?? false,
        }, controller.signal, setImportStage, notify)
      }
      else {
        if (controller.signal.aborted) throw Object.assign(new Error('Import was cancelled'), { name: 'AbortError' })
        await importSerialized(runtime, file, request.type, cover)
      }
    }
    catch (error) {
      if (!(error instanceof Error) || error.name !== 'AbortError') {
        notify({ text: t('runtime.fileParseFailed'), type: 'error' })
      }
    }
    finally {
      request.signal?.removeEventListener('abort', abortFromRequest)
      if (activeImportControllerRef.current === controller) activeImportControllerRef.current = null
      importInFlightRef.current = false
      setImporting(false)
      setImportStage(null)
    }
  }, [notify, runtime, t])

  return {
    cancelImport: () => activeImportControllerRef.current?.abort(),
    importFiles,
    importStage,
    importing,
  }
}
