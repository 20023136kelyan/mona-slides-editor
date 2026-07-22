import { useEffect, useState, type RefObject } from 'react'

export const useScreenSlideSize = (
  viewportRatio: number,
  wrapRef?: RefObject<HTMLElement | null>,
) => {
  const [size, setSize] = useState({ height: 0, width: 0 })

  useEffect(() => {
    const update = () => {
      const wrap = wrapRef?.current || document.body
      const availableWidth = wrap.clientWidth
      const availableHeight = wrap.clientHeight
      if (!availableWidth || !availableHeight) return
      if (availableHeight / availableWidth === viewportRatio) {
        setSize({ height: availableHeight, width: availableWidth })
      }
      else if (availableHeight / availableWidth > viewportRatio) {
        setSize({ height: availableWidth * viewportRatio, width: availableWidth })
      }
      else {
        setSize({ height: availableHeight, width: availableHeight / viewportRatio })
      }
    }
    update()
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('resize', update)
    }
  }, [viewportRatio, wrapRef])

  return size
}
