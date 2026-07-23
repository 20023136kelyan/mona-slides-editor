import { useCallback, useState } from 'react'
import type { TFunction } from 'i18next'

import { validateImportedSlides, type PresentationCommand } from '@mona/presentation-core'
import type { Slide, SlideTheme } from '@mona/presentation-core/model'

import { sanitizeSlides } from '@/lib/deck-sanitizer'

import { decryptNativePresentation } from '@/features/editor/editor-file-format'
import { loadGoogleFonts } from '@/features/editor/editor-fonts'
import { getImportedAspectRatio } from '@/features/editor/editor-import-geometry'
import type { ParsedPptxPresentation } from '@/features/editor/editor-pptx-import'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import type { EditorNotificationService } from '@/features/editor/services/editor-notifications'

export type ImportFileType = 'json' | 'native' | 'pptx'

export interface ImportRequestDetail {
  files: FileList | File[]
  options?: { cover?: boolean; fixedViewport?: boolean }
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

const replaceImportedPresentation = ({
  cover,
  height,
  runtime,
  slides,
  theme,
  title,
  width,
}: SerializedPresentation & { cover: boolean; runtime: EditorRuntime }) => {
  const presentation = runtime.store.getState().presentation
  const commands: PresentationCommand[] = []
  if (cover) commands.push({ type: 'slide.focus', index: 0 })
  commands.push({ type: 'presentation.slides.replace', slides, theme: theme ?? {} })
  if (cover && title) commands.push({ type: 'presentation.title.set', fallbackTitle: title, title })
  const ratio = getImportedAspectRatio(width ?? 0, height ?? 0)
  if (ratio !== presentation.viewportRatio) commands.push({ type: 'presentation.viewport-ratio.set', ratio })
  if (width) commands.push({ type: 'presentation.viewport-size.set', size: width })
  runtime.commit('Import presentation', commands, { recordHistory: false })
  runtime.recordHistorySnapshot('import-file')
}

const applySerializedPresentation = (runtime: EditorRuntime, serialized: SerializedPresentation, cover: boolean) => {
  if (cover || isEmptyPresentation(runtime)) replaceImportedPresentation({ ...serialized, cover, runtime })
  else runtime.insertImportedSlides(serialized.slides)
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

const importPptx = async (runtime: EditorRuntime, file: File, t: TFunction, options: NonNullable<ImportRequestDetail['options']>) => {
  const [{ parse }, { convertParsedPptxSlides }] = await Promise.all([
    import('pptxtojson'),
    import('@/features/editor/editor-pptx-import'),
  ])
  const parsed = await parse(await readArrayBuffer(file), { audioMode: 'blob', imageMode: 'base64', videoMode: 'blob' }) as ParsedPptxPresentation
  if (parsed.usedFonts.length) loadGoogleFonts(parsed.usedFonts)
  const presentation = runtime.store.getState().presentation
  const width = parsed.size.width
  const height = parsed.size.height
  const ratio = options.fixedViewport ? 1000 / width : 96 / 72
  const importedTheme = { ...presentation.theme, themeColors: parsed.themeColors }
  // The converter builds HTML out of pptx XML text runs, so its output goes
  // through the same sanitizer as directly imported markup.
  const slides = sanitizeSlides(convertParsedPptxSlides({
    coordinateLabel: number => t('chartData.coordinate', { number }),
    parsed,
    ratio,
    theme: importedTheme,
  }))
  const commands: PresentationCommand[] = [{ type: 'presentation.theme.update', props: { themeColors: parsed.themeColors } }]
  if (!options.fixedViewport) commands.push({ type: 'presentation.viewport-size.set', size: width * ratio })
  runtime.commit('Import PowerPoint setup', commands, { recordHistory: false })
  if (options.cover || isEmptyPresentation(runtime)) {
    const latest = runtime.store.getState().presentation
    const replace: PresentationCommand[] = []
    if (options.cover) replace.push({ type: 'slide.focus', index: 0 })
    replace.push({ type: 'presentation.slides.replace', slides })
    const aspectRatio = getImportedAspectRatio(width, height)
    if (aspectRatio !== latest.viewportRatio) replace.push({ type: 'presentation.viewport-ratio.set', ratio: aspectRatio })
    runtime.commit('Import PowerPoint', replace, { recordHistory: false })
    runtime.recordHistorySnapshot('import-file')
  }
  else runtime.insertImportedSlides(slides)
}

export function useEditorImport(
  runtime: EditorRuntime,
  t: TFunction,
  notify: EditorNotificationService['notify'],
) {
  const [importing, setImporting] = useState(false)

  const importFiles = useCallback(async (request: ImportRequestDetail) => {
    const file = request.files[0]
    if (!file) return
    const cover = request.options?.cover ?? false
    try {
      if (request.type === 'pptx') {
        setImporting(true)
        await importPptx(runtime, file, t, {
          cover,
          fixedViewport: request.options?.fixedViewport ?? false,
        })
      }
      else await importSerialized(runtime, file, request.type, cover)
    }
    catch {
      notify({ text: t('runtime.fileParseFailed'), type: 'error' })
    }
    finally {
      if (request.type === 'pptx') setImporting(false)
    }
  }, [notify, runtime, t])

  return {
    importFiles,
    importing,
  }
}
