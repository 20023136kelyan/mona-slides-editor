import { useEffect, useRef, useState } from 'react'

import type { Slide, SlideTheme } from '@mona/presentation-core/model'

import { SlideRenderer } from '@/features/presentation-renderer/SlideRenderer'

interface ScaledSlideProps {
  fixedWidth?: number
  slide: Slide
  theme: SlideTheme
  thumbnail?: boolean
  viewportRatio: number
  viewportSize: number
}

export function ScaledSlide({
  fixedWidth,
  slide,
  theme,
  thumbnail = false,
  viewportRatio,
  viewportSize,
}: ScaledSlideProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [responsiveScale, setResponsiveScale] = useState(0)
  const fixedScale = fixedWidth ? fixedWidth / viewportSize : null

  useEffect(() => {
    if (fixedScale) return undefined
    const container = containerRef.current
    if (!container) return undefined
    const updateScale = () => {
      const rect = container.getBoundingClientRect()
      setResponsiveScale(Math.min(rect.width / viewportSize, rect.height / (viewportSize * viewportRatio)))
    }
    updateScale()
    const observer = new ResizeObserver(updateScale)
    observer.observe(container)
    return () => observer.disconnect()
  }, [fixedScale, viewportRatio, viewportSize])

  const scale = fixedScale || responsiveScale
  const frameStyle = fixedWidth
    ? { width: fixedWidth, height: fixedWidth * viewportRatio }
    : undefined

  return (
    <div className={`mona-scaled-slide${fixedWidth ? ' is-fixed' : ''}`} ref={containerRef} style={frameStyle}>
      {scale > 0 ? (
        <div className="mona-scaled-slide-canvas" style={{ transform: `scale(${scale})` }}>
          <SlideRenderer
            slide={slide}
            theme={theme}
            thumbnail={thumbnail}
            viewportRatio={viewportRatio}
            viewportSize={viewportSize}
          />
        </div>
      ) : null}
    </div>
  )
}
