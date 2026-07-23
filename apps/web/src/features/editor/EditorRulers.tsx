import type { PointerPosition } from '@mona/editor-interactions'
import type { InteractionBounds } from '@mona/editor-interactions/geometry'

export function EditorRulers({ frameHeight, frameWidth, height, pan, scale, selection, width }: {
  frameHeight: number
  frameWidth: number
  height: number
  pan: PointerPosition
  scale: number
  selection?: InteractionBounds
  width: number
}) {
  const markers = Array.from({ length: 20 }, (_, index) => index + 1)
  const markerSize = 100 * scale
  const markerClassName = `mona-ruler-marker-100${markerSize < 36 ? ' hide' : ''}${markerSize < 72 ? ' omit' : ''}`
  return (
    <div aria-hidden="true" className="mona-editor-rulers">
      <div
        className="mona-editor-ruler is-horizontal"
        style={{
          left: `calc(50% - ${frameWidth / 2}px + ${pan.x}px)`,
          width: frameWidth,
        }}
      >
        {markers.map(marker => (
          <div className={markerClassName} key={`h-marker-100-${marker}`} style={{ width: markerSize }}>
            {marker * 100 <= width ? <span>{marker * 100}</span> : null}
          </div>
        ))}
        {selection ? (
          <i
            className="mona-ruler-range"
            style={{ left: selection.minX * scale, width: (selection.maxX - selection.minX) * scale }}
          />
        ) : null}
      </div>
      <div
        className="mona-editor-ruler is-vertical"
        style={{
          height: frameHeight,
          top: `calc(50% - ${frameHeight / 2}px + ${pan.y}px)`,
        }}
      >
        {markers.map(marker => (
          <div className={markerClassName} key={`v-marker-100-${marker}`} style={{ height: markerSize }}>
            {marker * 100 <= height ? <span>{marker * 100}</span> : null}
          </div>
        ))}
        {selection ? (
          <i
            className="mona-ruler-range"
            style={{ height: (selection.maxY - selection.minY) * scale, top: selection.minY * scale }}
          />
        ) : null}
      </div>
    </div>
  )
}

