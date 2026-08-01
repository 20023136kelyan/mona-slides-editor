import { createRoot } from 'react-dom/client'

import type { PresentationState } from '@mona/presentation-core'

import { SlideRenderer } from '@/features/presentation-renderer/SlideRenderer'

const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))

const canvasBlob = (
  canvas: HTMLCanvasElement,
  mediaType: 'image/png' | 'image/webp',
  quality?: number,
): Promise<Blob> => new Promise((resolve, reject) => {
  canvas.toBlob(blob => {
    if (blob) resolve(blob)
    else reject(new Error('Unable to encode slide preview.'))
  }, mediaType, quality)
})

/**
 * Renders one slide with the production renderer and captures it as an image.
 *
 * This is shared by agent before/after previews and the library cover cache so
 * neither surface invents a second, visually different presentation renderer.
 */
export const renderSlidePreview = async (
  presentation: PresentationState,
  slideId: string,
  options: {
    format?: 'png' | 'webp'
    maxWidth?: number
    quality?: number
  } = {},
): Promise<Blob | undefined> => {
  const slide = presentation.slides.find(candidate => candidate.id === slideId)
  if (!slide) return undefined
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  Object.assign(host.style, {
    contain: 'strict',
    height: `${presentation.viewportSize * presentation.viewportRatio}px`,
    left: '-20000px',
    overflow: 'hidden',
    pointerEvents: 'none',
    position: 'fixed',
    top: '0',
    width: `${presentation.viewportSize}px`,
    zIndex: '-1',
  })
  document.body.append(host)
  const root = createRoot(host)
  try {
    root.render(
      <SlideRenderer
        slide={slide}
        sourcePackages={presentation.sourcePackages}
        theme={presentation.theme}
        thumbnail
        viewportRatio={presentation.viewportRatio}
        viewportSize={presentation.viewportSize}
      />,
    )
    await nextFrame()
    await document.fonts?.ready
    await Promise.all(
      [...host.querySelectorAll('img')].map(image => image.decode().catch(() => undefined)),
    )
    const { toCanvas } = await import('html-to-image')
    const maxWidth = options.maxWidth ?? 1200
    const pixelRatio = Math.min(1.5, maxWidth / presentation.viewportSize)
    let lastError: unknown
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const canvas = await toCanvas(host.firstElementChild as HTMLElement, {
          cacheBust: false,
          fontEmbedCSS: '',
          height: presentation.viewportSize * presentation.viewportRatio,
          pixelRatio,
          width: presentation.viewportSize,
        })
        return canvasBlob(
          canvas,
          options.format === 'webp' ? 'image/webp' : 'image/png',
          options.quality,
        )
      }
      catch (error) {
        lastError = error
        await nextFrame()
      }
    }
    console.warn('Slide preview failed after three attempts.', lastError)
    return undefined
  }
  catch (error) {
    console.warn('Slide preview setup failed.', error)
    return undefined
  }
  finally {
    root.unmount()
    host.remove()
  }
}
