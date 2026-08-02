import { parse } from '@mona/pptx-parser'
import {
  compileSlideTheme,
  DEFAULT_TEMPLATE_CATALOG,
  type PresentationState,
} from '@mona/presentation-core'

import { convertParsedPptxPresentation } from './conversion'
import { createPowerPointPackageBacking } from './package-backing'
import type {
  ParsedPptxPresentation,
  PowerPointIngestionOptions,
  PowerPointIngestionResult,
} from './types'

export * from './assets'
export * from './conversion'
export * from './package-backing'
export * from './types'

const abortError = (): Error => {
  const error = new Error('PowerPoint import was cancelled')
  error.name = 'AbortError'
  return error
}

export const getImportedAspectRatio = (width: number, height: number): number => {
  if (!width || !height) return 0.5625
  const ratio = height / width
  for (const standard of [0.625, 0.75, 0.5625]) {
    if (Math.abs(ratio - standard) < 1e-10) return standard
  }
  return ratio
}

/**
 * Complete framework-free PPTX ingestion.
 *
 * Both the package inventory and semantic parser run from the same immutable
 * source bytes. Conversion returns a Mona presentation plus every referenced
 * asset; callers decide where those bytes live and which URL scheme addresses
 * them. No React component, DOM parser, active document, or Electron global is
 * consulted here.
 */
export const ingestPowerPoint = async (
  source: ArrayBuffer,
  options: PowerPointIngestionOptions,
): Promise<PowerPointIngestionResult> => {
  if (options.signal?.aborted) throw abortError()
  const sourceCopy = source.slice(0)
  options.onProgress?.('inventory')
  const backingPromise = createPowerPointPackageBacking(sourceCopy, options.fileName)
  options.onProgress?.('parse')
  const parsedPromise = parse(sourceCopy, {
    audioMode: 'base64',
    imageMode: 'base64',
    videoMode: 'base64',
  }) as Promise<ParsedPptxPresentation>
  const [backing, parsed] = await Promise.all([backingPromise, parsedPromise])
  if (options.signal?.aborted) throw abortError()
  options.onProgress?.('convert')
  const ratio = options.fixedViewport ? 1000 / parsed.size.width : 96 / 72
  const parsedTheme = {
    ...options.theme,
    themeColors: parsed.themeColors.length
      ? parsed.themeColors
      : options.theme.themeColors,
  }
  const firstDependency = backing.reference.slides[0]
  const retainedTheme = backing.reference.hierarchy?.themes.find(candidate => (
    candidate.partPath === firstDependency?.themePart
  )) ?? backing.reference.hierarchy?.themes.find(candidate => !candidate.isOverride)
  const retainedMaster = backing.reference.hierarchy?.masters.find(candidate => (
    candidate.partPath === firstDependency?.masterPart
  ))
  const retainedLayout = backing.reference.hierarchy?.layouts.find(candidate => (
    candidate.partPath === firstDependency?.layoutPart
  ))
  const theme = compileSlideTheme(
    parsedTheme,
    retainedTheme,
    retainedMaster,
    retainedLayout,
  )
  const conversion = convertParsedPptxPresentation({
    assetUrl: options.assetUrl,
    coordinateLabel: options.coordinateLabel ?? (index => `Series ${index}`),
    parsed,
    ratio,
    sourceManifest: backing.manifest,
    sourcePackage: backing.reference,
    theme,
  })
  const sourcePackage = {
    ...(conversion.sourcePackage ?? backing.reference),
    coordinateScale: ratio,
    importReport: conversion.report,
  }
  const presentation: PresentationState = {
    slideIndex: 0,
    slides: conversion.slides,
    sourcePackages: [sourcePackage],
    templates: structuredClone([...DEFAULT_TEMPLATE_CATALOG]),
    theme,
    title: options.fileName.replace(/\.pptx$/i, ''),
    viewportRatio: getImportedAspectRatio(parsed.size.width, parsed.size.height),
    viewportSize: options.fixedViewport ? 1000 : parsed.size.width * ratio,
  }
  return {
    assets: conversion.assets,
    backing: {
      ...backing,
      manifest: {
        ...backing.manifest,
        coordinateScale: ratio,
        importReport: conversion.report,
      },
      reference: sourcePackage,
    },
    parsed,
    presentation,
    report: conversion.report,
  }
}
