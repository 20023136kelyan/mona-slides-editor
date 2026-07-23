import type { PPTElement, Slide } from './model'
import type { PresentationState } from './state'

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

const validateSlide = (
  slide: Slide,
  slideIndex: number,
  slideIds: ReadonlySet<string>,
  seenElementIds: Set<string>,
): PresentationValidationIssue[] => {
  const issues: PresentationValidationIssue[] = []
  const slidePath = `slides[${slideIndex}]`
  const localElementIds = new Set(slide.elements.map(element => element.id))

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

  slide.elements.forEach((element, elementIndex) => {
    const elementPath = `${slidePath}.elements[${elementIndex}]`
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

    if (element.link?.type === 'slide' && !slideIds.has(element.link.target)) {
      issues.push({
        code: 'element.link.missing-slide',
        message: `Slide link target does not exist: ${element.link.target}`,
        path: `${elementPath}.link.target`,
        severity: 'warning',
      })
    }
  })

  slide.animations?.forEach((animation, animationIndex) => {
    if (!localElementIds.has(animation.elId)) {
      issues.push({
        code: 'animation.missing-element',
        message: `Animation target does not exist on its slide: ${animation.elId}`,
        path: `${slidePath}.animations[${animationIndex}].elId`,
        severity: 'warning',
      })
    }
  })

  return issues
}

const IMPORTABLE_ELEMENT_TYPES = new Set([
  'text', 'image', 'shape', 'line', 'chart', 'table', 'latex', 'video', 'audio',
])

const importIssue = (code: string, message: string, path: string): PresentationValidationIssue =>
  ({ code, message, path, severity: 'error' })

// Structural gate for slides parsed from untrusted native/JSON sources
// files, foreign clipboard payloads, persisted working copies). It type-checks
// what the reducers and renderers assume, before anything enters the store;
// validatePresentationState still covers cross-slide invariants afterwards.
export const validateImportedSlides = (value: unknown): PresentationValidationResult => {
  const issues: PresentationValidationIssue[] = []
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
    candidate.elements.forEach((element, elementIndex) => {
      const elementPath = `${slidePath}.elements[${elementIndex}]`
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
    })
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

  const slideIds = new Set(state.slides.map(slide => slide.id))
  state.slides.forEach((slide, slideIndex) => {
    issues.push(...validateSlide(slide, slideIndex, slideIds, seenElementIds))
  })

  return {
    valid: !issues.some(issue => issue.severity === 'error'),
    issues,
  }
}
