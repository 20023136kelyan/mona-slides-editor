import { createPresentationId, type PresentationState } from '@mona/presentation-core'
import type { PPTLatexElement } from '@mona/presentation-core/model'

import type { LatexRenderResult } from '@/features/editor/editor-latex'

// Element placement is deliberately independent from hfmath. The equation
// renderer remains behind EditorLatexEditor's lazy boundary, while reopening
// the desktop editor only needs this lightweight document-model operation.
export function createLatexElement(
  presentation: PresentationState,
  result: LatexRenderResult,
): PPTLatexElement {
  return {
    type: 'latex',
    id: createPresentationId(10),
    width: result.w,
    height: result.h,
    rotate: 0,
    left: (presentation.viewportSize - result.w) / 2,
    top: (presentation.viewportSize * presentation.viewportRatio - result.h) / 2,
    path: result.path,
    latex: result.latex,
    color: presentation.theme.fontColor,
    strokeWidth: 2,
    viewBox: [result.w, result.h],
    fixedRatio: true,
  }
}
