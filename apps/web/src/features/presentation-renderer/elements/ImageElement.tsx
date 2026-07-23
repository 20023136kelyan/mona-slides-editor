import type { PPTImageElement } from '@mona/presentation-core/model'

import {
  getFlipTransform,
  getImageClip,
  getImageFilter,
  getImagePosition,
  getOutlineRenderStyle,
  getShadowStyle,
} from '@/features/presentation-renderer/render-utils'

function ImageOutline({ element }: { element: PPTImageElement }) {
  if (!element.outline) return null
  const clip = getImageClip(element)
  const outline = getOutlineRenderStyle(element.outline)
  const common = {
    fill: 'transparent',
    stroke: outline.color,
    strokeDasharray: outline.dashArray,
    strokeLinecap: 'butt' as const,
    strokeMiterlimit: 8,
    strokeWidth: outline.width,
    vectorEffect: 'non-scaling-stroke' as const,
  }

  return (
    <svg aria-hidden="true" className="mona-image-outline" height={element.height} overflow="visible" width={element.width}>
      {clip.type === 'rect' ? (
        <rect {...common} height={element.height} rx={clip.radius || 0} ry={clip.radius || 0} width={element.width} />
      ) : null}
      {clip.type === 'ellipse' ? (
        <ellipse {...common} cx={element.width / 2} cy={element.height / 2} rx={element.width / 2} ry={element.height / 2} />
      ) : null}
      {clip.type === 'polygon' && clip.createPath ? (
        <path {...common} d={clip.createPath(element.width, element.height)} />
      ) : null}
    </svg>
  )
}

export function ImageElement({ element }: { element: PPTImageElement }) {
  const clip = getImageClip(element)
  const shadow = getShadowStyle(element.shadow)
  const flip = getFlipTransform(element.flipH, element.flipV)

  return (
    <div
      className="mona-element mona-image-element"
      data-element-id={element.id}
      data-element-type="image"
      style={{ top: element.top, left: element.left, width: element.width, height: element.height }}
    >
      <div className="mona-rotate-wrapper" style={{ transform: `rotate(${element.rotate}deg)` }}>
        <div className="mona-image-element-content" style={{ filter: shadow ? `drop-shadow(${shadow})` : '', opacity: element.opacity, transform: flip }}>
          <ImageOutline element={element} />
          <div className="mona-image-content" style={{ clipPath: clip.style }}>
            <img
              alt=""
              draggable={false}
              src={element.src || undefined}
              style={{ ...getImagePosition(element), filter: getImageFilter(element.filters) }}
            />
            {element.colorMask ? <div className="mona-image-color-mask" style={{ backgroundColor: element.colorMask }} /> : null}
          </div>
        </div>
      </div>
    </div>
  )
}
