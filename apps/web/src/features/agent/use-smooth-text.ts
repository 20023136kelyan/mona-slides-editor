import { useEffect, useRef, useState } from 'react'

/** Slowest reveal, so short bursts still feel like a stream rather than a stamp. */
const MIN_CHARS_PER_SECOND = 60
/** How aggressively a backlog is worked off: bigger backlog reveals faster. */
const CATCH_UP_DIVISOR = 6

/**
 * Reveals text character by character, independently of how provider chunks arrive.
 *
 * This is shared by every Mona conversation surface. Keeping the pacing at the
 * message-renderer boundary means switching transports or providers cannot make
 * one chat feel smoother than another.
 */
export const useSmoothText = (target: string, active: boolean): string => {
  const [revealed, setRevealed] = useState(active ? '' : target)
  const frameRef = useRef<number | null>(null)
  const lengthRef = useRef(active ? 0 : target.length)
  const lastTickRef = useRef(0)

  useEffect(() => {
    if (!active) {
      lengthRef.current = target.length
      setRevealed(target)
      return undefined
    }

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
