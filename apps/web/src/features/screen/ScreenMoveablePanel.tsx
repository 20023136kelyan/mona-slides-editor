import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import CloseIcon from '~icons/icon-park-outline/close'

import { Button } from '@/components/ui/button'

const Z_INDEX_KEY = '__screen_panel_z_index__'
const ACTIVE_PANELS_KEY = '__screen_panel_active_count__'
const Z_INDEX_BASE = 900
const Z_INDEX_MAX = 999

type PanelGlobals = Window & Record<typeof Z_INDEX_KEY | typeof ACTIVE_PANELS_KEY, number>

export function ScreenMoveablePanel({
  ariaLabel,
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
  onEscape,
  resizeable = false,
  title = '',
  top = 10,
  width,
}: {
  ariaLabel?: string
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
  onEscape?: () => void
  resizeable?: boolean
  title?: string
  top?: number
  width: number
}) {
  const { t } = useTranslation()
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

  const constrainPosition = (x: number, y: number, panelHeight = geometry.h || panelRef.current?.clientHeight || 0) => ({
    x: Math.max(0, Math.min(x, document.body.clientWidth - geometry.w)),
    y: Math.max(0, Math.min(y, document.body.clientHeight - panelHeight)),
  })

  const startMove = (event: { pageX: number; pageY: number }) => {
    if (!moveable) return
    bringToFront()
    const startX = event.pageX
    const startY = event.pageY
    const origin = geometry
    document.onmousemove = moveEvent => {
      const realHeight = origin.h || panelRef.current?.clientHeight || 0
      const next = constrainPosition(origin.x + moveEvent.pageX - startX, origin.y + moveEvent.pageY - startY, realHeight)
      setGeometry(current => ({ ...current, ...next }))
    }
    document.onmouseup = () => {
      document.onmousemove = null
      document.onmouseup = null
    }
  }

  const startResize = (event: { pageX: number; pageY: number }) => {
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
  const moveFromKeyboard = (event: KeyboardEvent<HTMLButtonElement>) => {
    const offsets: Partial<Record<string, [number, number]>> = {
      ArrowDown: [0, 1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
    }
    const offset = offsets[event.key]
    if (!offset || !moveable) return
    event.preventDefault()
    const distance = event.shiftKey ? 10 : 1
    const next = constrainPosition(geometry.x + offset[0] * distance, geometry.y + offset[1] * distance)
    setGeometry(current => ({ ...current, ...next }))
    bringToFront()
  }
  const resizeFromKeyboard = (event: KeyboardEvent<HTMLButtonElement>) => {
    const offsets: Partial<Record<string, [number, number]>> = {
      ArrowDown: [0, 1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
    }
    const offset = offsets[event.key]
    if (!offset || !resizeable) return
    event.preventDefault()
    const distance = event.shiftKey ? 10 : 1
    setGeometry(current => ({
      ...current,
      h: Math.max(minHeight, Math.min(maxHeight, current.h + offset[1] * distance)),
      w: Math.max(minWidth, Math.min(maxWidth, current.w + offset[0] * distance)),
    }))
    bringToFront()
  }

  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return undefined
    const handleMouseDown = (event: globalThis.MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null
      const interactiveTarget = target?.closest('button, input, select, textarea, a, [data-panel-drag-ignore]')
      if (title || interactiveTarget) {
        bringToFront()
        return
      }
      startMove(event)
    }
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || !onEscape) return
      event.preventDefault()
      event.stopPropagation()
      onEscape()
    }
    panel.addEventListener('mousedown', handleMouseDown)
    panel.addEventListener('keydown', handleKeyDown)
    return () => {
      panel.removeEventListener('mousedown', handleMouseDown)
      panel.removeEventListener('keydown', handleKeyDown)
    }
  })

  return (
    <div
      aria-label={ariaLabel}
      className={`mona-screen-moveable-panel${className ? ` ${className}` : ''}`}
      ref={panelRef}
      role={ariaLabel ? 'dialog' : undefined}
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
          <div className="mona-screen-moveable-panel-header">
            <Button aria-label={t('screen.movePanel')} className="mona-screen-moveable-panel-title" onKeyDown={moveFromKeyboard} onMouseDown={startMove} size={null} type="button" variant={null}>{title}</Button>
            <Button aria-label={t('common.close')} className="mona-screen-moveable-panel-close" onClick={onClose} size={null} type="button" variant={null}><CloseIcon /></Button>
          </div>
          <div className="mona-screen-moveable-panel-content" style={contentStyle}>{children}</div>
        </>
      ) : (
        <>
          {moveable ? <Button aria-label={t('screen.movePanel')} className="mona-visually-hidden" onKeyDown={moveFromKeyboard} size={null} type="button" variant={null} /> : null}
          <div className="mona-screen-moveable-panel-content" style={contentStyle}>{children}</div>
        </>
      )}
      {resizeable ? <Button aria-label={t('screen.resizePanel')} className="mona-screen-moveable-panel-resizer" onKeyDown={resizeFromKeyboard} onMouseDown={startResize} size={null} type="button" variant={null} /> : null}
    </div>
  )
}
