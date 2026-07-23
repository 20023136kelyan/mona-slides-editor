import { useId, type MouseEventHandler, type PointerEventHandler, type ReactNode } from 'react'

import type { PatternFill, PPTShapeElement, ShapeText, SlideTheme } from '@mona/presentation-core/model'

import {
  getFlipTransform,
  getOutlineRenderStyle,
  getShadowStyle,
  type SlideCSSProperties,
} from '@/features/presentation-renderer/render-utils'

interface ShapeElementProps {
  editor?: ShapeElementEditor
  element: PPTShapeElement
  theme: SlideTheme
}

export interface ShapeElementEditor {
  ariaLabel: string
  content?: ReactNode
  onContextMenu: MouseEventHandler<HTMLDivElement>
  onDoubleClick: MouseEventHandler<HTMLDivElement>
  onPointerDown: PointerEventHandler<HTMLDivElement>
  onPointerUp: PointerEventHandler<HTMLDivElement>
}

function PowerPointPattern({ pattern }: { pattern: PatternFill }) {
  const fine = pattern.patternType.startsWith('lt') || pattern.patternType.startsWith('nar') ? 8 : 12
  const heavy = pattern.patternType.startsWith('dk') ? 2 : 1
  const common = {
    fill: 'none',
    stroke: pattern.foregroundColor,
    strokeWidth: heavy,
  }
  if (/dot|pct/i.test(pattern.patternType)) {
    return <circle cx={fine / 2} cy={fine / 2} fill={pattern.foregroundColor} r={heavy} />
  }
  if (/^(horz|ltHorz|dkHorz|narHorz|dashHorz)$/.test(pattern.patternType)) {
    return <path {...common} d={`M0 ${fine / 2} H${fine}`} />
  }
  if (/^(vert|ltVert|dkVert|narVert|dashVert)$/.test(pattern.patternType)) {
    return <path {...common} d={`M${fine / 2} 0 V${fine}`} />
  }
  if (/^(dnDiag|ltDnDiag|dkDnDiag|wdDnDiag|dashDnDiag)$/.test(pattern.patternType)) {
    return <path {...common} d={`M-${fine / 2} ${fine / 2} L${fine / 2} -${fine / 2} M0 ${fine} L${fine} 0 M${fine / 2} ${fine * 1.5} L${fine * 1.5} ${fine / 2}`} />
  }
  if (/^(upDiag|ltUpDiag|dkUpDiag|wdUpDiag|dashUpDiag)$/.test(pattern.patternType)) {
    return <path {...common} d={`M-${fine / 2} ${fine / 2} L${fine / 2} ${fine * 1.5} M0 0 L${fine} ${fine} M${fine / 2} -${fine / 2} L${fine * 1.5} ${fine / 2}`} />
  }
  if (pattern.patternType === 'cross' || pattern.patternType.endsWith('Grid')) {
    return <path {...common} d={`M0 ${fine / 2} H${fine} M${fine / 2} 0 V${fine}`} />
  }
  return <path {...common} d={`M0 0 L${fine} ${fine} M${fine} 0 L0 ${fine}`} />
}

function ShapeGradient({ element, svgId }: { element: PPTShapeElement; svgId: string }) {
  if (element.pattern) {
    return (
      <pattern
        height="1"
        id={`${svgId}-pattern`}
        patternContentUnits="objectBoundingBox"
        patternUnits="objectBoundingBox"
        width="1"
      >
        <image height="1" href={element.pattern} preserveAspectRatio="xMidYMid slice" width="1" />
      </pattern>
    )
  }
  if (element.powerPointPattern) {
    const fine = element.powerPointPattern.patternType.startsWith('lt') || element.powerPointPattern.patternType.startsWith('nar') ? 8 : 12
    return (
      <pattern height={fine} id={`${svgId}-pattern`} patternUnits="userSpaceOnUse" width={fine}>
        <rect fill={element.powerPointPattern.backgroundColor} height={fine} width={fine} />
        <PowerPointPattern pattern={element.powerPointPattern} />
      </pattern>
    )
  }
  if (!element.gradient) return null
  const id = `${svgId}-gradient`
  if (element.gradient.type === 'linear') {
    return (
      <linearGradient gradientTransform={`rotate(${element.gradient.rotate || 0},0.5,0.5)`} id={id} x1="0%" x2="100%" y1="0%" y2="0%">
        {element.gradient.colors.map(stop => (
          <stop key={`${stop.pos}-${stop.color}`} offset={`${stop.pos}%`} stopColor={stop.color} />
        ))}
      </linearGradient>
    )
  }
  return (
    <radialGradient id={id}>
      {element.gradient.colors.map(stop => (
        <stop key={`${stop.pos}-${stop.color}`} offset={`${stop.pos}%`} stopColor={stop.color} />
      ))}
    </radialGradient>
  )
}

export function ShapeElement({ editor, element, theme }: ShapeElementProps) {
  // SVG url(#id) references resolve to the FIRST matching id in the
  // document, and defs inside a display:none subtree (a hidden <Activity>
  // surface) do not render. Per-instance ids keep every mounted copy of an
  // element self-contained.
  const svgId = useId().replace(/:/g, '')
  const outline = getOutlineRenderStyle(element.outline)
  const shadow = getShadowStyle(element.shadow)
  const flip = getFlipTransform(element.flipH, element.flipV)
  const text: ShapeText = element.text || {
    content: '',
    align: 'middle',
    defaultFontName: theme.fontName,
    defaultColor: theme.fontColor,
  }
  const inset = text.inset || [10, 10, 10, 10]
  const fill = element.pattern || element.powerPointPattern
    ? `url(#${svgId}-pattern)`
    : element.gradient
      ? `url(#${svgId}-gradient)`
      : element.fill || 'none'
  const textStyle: SlideCSSProperties = {
    lineHeight: text.lineHeight,
    letterSpacing: `${text.wordSpace || 0}px`,
    padding: `${inset[0]}px ${inset[1]}px ${inset[2]}px ${inset[3]}px`,
    '--paragraphSpace': `${text.paragraphSpace === undefined ? 5 : text.paragraphSpace}px`,
  }
  const markup = { __html: text.content }

  return (
    <div
      className="mona-element mona-shape-element"
      data-element-id={element.id}
      data-element-type="shape"
      style={{ top: element.top, left: element.left, width: element.width, height: element.height }}
    >
      <div className="mona-rotate-wrapper" style={{ transform: `rotate(${element.rotate}deg)` }}>
        <div
          aria-label={editor?.ariaLabel}
          className="mona-shape-content"
          onContextMenu={editor?.onContextMenu}
          onDoubleClick={editor?.onDoubleClick}
          onPointerDown={editor?.onPointerDown}
          onPointerUp={editor?.onPointerUp}
          role={editor ? 'button' : undefined}
          style={{
            opacity: element.opacity,
            filter: shadow ? `drop-shadow(${shadow})` : '',
            transform: flip,
            color: text.defaultColor,
            fontFamily: text.defaultFontName,
          }}
          tabIndex={editor ? -1 : undefined}
        >
          <svg aria-hidden="true" height={element.height} overflow="visible" width={element.width}>
            <defs><ShapeGradient element={element} svgId={svgId} /></defs>
            <g transform={`scale(${element.width / element.viewBox[0]}, ${element.height / element.viewBox[1]}) translate(0,0) matrix(1,0,0,1,0,0)`}>
              <path
                d={element.path}
                fill={fill}
                stroke={outline.color}
                strokeDasharray={outline.dashArray}
                strokeLinecap="butt"
                strokeMiterlimit={8}
                strokeWidth={outline.width}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          </svg>
          <div className={`mona-shape-text is-${text.align}${editor?.content || text.content ? ' is-editable' : ''}`} style={textStyle}>
            {editor?.content ?? <div className="ProseMirror-static" dangerouslySetInnerHTML={markup} />}
          </div>
        </div>
      </div>
    </div>
  )
}
