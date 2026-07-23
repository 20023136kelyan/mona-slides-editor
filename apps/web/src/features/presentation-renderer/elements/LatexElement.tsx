import type { PPTLatexElement } from '@mona/presentation-core/model'

export function LatexElement({ element }: { element: PPTLatexElement }) {
  return (
    <div
      className="mona-element mona-latex-element"
      data-element-id={element.id}
      data-element-type="latex"
      style={{ top: element.top, left: element.left, width: element.width, height: element.height }}
    >
      <div className="mona-rotate-wrapper" style={{ transform: `rotate(${element.rotate}deg)` }}>
        <div className="mona-latex-content">
          {element.fallbackImage ? (
            <img alt={element.latex} draggable={false} height={element.height} src={element.fallbackImage} width={element.width} />
          ) : <svg
            aria-label={element.latex}
            fill="none"
            height={element.height}
            overflow="visible"
            stroke={element.color}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={element.strokeWidth}
            width={element.width}
          >
            <g transform={`scale(${element.width / element.viewBox[0]}, ${element.height / element.viewBox[1]}) translate(0,0) matrix(1,0,0,1,0,0)`}>
              <path d={element.path} />
            </g>
          </svg>}
        </div>
      </div>
    </div>
  )
}
