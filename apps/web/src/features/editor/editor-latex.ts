import { CONFIG as hfmathConfig, hfmath } from 'hfmath'

import { createPresentationId, type PresentationState } from '@mona/presentation-core'
import type { PPTLatexElement } from '@mona/presentation-core/model'

hfmathConfig.SUB_SUP_SCALE = 0.5

export interface LatexRenderResult {
  h: number
  latex: string
  path: string
  w: number
}

export function renderLatex(latex: string): LatexRenderResult {
  const equation = new hfmath(latex)
  const box = equation.box({})
  return {
    latex,
    path: equation.pathd({}),
    w: box.w + 32,
    h: box.h + 32,
  }
}

export function renderLatexSymbol(latex: string): string {
  return new hfmath(latex).svg({ SCALE_X: 10, SCALE_Y: 10 })
}

export function createLatexElement(presentation: PresentationState, result: LatexRenderResult): PPTLatexElement {
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
