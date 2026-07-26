import { useEffect, useRef, useState } from 'react'

/** Slowest reveal, so short bursts still feel like typing rather than a stamp. */
const MIN_CHARS_PER_SECOND = 60
/** How aggressively a backlog is worked off: bigger backlog reveals faster. */
const CATCH_UP_DIVISOR = 6

/**
 * Reveals text character by character, independently of how it arrives.
 *
 * Providers deliver tokens in uneven bursts - a clause, a pause, a paragraph -
 * so painting each chunk on arrival reads as stamping. This keeps a cursor into
 * the text received so far and advances it on a steady clock, catching up in
 * proportion to how far behind it is, so it never drifts noticeably late.
 *
 * Purely presentational: nothing here changes what was received, and when the
 * stream ends the full text is shown immediately.
 */
export const useSmoothText = (target: string, active: boolean): string => {
  const [revealed, setRevealed] = useState(active ? '' : target)
  const frameRef = useRef<number | null>(null)
  const lengthRef = useRef(active ? 0 : target.length)
  const lastTickRef = useRef(0)

  useEffect(() => {
    // Settled text is shown whole: a finished message should never animate.
    if (!active) {
      lengthRef.current = target.length
      setRevealed(target)
      return undefined
    }

    // A shorter target means a new message; restart rather than run backwards.
    if (target.length < lengthRef.current) lengthRef.current = 0

    const step = (now: number) => {
      const previous = lastTickRef.current || now
      lastTickRef.current = now
      const backlog = target.length - lengthRef.current
      if (backlog <= 0) {
        frameRef.current = requestAnimationFrame(step)
        return
      }
      const rate = Math.max(MIN_CHARS_PER_SECOND, backlog * CATCH_UP_DIVISOR)
      const advance = Math.max(1, Math.round((rate * (now - previous)) / 1000))
      lengthRef.current = Math.min(target.length, lengthRef.current + advance)
      setRevealed(target.slice(0, lengthRef.current))
      frameRef.current = requestAnimationFrame(step)
    }

    frameRef.current = requestAnimationFrame(step)
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      lastTickRef.current = 0
    }
  }, [active, target])

  return revealed
}
