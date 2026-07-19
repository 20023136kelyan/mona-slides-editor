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
