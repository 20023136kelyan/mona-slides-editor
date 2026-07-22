import { useEffect, useState } from 'react'

export function useMobileSlidesLoad(slideCount: number) {
  const [limit, setLimit] = useState(() => slideCount <= 50 ? 9999 : 50)

  useEffect(() => {
    if (slideCount <= limit) return undefined
    const timer = window.setTimeout(() => setLimit(current => current + 20), 600)
    return () => window.clearTimeout(timer)
  }, [limit, slideCount])

  return slideCount <= limit ? 9999 : limit
}
