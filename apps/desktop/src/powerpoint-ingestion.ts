import {
  ingestPowerPoint,
  type PowerPointIngestionResult,
} from '@mona/pptx-ingestion'
import type {
  PowerPointImportReport,
  PowerPointPackageReference,
  PresentationState,
  SlideTheme,
} from '@mona/presentation-core'

import { writePowerPointPackageRecord } from './document-data.js'
import {
  isDocumentId,
  readDocument,
} from './document-library.js'

export const DEFAULT_POWERPOINT_THEME: SlideTheme = {
  backgroundColor: '#ffffff',
  fontColor: '#333333',
  fontName: '',
  outline: { color: '#525252', style: 'solid', width: 2 },
  shadow: { blur: 2, color: '#808080', h: 3, v: 3 },
  themeColors: ['#5b9bd5', '#ed7d31', '#a5a5a5', '#ffc000', '#4472c4', '#70ad47'],
}

export interface DesktopPowerPointIngestion {
  embeddedFonts: NonNullable<PowerPointIngestionResult['parsed']['embeddedFonts']>
  presentation: PresentationState
  report: PowerPointImportReport
  sourcePackage: PowerPointPackageReference
  usedFonts: string[]
}

const isTheme = (value: unknown): value is SlideTheme => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const theme = value as Partial<SlideTheme>
  return typeof theme.backgroundColor === 'string'
    && typeof theme.fontColor === 'string'
    && typeof theme.fontName === 'string'
    && Array.isArray(theme.themeColors)
    && theme.themeColors.every(color => typeof color === 'string')
    && !!theme.outline
    && typeof theme.outline === 'object'
    && !!theme.shadow
    && typeof theme.shadow === 'object'
}

const sourceBytes = (value: unknown): ArrayBuffer => {
  if (value instanceof ArrayBuffer) return value.slice(0)
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(
      value.byteOffset,
      value.byteOffset + value.byteLength,
    ) as ArrayBuffer
  }
  throw new Error('PowerPoint ingestion requires file bytes.')
}

export const ingestPowerPointForDocument = async ({
  bytes,
  documentId,
  fileName,
  fixedViewport = false,
  coordinateLabels,
  signal,
  theme,
  writeAsset,
}: {
  bytes: unknown
  documentId: string
  fileName: string
  fixedViewport?: boolean
  coordinateLabels?: string[]
  signal?: AbortSignal
  theme?: unknown
  writeAsset: (documentId: string, name: string, bytes: ArrayBuffer) => Promise<string>
}): Promise<DesktopPowerPointIngestion> => {
  if (!isDocumentId(documentId) || !await readDocument(documentId)) {
    throw new Error('This presentation no longer exists.')
  }
  if (
    typeof fileName !== 'string'
    || !fileName.trim()
    || !fileName.toLocaleLowerCase().endsWith('.pptx')
  ) {
    throw new Error('PowerPoint ingestion requires a .pptx file name.')
  }
  const result = await ingestPowerPoint(sourceBytes(bytes), {
    assetUrl: ({ name }) => (
      `mona://asset/${encodeURIComponent(documentId)}/${encodeURIComponent(name)}`
    ),
    coordinateLabel: index => coordinateLabels?.[index - 1] ?? `Series ${index}`,
    fileName: fileName.trim(),
    fixedViewport,
    signal,
    theme: isTheme(theme) ? structuredClone(theme) : DEFAULT_POWERPOINT_THEME,
  })
  // Assets land before either the presentation or its retained source package
  // becomes reachable. A failed write therefore cannot create a deck that names
  // bytes which never existed.
  for (const asset of result.assets) {
    if (signal?.aborted) {
      const error = new Error('PowerPoint import was cancelled')
      error.name = 'AbortError'
      throw error
    }
    await writeAsset(documentId, asset.name, asset.bytes.slice().buffer as ArrayBuffer)
  }
  if (signal?.aborted) {
    const error = new Error('PowerPoint import was cancelled')
    error.name = 'AbortError'
    throw error
  }
  await writePowerPointPackageRecord(
    documentId,
    result.backing.reference.packageId,
    {
      baselinePresentation: structuredClone(result.presentation),
      bytes: result.backing.bytes.slice(),
      manifest: structuredClone(result.backing.manifest),
      reference: structuredClone(result.backing.reference),
      version: 1,
    },
  )
  return {
    embeddedFonts: result.parsed.embeddedFonts ?? [],
    presentation: structuredClone(result.presentation),
    report: structuredClone(result.report),
    sourcePackage: structuredClone(result.backing.reference),
    usedFonts: [...result.parsed.usedFonts],
  }
}
