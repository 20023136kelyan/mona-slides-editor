import { useEffect, useState } from 'react'
import type { TFunction } from 'i18next'

import type { PresentationCommand } from '@mona/presentation-core'
import type { Slide, SlideTheme } from '@mona/presentation-core/model'

import { decryptNativePresentation } from '@/features/editor/editor-file-format'
import { getImportedAspectRatio } from '@/features/editor/editor-import-geometry'
import type { ParsedPptxPresentation } from '@/features/editor/editor-pptx-import'
import type { EditorRuntime } from '@/features/editor/editor-runtime'

export type ImportFileType = 'json' | 'pptist' | 'pptx'

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

const notify = (text: string) => window.dispatchEvent(new CustomEvent('mona:notice', { detail: { text, type: 'error' } }))

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

const loadImportedFonts = (fonts: string[]) => {
  for (const font of new Set(fonts.map(value => value.replace(/^['"]|['"]$/g, '').trim()).filter(Boolean))) {
    const key = `mona-import-font-${font.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
    if (document.getElementById(key)) continue
    const link = document.createElement('link')
    link.id = key
    link.rel = 'stylesheet'
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font).replace(/%20/g, '+')}`
    document.head.appendChild(link)
  }
}

const importSerialized = async (runtime: EditorRuntime, file: File, type: 'json' | 'pptist', cover: boolean) => {
  const source = await readText(file)
  const serialized = JSON.parse(type === 'pptist' ? decryptNativePresentation(source) : source) as SerializedPresentation
  applySerializedPresentation(runtime, serialized, cover)
}

const importPptx = async (runtime: EditorRuntime, file: File, t: TFunction, options: NonNullable<ImportRequestDetail['options']>) => {
  const [{ parse }, { convertParsedPptxSlides }] = await Promise.all([
    import('pptxtojson'),
    import('@/features/editor/editor-pptx-import'),
  ])
  const parsed = await parse(await readArrayBuffer(file), { audioMode: 'blob', imageMode: 'base64', videoMode: 'blob' }) as ParsedPptxPresentation
  if (parsed.usedFonts.length) loadImportedFonts(parsed.usedFonts)
  const presentation = runtime.store.getState().presentation
  const width = parsed.size.width
  const height = parsed.size.height
  const ratio = options.fixedViewport ? 1000 / width : 96 / 72
  const importedTheme = { ...presentation.theme, themeColors: parsed.themeColors }
  const slides = convertParsedPptxSlides({
    coordinateLabel: number => t('chartData.coordinate', { number }),
    parsed,
    ratio,
    theme: importedTheme,
  })
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

export function useEditorImport(runtime: EditorRuntime, t: TFunction) {
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    const handle = (event: Event) => {
      const detail = (event as CustomEvent<ImportRequestDetail>).detail
      const file = detail?.files?.[0]
      if (!file) return
      const cover = detail.options?.cover ?? false
      if (detail.type === 'pptx') {
        setImporting(true)
        void importPptx(runtime, file, t, { cover, fixedViewport: detail.options?.fixedViewport ?? false })
          .catch(() => notify(t('runtime.fileParseFailed')))
          .finally(() => setImporting(false))
      }
      else {
        void importSerialized(runtime, file, detail.type, cover).catch(() => notify(t('runtime.fileParseFailed')))
      }
    }
    window.addEventListener('mona:import-request', handle)
    return () => window.removeEventListener('mona:import-request', handle)
  }, [runtime, t])

  return importing
}
