import { useCallback, useEffect, useRef, useState } from 'react'
import type { TFunction } from 'i18next'

import { editorActions } from '@mona/editor-state'
import { validateImportedSlides, type PresentationCommand } from '@mona/presentation-core'
import type { Slide, SlideTheme } from '@mona/presentation-core/model'

import { sanitizePowerPointPackageReference, sanitizeSlides } from '@/lib/deck-sanitizer'

import { decryptNativePresentation } from '@/features/editor/editor-file-format'
import { loadPresentationFonts } from '@/features/editor/editor-fonts'
import { getImportedAspectRatio } from '@/features/editor/editor-import-geometry'
import type { PowerPointImportStage } from '@/features/editor/editor-pptx-worker-client'
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


const importSerialized = async (runtime: EditorRuntime, file: File, type: 'json' | 'native', cover: boolean) => {
  const source = await readText(file)
  const parsed: unknown = JSON.parse(type === 'native' ? decryptNativePresentation(source) : source)
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
  onProgress: (stage: PowerPointImportStage) => void,
  notify: EditorNotificationService['notify'],
) => {
  const [{ convertParsedPptxPresentation, persistImportedAssets }, { parsePowerPointPackage }] = await Promise.all([
    import('@/features/editor/editor-pptx-import'),
    import('@/features/editor/editor-pptx-worker-client'),
  ])
  const bytes = await readArrayBuffer(file)
  if (signal.aborted) throw Object.assign(new Error('PowerPoint import was cancelled'), { name: 'AbortError' })
  const { backing, parsed } = await parsePowerPointPackage(bytes, file.name, { onProgress, signal })
  // Font resolution runs alongside conversion rather than gating it: slides
  // paint immediately and reflow as faces arrive. Only families with no
  // deterministic stand-in are worth telling the user about.
  void loadPresentationFonts({
    embeddedFonts: parsed.embeddedFonts,
    usedFonts: parsed.usedFonts,
  }).then(report => {
    if (!report.missing.length) return
    notify({
      text: t('runtime.fontsUnavailable', { fonts: report.missing.join(', ') }),
      type: 'warning',
    })
  }, () => { /* Font resolution never fails an import. */ })
  const presentation = runtime.store.getState().presentation
  const width = parsed.size.width
  const height = parsed.size.height
  const ratio = options.fixedViewport ? 1000 / width : 96 / 72
  const importedTheme = { ...presentation.theme, themeColors: parsed.themeColors }
  // The converter builds HTML out of pptx XML text runs, so its output goes
  // through the same sanitizer as directly imported markup.
  const conversion = convertParsedPptxPresentation({
    coordinateLabel: number => t('chartData.coordinate', { number }),
    parsed,
    ratio,
    sourceManifest: backing.manifest,
    sourcePackage: backing.reference,
    theme: importedTheme,
  })
  // Before anything can reference them: the conversion mints an object URL per
  // asset, and until the bytes are in the media store that URL is the only handle
  // on them. A deck saved in that window keeps references it can never resolve
  // again - which is exactly how images come back broken after a reload.
  const unstored = await persistImportedAssets()
  if (unstored.length) {
    notify({
      text: t('runtime.importAssetsUnstored', { count: unstored.length }),
      type: 'warning',
    })
  }
  const slides = sanitizeSlides(conversion.slides)
  const sourceReference = {
    ...sanitizePowerPointPackageReference(conversion.sourcePackage ?? backing.reference),
    importReport: conversion.report,
  }
  const retainedBacking = {
    ...backing,
    manifest: {
      ...backing.manifest,
      importReport: conversion.report,
    },
    reference: sourceReference,
  }
  const replacing = options.cover || isEmptyPresentation(runtime)
  const sourcePackages = replacing
    ? [sourceReference]
    : [
        ...(presentation.sourcePackages ?? []).filter(source => source.packageId !== sourceReference.packageId),
        sourceReference,
      ]
  const previousPackageIds = (presentation.sourcePackages ?? []).map(source => source.packageId)
  await runtime.pptxBackingStore.persist(retainedBacking)
  const commands: PresentationCommand[] = [
    { type: 'presentation.source-packages.replace', sourcePackages },
    { type: 'presentation.theme.update', props: { themeColors: parsed.themeColors } },
  ]
  if (!options.fixedViewport) commands.push({ type: 'presentation.viewport-size.set', size: width * ratio })
  try {
    if (replacing) {
      const latest = runtime.store.getState().presentation
      const replace: PresentationCommand[] = [...commands, { type: 'slide.focus', index: 0 }]
      replace.push({ type: 'presentation.slides.replace', slides })
      const aspectRatio = getImportedAspectRatio(width, height)
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
  const [importStage, setImportStage] = useState<PowerPointImportStage | null>(null)
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
