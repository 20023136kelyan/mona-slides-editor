import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  compileSlideTheme,
  resolveSlideRenderState,
  type PowerPointPackageReference,
} from '@mona/presentation-core'
import type { Slide, SlideTheme } from '@mona/presentation-core/model'

import { ElementRenderer } from '@/features/presentation-renderer/ElementRenderer'
import { getSlideBackgroundStyle } from '@/features/presentation-renderer/render-utils'
import { SlideRenderer } from '@/features/presentation-renderer/SlideRenderer'

interface ScaledSlideProps {
  fixedWidth?: number
  slide: Slide
  sourcePackages?: readonly PowerPointPackageReference[]
  theme: SlideTheme
  thumbnail?: boolean
  viewportRatio: number
  viewportSize: number
  visible?: boolean
}

export function ScaledSlide({
  fixedWidth,
  slide,
  sourcePackages = [],
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
  const renderState = useMemo(
    () => resolveSlideRenderState(slide, sourcePackages),
    [slide, sourcePackages],
  )
  const effectiveTheme = useMemo(
    () => compileSlideTheme(theme, renderState.theme, renderState.master, renderState.layout, slide),
    [renderState.layout, renderState.master, renderState.theme, slide, theme],
  )
  const frameStyle = fixedWidth
    ? { width: fixedWidth, height: fixedWidth * viewportRatio }
    : {
      width: `min(100%, ${viewportSize}px)`,
      height: `min(100%, ${viewportSize * viewportRatio}px)`,
      aspectRatio: String(1 / viewportRatio),
    }

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
              <div className="mona-scaled-slide-background" style={getSlideBackgroundStyle(renderState.background)} />
              {renderState.nodes.map(node => (
                <div className="mona-rendered-element" data-pptx-layer={node.layer} key={node.element.id} style={{ zIndex: node.zIndex }}>
                  <ElementRenderer element={node.element} theme={effectiveTheme} thumbnail />
                </div>
              ))}
            </>
          ) : (
            <SlideRenderer
              slide={slide}
              sourcePackages={sourcePackages}
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
