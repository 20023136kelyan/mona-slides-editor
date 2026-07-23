import { CONFIG as hfmathConfig, hfmath } from 'hfmath'

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
