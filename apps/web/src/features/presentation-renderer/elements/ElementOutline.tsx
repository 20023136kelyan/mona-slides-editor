import type { PPTElementOutline } from '@mona/presentation-core/model'

import { getOutlineRenderStyle } from '@/features/presentation-renderer/render-utils'

interface ElementOutlineProps {
  height: number
  outline?: PPTElementOutline
  width: number
}

export function ElementOutline({ height, outline, width }: ElementOutlineProps) {
  if (!outline) return null
  const style = getOutlineRenderStyle(outline)

  return (
    <svg
      aria-hidden="true"
      className="mona-element-outline"
      height={height}
      overflow="visible"
      width={width}
    >
      <path
        d={`M0,0 L${width},0 L${width},${height} L0,${height} Z`}
        fill="transparent"
        stroke={style.color}
        strokeDasharray={style.dashArray}
        strokeLinecap="butt"
        strokeMiterlimit={8}
        strokeWidth={style.width}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
