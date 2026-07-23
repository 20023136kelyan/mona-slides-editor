import { createRoot } from 'react-dom/client'
import type { PresentationState } from '@mona/presentation-core'

import { SlideRenderer } from '@/features/presentation-renderer/SlideRenderer'

const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))

const dataUrlToBlob = async (dataUrl: string): Promise<Blob> => {
  const response = await fetch(dataUrl)
  return response.blob()
}

export const renderAgentSlidePreview = async (
  presentation: PresentationState,
  slideId: string,
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
        viewportRatio={presentation.viewportRatio}
        viewportSize={presentation.viewportSize}
      />,
    )
    await nextFrame()
    await document.fonts?.ready
    const images = [...host.querySelectorAll('img')]
    await Promise.all(images.map(image => image.decode().catch(() => undefined)))
    const { toPng } = await import('html-to-image')
    let lastError: unknown
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const dataUrl = await toPng(host.firstElementChild as HTMLElement, {
          cacheBust: false,
          // Agent previews are ephemeral visual feedback, not portable exports.
          // Avoid re-fetching the full editor font catalog for every before/after
          // render; the browser's already-loaded fonts remain available.
          fontEmbedCSS: '',
          height: presentation.viewportSize * presentation.viewportRatio,
          pixelRatio: Math.min(1.5, 1200 / presentation.viewportSize),
          width: presentation.viewportSize,
        })
        return await dataUrlToBlob(dataUrl)
      }
      catch (error) {
        lastError = error
        await nextFrame()
      }
    }
    console.warn('Agent slide preview failed after three attempts', lastError)
    return undefined
  }
  catch (error) {
    console.warn('Agent slide preview setup failed', error)
    return undefined
  }
  finally {
    root.unmount()
    host.remove()
  }
}
