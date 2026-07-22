/* oxlint-disable jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- PPTist's panel chrome is a pixel-matched pointer drag surface; keyboard panel actions are exposed by the toolbar/menu routes. */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react'

import CloseIcon from '~icons/icon-park-outline/close'

const Z_INDEX_KEY = '__moveable_panel_z_index__'
const ACTIVE_PANELS_KEY = '__moveable_panel_active_count__'
const Z_INDEX_BASE = 900
const Z_INDEX_MAX = 999

type PanelGlobals = Window & Record<typeof Z_INDEX_KEY | typeof ACTIVE_PANELS_KEY, number>

export function EditorMoveablePanel({
  children,
  className = '',
  contentStyle,
  height,
  left = 10,
  maxHeight = 500,
  maxWidth = 500,
  minHeight = 20,
  minWidth = 20,
  moveable = true,
  onClose,
  resizeable = false,
  title = '',
  top = 10,
  width,
}: {
  children: ReactNode
  className?: string
  contentStyle?: CSSProperties
  height: number
  left?: number
  maxHeight?: number
  maxWidth?: number
  minHeight?: number
  minWidth?: number
  moveable?: boolean
  onClose?: () => void
  resizeable?: boolean
  title?: string
  top?: number
  width: number
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const zIndexRef = useRef(Z_INDEX_BASE)
  const [geometry, setGeometry] = useState({ h: height, w: width, x: 0, y: 0 })
  const [zIndex, setZIndex] = useState(Z_INDEX_BASE)

  const bringToFront = () => {
    const globals = window as unknown as PanelGlobals
    if (!globals[Z_INDEX_KEY]) globals[Z_INDEX_KEY] = Z_INDEX_BASE
    const current = globals[Z_INDEX_KEY]
    if (zIndex === current) return
    globals[Z_INDEX_KEY] = current >= Z_INDEX_MAX ? Z_INDEX_BASE + 1 : current + 1
    zIndexRef.current = globals[Z_INDEX_KEY]
    setZIndex(globals[Z_INDEX_KEY])
  }

  useLayoutEffect(() => {
    const realHeight = height || panelRef.current?.clientHeight || 0
    setGeometry({
      h: height,
      w: width,
      x: left >= 0 ? left : document.body.clientWidth + left - width,
      y: top >= 0 ? top : document.body.clientHeight + top - realHeight,
    })
    const globals = window as unknown as PanelGlobals
    if (!globals[Z_INDEX_KEY]) globals[Z_INDEX_KEY] = Z_INDEX_BASE
    if (!globals[ACTIVE_PANELS_KEY]) globals[ACTIVE_PANELS_KEY] = 0
    globals[ACTIVE_PANELS_KEY] += 1
    const current = globals[Z_INDEX_KEY]
    globals[Z_INDEX_KEY] = current >= Z_INDEX_MAX ? Z_INDEX_BASE : current + 1
    zIndexRef.current = globals[Z_INDEX_KEY]
    setZIndex(globals[Z_INDEX_KEY])
  }, [height, left, top, width])

  useEffect(() => () => {
    const globals = window as unknown as PanelGlobals
    if (!globals[Z_INDEX_KEY] || !globals[ACTIVE_PANELS_KEY]) return
    globals[ACTIVE_PANELS_KEY] -= 1
    if (zIndexRef.current === globals[Z_INDEX_KEY] && globals[Z_INDEX_KEY] > Z_INDEX_BASE) globals[Z_INDEX_KEY] -= 1
    if (globals[ACTIVE_PANELS_KEY] <= 0) {
      globals[Z_INDEX_KEY] = Z_INDEX_BASE
      globals[ACTIVE_PANELS_KEY] = 0
    }
  }, [])

  const startMove = (event: MouseEvent) => {
    if (!moveable) return
    bringToFront()
    const startX = event.pageX
    const startY = event.pageY
    const origin = geometry
    document.onmousemove = moveEvent => {
      const realHeight = origin.h || panelRef.current?.clientHeight || 0
      let x = origin.x + moveEvent.pageX - startX
      let y = origin.y + moveEvent.pageY - startY
      x = Math.max(0, Math.min(x, document.body.clientWidth - origin.w))
      y = Math.max(0, Math.min(y, document.body.clientHeight - realHeight))
      setGeometry(current => ({ ...current, x, y }))
    }
    document.onmouseup = () => {
      document.onmousemove = null
      document.onmouseup = null
    }
  }

  const startResize = (event: MouseEvent) => {
    if (!resizeable) return
    const startX = event.pageX
    const startY = event.pageY
    const origin = geometry
    document.onmousemove = moveEvent => {
      const w = Math.max(minWidth, Math.min(maxWidth, origin.w + moveEvent.pageX - startX))
      const h = Math.max(minHeight, Math.min(maxHeight, origin.h + moveEvent.pageY - startY))
      setGeometry(current => ({ ...current, h, w }))
    }
    document.onmouseup = () => {
      document.onmousemove = null
      document.onmouseup = null
    }
  }

  return (
    <div
      className={`mona-moveable-panel${className ? ` ${className}` : ''}`}
      ref={panelRef}
      style={{
        height: geometry.h ? `${geometry.h}px` : 'auto',
        left: geometry.x,
        top: geometry.y,
        width: geometry.w,
        zIndex,
      }}
    >
      {title ? (
        <>
          <div className="mona-moveable-panel-header" onMouseDown={startMove}>
            <div className="mona-moveable-panel-title">{title}</div>
            <div className="mona-moveable-panel-close" onClick={onClose} onMouseDown={event => event.stopPropagation()}><CloseIcon /></div>
          </div>
          <div className="mona-moveable-panel-content" onMouseDown={event => {
            if (moveable) {
              event.stopPropagation(); bringToFront() 
            } 
          }} style={contentStyle}>{children}</div>
        </>
      ) : (
        <div className="mona-moveable-panel-content" onMouseDown={startMove} style={contentStyle}>{children}</div>
      )}
      {resizeable ? <div className="mona-moveable-panel-resizer" onMouseDown={startResize} /> : null}
    </div>
  )
}
