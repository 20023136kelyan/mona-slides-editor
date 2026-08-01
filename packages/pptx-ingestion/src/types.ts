import type {
  PowerPointImportReport,
  PowerPointPackageManifest,
  PowerPointPackageReference,
  PresentationState,
  Slide,
  SlideTheme,
} from '@mona/presentation-core'
import type {
  EmbeddedFont,
  Slide as ParsedSlide,
} from '@mona/pptx-parser'

export type { EmbeddedFont } from '@mona/pptx-parser'

export interface ParsedPptxPresentation {
  /** Absent only in hand-built fixtures; the parser always reports it. */
  embeddedFonts?: EmbeddedFont[]
  size: { height: number; width: number }
  slides: ParsedSlide[]
  themeColors: string[]
  usedFonts: string[]
}

export interface PowerPointPackageBacking {
  readonly bytes: Uint8Array
  readonly manifest: PowerPointPackageManifest
  readonly reference: PowerPointPackageReference
}

export interface PowerPointIngestedAsset {
  bytes: Uint8Array
  mediaType: string
  name: string
  url: string
}

export interface PowerPointConversionResult {
  assets: PowerPointIngestedAsset[]
  report: PowerPointImportReport
  slides: Slide[]
  sourcePackage?: PowerPointPackageReference
}

export type PowerPointIngestionStage = 'inventory' | 'parse' | 'convert'

export interface PowerPointIngestionOptions {
  /**
   * Maps content-addressed assets to a runtime reference.
   *
   * Electron's editor uses `mona://asset/<document>/<name>`. A headless desktop
   * consumer can retain the neutral default and materialize the bytes wherever
   * its workspace lives.
   */
  assetUrl?: (asset: { mediaType: string; name: string }) => string
  coordinateLabel?: (index: number) => string
  fileName: string
  fixedViewport?: boolean
  onProgress?: (stage: PowerPointIngestionStage) => void
  signal?: AbortSignal
  theme: SlideTheme
}

export interface PowerPointIngestionResult {
  assets: PowerPointIngestedAsset[]
  backing: PowerPointPackageBacking
  parsed: ParsedPptxPresentation
  presentation: PresentationState
  report: PowerPointImportReport
}
