import { CONFIG as hfmathConfig, hfmath } from 'hfmath'

hfmathConfig.SUB_SUP_SCALE = 0.5

export const renderPowerPointLatex = (latex: string): {
  h: number
  latex: string
  path: string
  w: number
} => {
  const equation = new hfmath(latex)
  const box = equation.box({})
  return {
    h: box.h + 32,
    latex,
    path: equation.pathd({}),
    w: box.w + 32,
  }
}
