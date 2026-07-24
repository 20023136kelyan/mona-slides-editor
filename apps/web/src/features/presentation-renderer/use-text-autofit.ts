import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { PRESENTATION_FONTS_CHANGED } from '@/features/editor/editor-fonts'

/**
 * PowerPoint shrinks overflowing `normAutofit` text by discrete steps rather
 * than by a continuous ratio, and it recomputes the step whenever the text or
 * the shape changes. A deck stores the step its authoring session settled on,
 * but the attribute is optional — `<a:normAutofit/>` with no `fontScale` means
 * "compute it now" — and a stored step assumes the exact authored font, so it
 * under-shrinks whenever a substitute face is a little wider.
 *
 * Walking the same ladder keeps the result deterministic: the same body in the
 * same box picks the same step on the canvas, in a thumbnail, and in an export
 * preview, because the measurement happens in the element's own coordinate
 * space rather than in whatever zoom the surface applies.
 */
const FONT_SCALE_STEPS = [1, 0.925, 0.85, 0.775, 0.7, 0.65, 0.6, 0.55, 0.5, 0.45, 0.4, 0.35, 0.3, 0.25] as const

// Sub-pixel slack: a line box that exceeds the box by a rounding error is not
// an overflow, and treating it as one costs a whole visible step.
const OVERFLOW_EPSILON = 0.5

export interface TextAutofit {
  /** Attach to the node whose text is scaled. */
  attachContent: (node: HTMLDivElement | null) => void
  /** Attach to the box the text has to fit inside. */
  attachFrame: (node: HTMLDivElement | null) => void
  scale: number
}

/**
 * Shrinks text to its box, returning the CSS `zoom` factor to apply to the
 * content node. `zoom` reflows rather than transforms, so a shrunk paragraph
 * re-wraps the way PowerPoint's does — and it scales the bullet indents, tab
 * stops, and line spacing with the glyphs, while leaving the body insets on
 * the frame untouched.
 *
 * `enabled` should be true only for bodies whose autofit mode is `normal`.
 * `signature` re-runs the fit when the text, the box, or the styling changes.
 */
export function useTextAutofit(enabled: boolean, signature: string): TextAutofit {
  const frameNode = useRef<HTMLDivElement | null>(null)
  const contentNode = useRef<HTMLDivElement | null>(null)
  const [scale, setScale] = useState(1)

  const measure = useCallback(() => {
    const frame = frameNode.current
    const content = contentNode.current
    if (!enabled || !frame || !content) {
      setScale(1)
      return
    }
    // A hidden surface has no layout to measure; keep the last result rather
    // than collapsing the text to the smallest step.
    if (!frame.offsetHeight || !frame.offsetWidth) return

    const frameStyle = getComputedStyle(frame)
    const available = frame.clientHeight
      - Number.parseFloat(frameStyle.paddingTop)
      - Number.parseFloat(frameStyle.paddingBottom)
    if (!(available > 0)) return

    // Surfaces scale the whole slide with a transform, so measured rectangles
    // arrive pre-multiplied. Dividing by the frame's own factor puts the
    // content height back into the element's coordinate space and makes the
    // chosen step identical on every surface.
    const surfaceScale = frame.getBoundingClientRect().height / frame.offsetHeight
    const previous = content.style.zoom
    let fitted = FONT_SCALE_STEPS[FONT_SCALE_STEPS.length - 1]!
    for (const step of FONT_SCALE_STEPS) {
      content.style.zoom = String(step)
      const needed = content.getBoundingClientRect().height / (surfaceScale || 1)
      if (needed <= available + OVERFLOW_EPSILON) {
        fitted = step
        break
      }
    }
    content.style.zoom = previous
    setScale(fitted)
  }, [enabled])

  useLayoutEffect(() => {
    measure()
  }, [measure, signature])

  useEffect(() => {
    if (!enabled) return undefined
    // Imported decks name faces that are fetched or substituted after the
    // first paint. Until they land the text is measured against fallback
    // metrics, which shrinks it further than it needs to go, so the fit is
    // recomputed whenever the available faces change.
    let cancelled = false
    void document.fonts.ready.then(() => {
      if (!cancelled) measure()
    })
    const remeasure = () => measure()
    document.fonts.addEventListener('loadingdone', remeasure)
    document.addEventListener(PRESENTATION_FONTS_CHANGED, remeasure)
    return () => {
      cancelled = true
      document.fonts.removeEventListener('loadingdone', remeasure)
      document.removeEventListener(PRESENTATION_FONTS_CHANGED, remeasure)
    }
  }, [enabled, measure])

  const attachContent = useCallback((node: HTMLDivElement | null) => {
    contentNode.current = node
  }, [])
  const attachFrame = useCallback((node: HTMLDivElement | null) => {
    frameNode.current = node
  }, [])

  return { attachContent, attachFrame, scale }
}

export const autofitEnabled = (
  autoFit: { type: 'none' | 'normal' | 'shape' } | undefined,
): boolean => autoFit?.type === 'normal'
