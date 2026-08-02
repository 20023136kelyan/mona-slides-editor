import { mml2omml } from 'mathml2omml'
import Temml from 'temml'

/**
 * Convert Mona's editable LaTeX source into Office Math Markup Language.
 *
 * Temml keeps this path deterministic and headless by producing Presentation
 * MathML without a browser DOM. mathml2omml then maps that semantic tree to
 * the native equation vocabulary stored by PowerPoint.
 */
export const latexToOmml = (latex: string): string => {
  const source = latex.trim()
  if (!source) throw new Error('A native PowerPoint equation cannot be empty.')
  const mathml = Temml.renderToString(source, {
    displayMode: false,
    throwOnError: true,
    xml: true,
  })
  const omml = mml2omml(mathml)
  if (!/<m:oMath(?:\s|>)/.test(omml)) {
    throw new Error('The equation converter did not produce a native Office Math payload.')
  }
  return omml
}
