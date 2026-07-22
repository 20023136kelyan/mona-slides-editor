import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { Slide, SlideTheme } from '@mona/presentation-core/model'

import { ElementRenderer } from '@/features/presentation-renderer/ElementRenderer'
import { getSlideBackgroundStyle } from '@/features/presentation-renderer/render-utils'
import { SlideRenderer } from '@/features/presentation-renderer/SlideRenderer'

interface ScaledSlideProps {
  fixedWidth?: number
  slide: Slide
  theme: SlideTheme
  thumbnail?: boolean
  viewportRatio: number
  viewportSize: number
  visible?: boolean
}

export function ScaledSlide({
  fixedWidth,
  slide,
  theme,
  thumbnail = false,
  viewportRatio,
  viewportSize,
  visible = true,
}: ScaledSlideProps) {
  const { t } = useTranslation()
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
      {!visible ? <div className="mona-scaled-slide-placeholder">{t('runtime.thumbnailLoading')}</div> : scale > 0 ? (
        <div
          className={`mona-scaled-slide-canvas${thumbnail ? ' is-thumbnail' : ''}`}
          style={{
            transform: `scale(${scale})`,
            ...(thumbnail ? { width: viewportSize, height: viewportSize * viewportRatio } : {}),
          }}
        >
          {thumbnail ? (
            <>
              <div className="mona-scaled-slide-background" style={getSlideBackgroundStyle(slide.background)} />
              {slide.elements.map((element, index) => (
                <div className="mona-rendered-element" key={element.id} style={{ zIndex: index + 1 }}>
                  <ElementRenderer element={element} theme={theme} thumbnail />
                </div>
              ))}
            </>
          ) : (
            <SlideRenderer
              slide={slide}
              theme={theme}
              viewportRatio={viewportRatio}
              viewportSize={viewportSize}
            />
          )}
        </div>
      ) : null}
    </div>
  )
}
