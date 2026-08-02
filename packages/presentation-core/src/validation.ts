import type {
  PPTElement,
  PPTElementEffects,
  PPTElementThreeD,
  PPTElementThreeDRotation,
  Slide,
  StructuredTextBody,
} from './model'
import type { PresentationState } from './state'
import { collectElementTreeIds } from './elements'

export type ValidationSeverity = 'error' | 'warning'

export interface PresentationValidationIssue {
  code: string
  message: string
  path: string
  severity: ValidationSeverity
}

export interface PresentationValidationResult {
  valid: boolean
  issues: PresentationValidationIssue[]
}

const finiteGeometryIssues = (
  element: PPTElement,
  path: string,
): PresentationValidationIssue[] => {
  const issues: PresentationValidationIssue[] = []
  const values: Array<[string, number]> = [
    ['left', element.left],
    ['top', element.top],
    ['width', element.width],
  ]
  if (element.type !== 'line') values.push(['height', element.height])

  for (const [key, value] of values) {
    if (!Number.isFinite(value)) {
      issues.push({
        code: 'element.geometry.non-finite',
        message: `${key} must be a finite number`,
        path: `${path}.${key}`,
        severity: 'error',
      })
    }
  }
  return issues
}

const structuredTextIssues = (
  body: StructuredTextBody | null | undefined,
  path: string,
): PresentationValidationIssue[] => {
  if (body == null) return []
  const issues: PresentationValidationIssue[] = []
  if (body.schemaVersion !== 1 || !Number.isFinite(body.scale) || body.scale <= 0) {
    issues.push({
      code: 'element.structured-text.invalid',
      message: 'Structured text must use schema version 1 and a positive finite scale',
      path,
      severity: 'error',
    })
  }
  if (!Array.isArray(body.paragraphs) || !Array.isArray(body.listStyle)) {
    issues.push({
      code: 'element.structured-text.collections',
      message: 'Structured text paragraphs and list styles must be arrays',
      path,
      severity: 'error',
    })
    return issues
  }
  const sourceIds = new Set<string>()
  body.paragraphs.forEach((paragraph, paragraphIndex) => {
    const paragraphPath = `${path}.paragraphs[${paragraphIndex}]`
    if (
      !paragraph.sourceId
      || !Number.isInteger(paragraph.level)
      || paragraph.level < 0
      || paragraph.level > 8
      || !Array.isArray(paragraph.runs)
    ) {
      issues.push({
        code: 'element.structured-text.paragraph',
        message: 'Structured paragraphs require a source ID, level 0–8, and run array',
        path: paragraphPath,
        severity: 'error',
      })
    }
    if (sourceIds.has(paragraph.sourceId)) {
      issues.push({
        code: 'element.structured-text.source-id',
        message: `Duplicate structured text source ID: ${paragraph.sourceId}`,
        path: `${paragraphPath}.sourceId`,
        severity: 'error',
      })
    }
    sourceIds.add(paragraph.sourceId)
    paragraph.runs.forEach((run, runIndex) => {
      const runPath = `${paragraphPath}.runs[${runIndex}]`
      if (
        !run.sourceId
        || !['break', 'field', 'tab', 'text'].includes(run.kind)
        || (run.text !== undefined && typeof run.text !== 'string')
      ) {
        issues.push({
          code: 'element.structured-text.run',
          message: 'Structured runs require a source ID, supported kind, and optional string text',
          path: runPath,
          severity: 'error',
        })
      }
      if (sourceIds.has(run.sourceId)) {
        issues.push({
          code: 'element.structured-text.source-id',
          message: `Duplicate structured text source ID: ${run.sourceId}`,
          path: `${runPath}.sourceId`,
          severity: 'error',
        })
      }
      sourceIds.add(run.sourceId)
    })
  })
  return issues
}

const elementEffectsIssues = (
  effects: PPTElementEffects | undefined,
  path: string,
): PresentationValidationIssue[] => {
  if (!effects) return []
  const issues: PresentationValidationIssue[] = []
  const finite = (value: unknown, field: string, minimum = -100_000, maximum = 100_000) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
      issues.push({
        code: 'element.effects.invalid-number',
        message: `${field} must be a finite number between ${minimum} and ${maximum}`,
        path: `${path}.${field}`,
        severity: 'error',
      })
    }
  }
  const color = (value: unknown, field: string) => {
    if (typeof value !== 'string' || !value.trim()) {
      issues.push({
        code: 'element.effects.invalid-color',
        message: `${field} must be a non-empty color string`,
        path: `${path}.${field}`,
        severity: 'error',
      })
    }
  }
  if (effects.glow) {
    color(effects.glow.color, 'glow.color')
    finite(effects.glow.opacity, 'glow.opacity', 0, 1)
    finite(effects.glow.radius, 'glow.radius', 0)
  }
  if (effects.innerShadow) {
    color(effects.innerShadow.color, 'innerShadow.color')
    finite(effects.innerShadow.opacity, 'innerShadow.opacity', 0, 1)
    finite(effects.innerShadow.blur, 'innerShadow.blur', 0)
    finite(effects.innerShadow.h, 'innerShadow.h')
    finite(effects.innerShadow.v, 'innerShadow.v')
  }
  if (effects.reflection) {
    finite(effects.reflection.blur, 'reflection.blur', 0)
    finite(effects.reflection.direction, 'reflection.direction', -360_000, 360_000)
    finite(effects.reflection.distance, 'reflection.distance', 0)
    finite(effects.reflection.opacity, 'reflection.opacity', 0, 1)
    finite(effects.reflection.scaleY, 'reflection.scaleY', -10, 10)
  }
  if (effects.softEdge) finite(effects.softEdge.radius, 'softEdge.radius', 0)
  return issues
}

const elementThreeDIssues = (
  threeD: PPTElementThreeD | undefined,
  path: string,
): PresentationValidationIssue[] => {
  if (!threeD) return []
  const issues: PresentationValidationIssue[] = []
  const finite = (value: unknown, field: string, minimum = -100_000, maximum = 100_000) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
      issues.push({
        code: 'element.three-d.invalid-number',
        message: `${field} must be a finite number between ${minimum} and ${maximum}`,
        path: `${path}.${field}`,
        severity: 'error',
      })
    }
  }
  const text = (value: unknown, field: string) => {
    if (typeof value !== 'string' || !value.trim()) {
      issues.push({
        code: 'element.three-d.invalid-string',
        message: `${field} must be a non-empty string`,
        path: `${path}.${field}`,
        severity: 'error',
      })
    }
  }
  const rotation = (value: PPTElementThreeDRotation | undefined, field: string) => {
    if (!value) return
    finite(value.latitude, `${field}.latitude`, -360_000, 360_000)
    finite(value.longitude, `${field}.longitude`, -360_000, 360_000)
    finite(value.revolution, `${field}.revolution`, -360_000, 360_000)
  }
  if (threeD.camera) {
    text(threeD.camera.preset, 'camera.preset')
    if (threeD.camera.zoom !== undefined) finite(threeD.camera.zoom, 'camera.zoom', 0.01, 100)
    rotation(threeD.camera.rotation, 'camera.rotation')
  }
  if (threeD.light) {
    text(threeD.light.direction, 'light.direction')
    text(threeD.light.rig, 'light.rig')
    rotation(threeD.light.rotation, 'light.rotation')
  }
  if (threeD.shape) {
    for (const [name, bevel] of [
      ['bevelBottom', threeD.shape.bevelBottom],
      ['bevelTop', threeD.shape.bevelTop],
    ] as const) {
      if (!bevel) continue
      finite(bevel.height, `shape.${name}.height`, 0)
      text(bevel.preset, `shape.${name}.preset`)
      finite(bevel.width, `shape.${name}.width`, 0)
    }
    if (threeD.shape.contourColor !== undefined) text(threeD.shape.contourColor, 'shape.contourColor')
    if (threeD.shape.contourWidth !== undefined) finite(threeD.shape.contourWidth, 'shape.contourWidth', 0)
    if (threeD.shape.extrusionColor !== undefined) text(threeD.shape.extrusionColor, 'shape.extrusionColor')
    if (threeD.shape.extrusionHeight !== undefined) finite(threeD.shape.extrusionHeight, 'shape.extrusionHeight', 0)
    if (threeD.shape.material !== undefined) text(threeD.shape.material, 'shape.material')
    if (threeD.shape.z !== undefined) finite(threeD.shape.z, 'shape.z')
  }
  return issues
}

const validateSlide = (
  slide: Slide,
  slideIndex: number,
  slideIds: ReadonlySet<string>,
  seenElementIds: Set<string>,
): PresentationValidationIssue[] => {
  const issues: PresentationValidationIssue[] = []
  const slidePath = `slides[${slideIndex}]`
  const localElementIds = new Set(collectElementTreeIds(slide.elements))

  if (slide.title !== undefined && typeof slide.title !== 'string') {
    issues.push({
      code: 'slide.title.invalid',
      message: 'Slide title must be a string',
      path: `${slidePath}.title`,
      severity: 'error',
    })
  }
  if (slide.hidden !== undefined && typeof slide.hidden !== 'boolean') {
    issues.push({
      code: 'slide.hidden.invalid',
      message: 'Slide hidden state must be a boolean',
      path: `${slidePath}.hidden`,
      severity: 'error',
    })
  }
  if (
    slide.durationMs !== undefined
    && (
      typeof slide.durationMs !== 'number'
      || !Number.isFinite(slide.durationMs)
      || slide.durationMs < 1000
      || slide.durationMs > 3_600_000
    )
  ) {
    issues.push({
      code: 'slide.duration.invalid',
      message: 'Slide duration must be between 1000 and 3600000 milliseconds',
      path: `${slidePath}.durationMs`,
      severity: 'error',
    })
  }

  const validateElement = (element: PPTElement, elementPath: string) => {
    if (!element.id) {
      issues.push({
        code: 'element.id.empty',
        message: 'Element ID must not be empty',
        path: `${elementPath}.id`,
        severity: 'error',
      })
    }
    else if (seenElementIds.has(element.id)) {
      issues.push({
        code: 'element.id.duplicate',
        message: `Duplicate element ID: ${element.id}`,
        path: `${elementPath}.id`,
        severity: 'error',
      })
    }
    seenElementIds.add(element.id)
    issues.push(...finiteGeometryIssues(element, elementPath))
    issues.push(...elementEffectsIssues(element.effects, `${elementPath}.effects`))
    issues.push(...elementThreeDIssues(element.threeD, `${elementPath}.threeD`))
    if (element.type === 'text') {
      issues.push(...structuredTextIssues(element.structuredText, `${elementPath}.structuredText`))
    }
    else if (element.type === 'shape') {
      issues.push(...structuredTextIssues(element.text?.structuredText, `${elementPath}.text.structuredText`))
    }

    if (element.link?.type === 'slide' && !slideIds.has(element.link.target)) {
      issues.push({
        code: 'element.link.missing-slide',
        message: `Slide link target does not exist: ${element.link.target}`,
        path: `${elementPath}.link.target`,
        severity: 'warning',
      })
    }
    if (element.type === 'group') {
      element.elements.forEach((child, childIndex) => {
        validateElement(child, `${elementPath}.elements[${childIndex}]`)
      })
    }
  }
  slide.elements.forEach((element, elementIndex) => {
    validateElement(element, `${slidePath}.elements[${elementIndex}]`)
  })

  slide.animations?.forEach((animation, animationIndex) => {
    const animationPath = `${slidePath}.animations[${animationIndex}]`
    if (
      !animation.id
      || !animation.effect
      || !['attention', 'in', 'out'].includes(animation.type)
      || !['auto', 'click', 'meantime'].includes(animation.trigger)
      || !Number.isFinite(animation.duration)
      || animation.duration <= 0
      || animation.duration > 3_600_000
    ) {
      issues.push({
        code: 'animation.invalid',
        message: 'Animation requires IDs, an effect, a supported type/trigger, and a positive finite duration',
        path: animationPath,
        severity: 'error',
      })
    }
    if (!localElementIds.has(animation.elId)) {
      issues.push({
        code: 'animation.missing-element',
        message: `Animation target does not exist on its slide: ${animation.elId}`,
        path: `${animationPath}.elId`,
        severity: 'warning',
      })
    }
  })

  return issues
}

const IMPORTABLE_ELEMENT_TYPES = new Set([
  'text', 'image', 'shape', 'line', 'chart', 'table', 'latex', 'video', 'audio', 'group', 'opaque',
])

const validateHierarchyElements = (
  value: unknown,
  path: string,
  seenElementIds: Set<string>,
): PresentationValidationIssue[] => {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    return [importIssue('presentation.source-hierarchy.elements', 'Hierarchy elements must be an array', path)]
  }
  const issues: PresentationValidationIssue[] = []
  value.forEach((element, elementIndex) => {
    const elementPath = `${path}[${elementIndex}]`
    if (!element || typeof element !== 'object' || Array.isArray(element)) {
      issues.push(importIssue('presentation.source-hierarchy.element', 'Hierarchy element must be an object', elementPath))
      return
    }
    const candidate = element as Partial<PPTElement> & Record<string, unknown>
    if (typeof candidate.id !== 'string' || !candidate.id) {
      issues.push(importIssue('presentation.source-hierarchy.element-id', 'Hierarchy element ID must be a non-empty string', `${elementPath}.id`))
    }
    else if (seenElementIds.has(candidate.id)) {
      issues.push(importIssue('presentation.source-hierarchy.element-duplicate', `Duplicate element ID: ${candidate.id}`, `${elementPath}.id`))
    }
    else seenElementIds.add(candidate.id)
    if (typeof candidate.type !== 'string' || !IMPORTABLE_ELEMENT_TYPES.has(candidate.type)) {
      issues.push(importIssue('presentation.source-hierarchy.element-type', `Unknown hierarchy element type: ${String(candidate.type)}`, `${elementPath}.type`))
      return
    }
    issues.push(...finiteGeometryIssues(candidate as PPTElement, elementPath))
    issues.push(...elementEffectsIssues(
      (candidate as PPTElement).effects,
      `${elementPath}.effects`,
    ))
    issues.push(...elementThreeDIssues(
      (candidate as PPTElement).threeD,
      `${elementPath}.threeD`,
    ))
    if (candidate.type === 'text') {
      issues.push(...structuredTextIssues(
        (candidate as Extract<PPTElement, { type: 'text' }>).structuredText,
        `${elementPath}.structuredText`,
      ))
    }
    else if (candidate.type === 'shape') {
      issues.push(...structuredTextIssues(
        (candidate as Extract<PPTElement, { type: 'shape' }>).text?.structuredText,
        `${elementPath}.text.structuredText`,
      ))
    }
    if (candidate.type === 'group') {
      issues.push(...validateHierarchyElements(candidate.elements, `${elementPath}.elements`, seenElementIds))
    }
  })
  return issues
}

const importIssue = (code: string, message: string, path: string): PresentationValidationIssue =>
  ({ code, message, path, severity: 'error' })

// Structural gate for slides parsed from untrusted native/JSON sources
// files, foreign clipboard payloads, persisted working copies). It type-checks
// what the reducers and renderers assume, before anything enters the store;
// validatePresentationState still covers cross-slide invariants afterwards.
export const validateImportedSlides = (value: unknown): PresentationValidationResult => {
  const issues: PresentationValidationIssue[] = []
  const validateElements = (elements: unknown[], path: string) => {
    elements.forEach((element, elementIndex) => {
      const elementPath = `${path}[${elementIndex}]`
      if (!element || typeof element !== 'object' || Array.isArray(element)) {
        issues.push(importIssue('import.element.invalid', 'Element must be an object', elementPath))
        return
      }
      const record = element as Partial<PPTElement> & Record<string, unknown>
      if (typeof record.id !== 'string' || !record.id) {
        issues.push(importIssue('import.element.id', 'Element ID must be a non-empty string', `${elementPath}.id`))
      }
      if (typeof record.type !== 'string' || !IMPORTABLE_ELEMENT_TYPES.has(record.type)) {
        issues.push(importIssue('import.element.type', `Unknown element type: ${String(record.type)}`, `${elementPath}.type`))
        return
      }
      const geometry: Array<[string, unknown]> = [['left', record.left], ['top', record.top], ['width', record.width]]
      if (record.type !== 'line') geometry.push(['height', record.height])
      for (const [key, geometryValue] of geometry) {
        if (typeof geometryValue !== 'number' || !Number.isFinite(geometryValue)) {
          issues.push(importIssue('import.element.geometry', `${key} must be a finite number`, `${elementPath}.${key}`))
        }
      }
      if (record.type === 'text') {
        issues.push(...structuredTextIssues(
          (record as Extract<PPTElement, { type: 'text' }>).structuredText,
          `${elementPath}.structuredText`,
        ))
      }
      else if (record.type === 'shape') {
        issues.push(...structuredTextIssues(
          (record as Extract<PPTElement, { type: 'shape' }>).text?.structuredText,
          `${elementPath}.text.structuredText`,
        ))
      }
      if (record.type === 'group') {
        if (!Array.isArray(record.elements)) {
          issues.push(importIssue('import.group.elements', 'Group elements must be an array', `${elementPath}.elements`))
        }
        else validateElements(record.elements, `${elementPath}.elements`)
      }
      if (record.type === 'opaque' && (typeof record.opaqueType !== 'string' || !record.opaqueType)) {
        issues.push(importIssue('import.opaque.type', 'Opaque element type must be a non-empty string', `${elementPath}.opaqueType`))
      }
    })
  }
  if (!Array.isArray(value) || value.length === 0) {
    issues.push(importIssue('import.slides.invalid', 'Slides must be a non-empty array', 'slides'))
    return { valid: false, issues }
  }

  value.forEach((slide, slideIndex) => {
    const slidePath = `slides[${slideIndex}]`
    if (!slide || typeof slide !== 'object' || Array.isArray(slide)) {
      issues.push(importIssue('import.slide.invalid', 'Slide must be an object', slidePath))
      return
    }
    const candidate = slide as Partial<Slide> & Record<string, unknown>
    if (typeof candidate.id !== 'string' || !candidate.id) {
      issues.push(importIssue('import.slide.id', 'Slide ID must be a non-empty string', `${slidePath}.id`))
    }
    if (!Array.isArray(candidate.elements)) {
      issues.push(importIssue('import.slide.elements', 'Slide elements must be an array', `${slidePath}.elements`))
      return
    }
    if (candidate.title !== undefined && typeof candidate.title !== 'string') {
      issues.push(importIssue('import.slide.title', 'Slide title must be a string', `${slidePath}.title`))
    }
    if (candidate.hidden !== undefined && typeof candidate.hidden !== 'boolean') {
      issues.push(importIssue('import.slide.hidden', 'Slide hidden state must be a boolean', `${slidePath}.hidden`))
    }
    if (
      candidate.durationMs !== undefined
      && (
        typeof candidate.durationMs !== 'number'
        || !Number.isFinite(candidate.durationMs)
        || candidate.durationMs < 1000
        || candidate.durationMs > 3_600_000
      )
    ) {
      issues.push(importIssue('import.slide.duration', 'Slide duration must be between 1000 and 3600000 milliseconds', `${slidePath}.durationMs`))
    }
    validateElements(candidate.elements, `${slidePath}.elements`)
  })

  return { valid: !issues.some(issue => issue.severity === 'error'), issues }
}

export const validatePresentationState = (
  state: PresentationState,
): PresentationValidationResult => {
  const issues: PresentationValidationIssue[] = []
  const seenSlideIds = new Set<string>()
  const seenElementIds = new Set<string>()

  if (state.slides.length === 0) {
    issues.push({
      code: 'presentation.slides.empty',
      message: 'A presentation must contain at least one slide',
      path: 'slides',
      severity: 'error',
    })
  }

  state.slides.forEach((slide, slideIndex) => {
    if (!slide.id) {
      issues.push({
        code: 'slide.id.empty',
        message: 'Slide ID must not be empty',
        path: `slides[${slideIndex}].id`,
        severity: 'error',
      })
    }
    else if (seenSlideIds.has(slide.id)) {
      issues.push({
        code: 'slide.id.duplicate',
        message: `Duplicate slide ID: ${slide.id}`,
        path: `slides[${slideIndex}].id`,
        severity: 'error',
      })
    }
    seenSlideIds.add(slide.id)
  })

  if (state.slides.length > 0 && (state.slideIndex < 0 || state.slideIndex >= state.slides.length)) {
    issues.push({
      code: 'presentation.slide-index.out-of-range',
      message: `Slide index ${state.slideIndex} is outside the presentation`,
      path: 'slideIndex',
      severity: 'error',
    })
  }

  const sourcePackages: unknown = state.sourcePackages
  if (sourcePackages !== undefined && !Array.isArray(sourcePackages)) {
    issues.push({
      code: 'presentation.source-packages.invalid',
      message: 'Source packages must be an array',
      path: 'sourcePackages',
      severity: 'error',
    })
  }
  else if (Array.isArray(sourcePackages)) {
    const seenPackageIds = new Set<string>()
    sourcePackages.forEach((value, packageIndex) => {
      const path = `sourcePackages[${packageIndex}]`
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        issues.push({
          code: 'presentation.source-package.invalid',
          message: 'Source package must be an object',
          path,
          severity: 'error',
        })
        return
      }
      const source = value as Record<string, unknown>
      if (source.kind !== 'pptx' || typeof source.packageId !== 'string' || !source.packageId) {
        issues.push({
          code: 'presentation.source-package.identity',
          message: 'Source package must have a PowerPoint package identity',
          path: `${path}.packageId`,
          severity: 'error',
        })
      }
      else if (seenPackageIds.has(source.packageId)) {
        issues.push({
          code: 'presentation.source-package.duplicate',
          message: `Duplicate source package: ${source.packageId}`,
          path: `${path}.packageId`,
          severity: 'error',
        })
      }
      else seenPackageIds.add(source.packageId)
      if (
        typeof source.byteLength !== 'number'
        || !Number.isSafeInteger(source.byteLength)
        || source.byteLength <= 0
      ) {
        issues.push({
          code: 'presentation.source-package.byte-length',
          message: 'Source package byte length must be a positive safe integer',
          path: `${path}.byteLength`,
          severity: 'error',
        })
      }
      if (typeof source.fileName !== 'string' || !source.fileName) {
        issues.push({
          code: 'presentation.source-package.file-name',
          message: 'Source package file name must be a non-empty string',
          path: `${path}.fileName`,
          severity: 'error',
        })
      }
      if (!Array.isArray(source.slides) || source.slides.some(slide => (
        !slide || typeof slide !== 'object' || typeof (slide as { slidePart?: unknown }).slidePart !== 'string'
      ))) {
        issues.push({
          code: 'presentation.source-package.slides',
          message: 'Source package slides must contain valid source-part records',
          path: `${path}.slides`,
          severity: 'error',
        })
      }
      const sharedAuthoring = source.sharedAuthoring
      if (sharedAuthoring !== undefined) {
        const record = sharedAuthoring && typeof sharedAuthoring === 'object' && !Array.isArray(sharedAuthoring)
          ? sharedAuthoring as Record<string, unknown>
          : undefined
        const partPaths = record?.partPaths
        const validPartPaths = Array.isArray(partPaths)
          && partPaths.every(part => typeof part === 'string' && part.length > 0)
          && new Set(partPaths).size === partPaths.length
        if (
          !record
          || !validPartPaths
          || !Number.isSafeInteger(record.revision)
          || Number(record.revision) <= 0
        ) {
          issues.push({
            code: 'presentation.source-package.shared-authoring',
            message: 'Shared authoring must contain unique part paths and a positive revision',
            path: `${path}.sharedAuthoring`,
            severity: 'error',
          })
        }
      }
      const hierarchy = source.hierarchy
      if (hierarchy !== undefined) {
        if (!hierarchy || typeof hierarchy !== 'object' || Array.isArray(hierarchy)) {
          issues.push({
            code: 'presentation.source-hierarchy.invalid',
            message: 'PowerPoint hierarchy must be an object',
            path: `${path}.hierarchy`,
            severity: 'error',
          })
        }
        else {
          const hierarchyRecord = hierarchy as Record<string, unknown>
          for (const layerName of ['masters', 'layouts'] as const) {
            const layers = hierarchyRecord[layerName]
            if (!Array.isArray(layers)) {
              issues.push({
                code: 'presentation.source-hierarchy.layers',
                message: `PowerPoint hierarchy ${layerName} must be an array`,
                path: `${path}.hierarchy.${layerName}`,
                severity: 'error',
              })
              continue
            }
            layers.forEach((layer, layerIndex) => {
              if (!layer || typeof layer !== 'object' || Array.isArray(layer)) {
                issues.push({
                  code: 'presentation.source-hierarchy.layer',
                  message: 'PowerPoint hierarchy layer must be an object',
                  path: `${path}.hierarchy.${layerName}[${layerIndex}]`,
                  severity: 'error',
                })
                return
              }
              issues.push(...validateHierarchyElements(
                (layer as Record<string, unknown>).elements,
                `${path}.hierarchy.${layerName}[${layerIndex}].elements`,
                seenElementIds,
              ))
            })
          }
          const placeholders = hierarchyRecord.placeholders
          if (!Array.isArray(placeholders) || placeholders.some(placeholder => {
            if (!placeholder || typeof placeholder !== 'object' || Array.isArray(placeholder)) return true
            const record = placeholder as Record<string, unknown>
            return !['layout', 'master', 'slide'].includes(String(record.layer))
              || typeof record.objectId !== 'string'
              || !record.objectId
              || typeof record.partPath !== 'string'
              || !record.partPath
          })) {
            issues.push({
              code: 'presentation.source-hierarchy.placeholders',
              message: 'PowerPoint hierarchy placeholders must contain valid layered object references',
              path: `${path}.hierarchy.placeholders`,
              severity: 'error',
            })
          }
          const themes = hierarchyRecord.themes
          if (!Array.isArray(themes) || themes.some(theme => {
            if (!theme || typeof theme !== 'object' || Array.isArray(theme)) return true
            const record = theme as Record<string, unknown>
            return typeof record.id !== 'string'
              || !record.id
              || !Array.isArray(record.colors)
              || record.colors.some(color => {
                if (!color || typeof color !== 'object' || Array.isArray(color)) return true
                const colorRecord = color as Record<string, unknown>
                return typeof colorRecord.name !== 'string'
                  || typeof colorRecord.value !== 'string'
              })
          })) {
            issues.push({
              code: 'presentation.source-hierarchy.themes',
              message: 'PowerPoint hierarchy themes must contain typed colors and stable identities',
              path: `${path}.hierarchy.themes`,
              severity: 'error',
            })
          }
        }
      }
    })
  }

  const slideIds = new Set(state.slides.map(slide => slide.id))
  state.slides.forEach((slide, slideIndex) => {
    issues.push(...validateSlide(slide, slideIndex, slideIds, seenElementIds))
  })

  return {
    valid: !issues.some(issue => issue.severity === 'error'),
    issues,
  }
}
