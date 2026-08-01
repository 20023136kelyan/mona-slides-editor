import {
  convertParsedPptxPresentation,
  convertParsedPptxSlides,
  createPowerPointAssetCollector,
  getImportedAspectRatio,
  type ParsedPptxPresentation,
} from '@mona/pptx-ingestion'

import {
  deckAssetUrl,
  storeDeckAssetBytes,
} from '@/features/editor/editor-deck-assets'

export {
  convertParsedPptxPresentation,
  convertParsedPptxSlides,
  getImportedAspectRatio,
}
export type { ParsedPptxPresentation }

/**
 * Compatibility collector for the focused browser tests.
 *
 * Production import uses the conversion result's explicit `assets` array and
 * never shares mutable staging state. These two functions remain only for older
 * call sites that resolve one data URL before explicitly flushing it.
 */
let compatibilityCollector = createPowerPointAssetCollector(({ name }) => deckAssetUrl(name))

export const importedAssetUrl = (source: string): string => compatibilityCollector.resolve(source)

export const persistImportedAssets = async (): Promise<string[]> => {
  const assets = compatibilityCollector.take()
  compatibilityCollector = createPowerPointAssetCollector(({ name }) => deckAssetUrl(name))
  const failed: string[] = []
  for (const asset of assets) {
    try {
      await storeDeckAssetBytes(
        asset.name,
        asset.bytes.buffer.slice(
          asset.bytes.byteOffset,
          asset.bytes.byteOffset + asset.bytes.byteLength,
        ) as ArrayBuffer,
      )
    }
    catch {
      failed.push(asset.name)
    }
  }
  return failed
}
