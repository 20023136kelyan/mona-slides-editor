/* oxlint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- PPTist's drawing surface and compact tool palette are pointer-first controls. */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type TouchEvent as ReactTouchEvent } from 'react'
import tippy, { type Instance } from 'tippy.js'
import { useTranslation } from 'react-i18next'

import ArrowIcon from '~icons/icon-park-outline/arrow-right'
import CircleIcon from '~icons/icon-park-outline/round'
import ClearIcon from '~icons/icon-park-outline/clear'
import CloseIcon from '~icons/icon-park-outline/close'
import EraserIcon from '~icons/icon-park-outline/erase'
import FillIcon from '~icons/icon-park-outline/fill'
import HighlighterIcon from '~icons/icon-park-outline/high-light'
import PenIcon from '~icons/icon-park-outline/write'
import PlusIcon from '~icons/icon-park-outline/plus'
import ShapeIcon from '~icons/icon-park-outline/graphic-design'
import SquareIcon from '~icons/icon-park-outline/square'

import { EditorMoveablePanel } from '@/features/editor/EditorMoveablePanel'
import { InspectorSlider } from '@/features/editor/EditorInspectorPrimitives'
import { AUDIENCE_SYNC_CHANNEL, type ScreenSyncMessage } from '@/features/screen/screen-types'
import { ScreenTooltip } from '@/features/screen/ScreenTooltip'
import { readWritingBoardImage, writeWritingBoardImage } from '@/features/screen/screen-writing-storage'

import 'tippy.js/animations/scale.css'

type DrawingModel = 'eraser' | 'mark' | 'pen' | 'shape'
type ShapeType = 'arrow' | 'circle' | 'rect'

const COLORS = ['#000000', '#ffffff', '#1e497b', '#4e81bb', '#e2534d', '#9aba60', '#8165a0', '#47acc5', '#f9974c', '#ffff3a']

interface DrawingCanvasHandle {
  clear: () => void
  getDataURL: () => string
  setDataURL: (dataURL: string) => void
}

function DrawingCanvas({
  blackboard,
  color,
  markSize,
  model,
  onEnd,
  penSize,
  register,
  rubberSize,
  shapeSize,
  shapeType,
}: {
  blackboard: boolean
  color: string
  markSize: number
  model: DrawingModel
  onEnd: () => void
  penSize: number
  register: (handle: DrawingCanvasHandle) => void
  rubberSize: number
  shapeSize: number
  shapeType: ShapeType
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const contextRef = useRef<CanvasRenderingContext2D | null>(null)
  const lastPositionRef = useRef({ x: 0, y: 0 })
  const mouseDownRef = useRef(false)
  const lastTimeRef = useRef(0)
  const lastLineWidthRef = useRef(-1)
  const initialImageDataRef = useRef<ImageData | null>(null)
  const [canvasSize, setCanvasSize] = useState({ height: 0, width: 0 })
  const [mouse, setMouse] = useState({ x: 0, y: 0 })
  const [mouseInCanvas, setMouseInCanvas] = useState(false)

  const updateContext = useCallback(() => {
    const context = contextRef.current
    if (!context) return
    if (model === 'mark') {
      context.globalCompositeOperation = 'xor'
      context.globalAlpha = .5
    }
    else if (model === 'pen' || model === 'shape') {
      context.globalCompositeOperation = 'source-over'
      context.globalAlpha = 1
    }
  }, [model])

  const getDataURL = useCallback(() => canvasRef.current?.toDataURL() || '', [])
  const clear = useCallback(() => {
    const canvas = canvasRef.current
    contextRef.current?.clearRect(0, 0, canvas?.width || 0, canvas?.height || 0)
    onEnd()
  }, [onEnd])
  const setDataURL = useCallback((dataURL: string) => {
    const canvas = canvasRef.current
    const context = contextRef.current
    if (!canvas || !context) return
    context.clearRect(0, 0, canvas.width, canvas.height)
    if (!dataURL) return
    context.globalCompositeOperation = 'source-over'
    context.globalAlpha = 1
    const image = new Image()
    image.src = dataURL
    image.onload = () => {
      context.drawImage(image, 0, 0)
      updateContext()
    }
  }, [updateContext])

  useLayoutEffect(() => {
    const root = rootRef.current
    const canvas = canvasRef.current
    if (!root || !canvas) return undefined
    const updateSize = () => setCanvasSize({ height: root.clientHeight, width: root.clientWidth })
    updateSize()
    canvas.width = root.clientWidth
    canvas.height = root.clientHeight
    const context = canvas.getContext('2d')
    contextRef.current = context
    if (context) {
      context.lineCap = 'round'
      context.lineJoin = 'round'
    }
    const observer = new ResizeObserver(updateSize)
    observer.observe(root)
    return () => observer.disconnect()
  }, [])
  useEffect(updateContext, [updateContext])
  useEffect(() => register({ clear, getDataURL, setDataURL }), [clear, getDataURL, register, setDataURL])

  const scale = () => {
    const canvas = canvasRef.current
    return {
      x: canvas ? canvasSize.width / canvas.width : 1,
      y: canvas ? canvasSize.height / canvas.height : 1,
    }
  }
  const eventPosition = (event: ReactMouseEvent | ReactTouchEvent) => {
    const native = 'changedTouches' in event ? event.changedTouches[0] : event
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!native || !rect) return { displayX: 0, displayY: 0, x: 0, y: 0 }
    const displayX = native.pageX - rect.x
    const displayY = native.pageY - rect.y
    const currentScale = scale()
    return { displayX, displayY, x: displayX / currentScale.x, y: displayY / currentScale.y }
  }
  const draw = (x: number, y: number, lineWidth: number) => {
    const context = contextRef.current
    if (!context) return
    context.lineWidth = lineWidth
    context.strokeStyle = color
    context.beginPath()
    context.moveTo(lastPositionRef.current.x, lastPositionRef.current.y)
    context.lineTo(x, y)
    context.stroke()
    context.closePath()
  }
  const erase = (x: number, y: number) => {
    const context = contextRef.current
    const canvas = canvasRef.current
    if (!context || !canvas) return
    const last = lastPositionRef.current
    const radius = rubberSize / 2
    const angle = Math.atan((y - last.y) / (x - last.x))
    const sinRadius = radius * Math.sin(angle)
    const cosRadius = radius * Math.cos(angle)
    context.save()
    context.beginPath()
    context.arc(x, y, radius, 0, Math.PI * 2)
    context.clip()
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.restore()
    context.save()
    context.beginPath()
    context.moveTo(last.x + sinRadius, last.y - cosRadius)
    context.lineTo(x + sinRadius, y - cosRadius)
    context.lineTo(x - sinRadius, y + cosRadius)
    context.lineTo(last.x - sinRadius, last.y + cosRadius)
    context.closePath()
    context.clip()
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.restore()
  }
  const drawShape = (x: number, y: number) => {
    const context = contextRef.current
    const initial = initialImageDataRef.current
    if (!context || !initial) return
    context.putImageData(initial, 0, 0)
    const start = lastPositionRef.current
    context.save()
    context.lineCap = 'butt'
    context.lineJoin = 'miter'
    context.beginPath()
    if (shapeType === 'rect') context.rect(start.x, start.y, x - start.x, y - start.y)
    else if (shapeType === 'circle') context.ellipse(start.x + (x - start.x) / 2, start.y + (y - start.y) / 2, Math.abs(x - start.x) / 2, Math.abs(y - start.y) / 2, 0, 0, Math.PI * 2)
    else {
      const angle = Math.atan2(y - start.y, x - start.x)
      const length = Math.max(shapeSize, 4) * 2
      context.moveTo(start.x, start.y)
      context.lineTo(x - Math.cos(angle) * length, y - Math.sin(angle) * length)
    }
    context.strokeStyle = color
    context.lineWidth = shapeSize
    context.stroke()
    context.restore()
    if (shapeType !== 'arrow') return
    const angle = Math.atan2(y - start.y, x - start.x)
    const length = Math.max(shapeSize, 4) * 2.6
    const width = Math.max(shapeSize, 4) * 1.6
    const baseX = x - Math.cos(angle) * length
    const baseY = y - Math.sin(angle) * length
    context.save()
    context.beginPath()
    context.moveTo(x, y)
    context.lineTo(baseX + width * Math.cos(angle + Math.PI / 2), baseY + width * Math.sin(angle + Math.PI / 2))
    context.lineTo(baseX + width * Math.cos(angle - Math.PI / 2), baseY + width * Math.sin(angle - Math.PI / 2))
    context.closePath()
    context.fillStyle = color
    context.fill()
    context.restore()
  }
  const move = (x: number, y: number) => {
    if (model === 'pen') {
      const last = lastPositionRef.current
      const distance = Math.hypot(x - last.x, y - last.y)
      const elapsed = Date.now() - lastTimeRef.current
      const velocity = distance / elapsed
      let width = velocity <= .1 ? penSize : velocity >= 10 ? 3 : penSize - velocity / 10 * penSize
      if (lastLineWidthRef.current !== -1) width = width / 3 + lastLineWidthRef.current * 2 / 3
      draw(x, y, width)
      lastLineWidthRef.current = width
      lastPositionRef.current = { x, y }
      lastTimeRef.current = Date.now()
    }
    else if (model === 'mark') {
      draw(x, y, markSize)
      lastPositionRef.current = { x, y }
    }
    else if (model === 'eraser') {
      erase(x, y)
      lastPositionRef.current = { x, y }
    }
    else drawShape(x, y)
  }
  const begin = (event: ReactMouseEvent | ReactTouchEvent) => {
    const position = eventPosition(event)
    if (model === 'shape' && contextRef.current && canvasRef.current) initialImageDataRef.current = contextRef.current.getImageData(0, 0, canvasRef.current.width, canvasRef.current.height)
    mouseDownRef.current = true
    lastPositionRef.current = { x: position.x, y: position.y }
    lastTimeRef.current = Date.now()
    if ('changedTouches' in event) {
      setMouse({ x: position.displayX, y: position.displayY })
      setMouseInCanvas(true)
    }
  }
  const handleMove = (event: ReactMouseEvent | ReactTouchEvent) => {
    const position = eventPosition(event)
    setMouse({ x: position.displayX, y: position.displayY })
    if (mouseDownRef.current) move(position.x, position.y)
  }
  const end = () => {
    if (!mouseDownRef.current) return
    mouseDownRef.current = false
    onEnd()
  }

  return (
    <div className="mona-screen-writing-canvas" ref={rootRef}>
      {blackboard ? <div className="mona-screen-blackboard" /> : null}
      <canvas
        className="mona-screen-writing-canvas-element"
        onMouseDown={begin}
        onMouseEnter={() => setMouseInCanvas(true)}
        onMouseLeave={() => {
          end(); setMouseInCanvas(false) 
        }}
        onMouseMove={handleMove}
        onMouseUp={end}
        onTouchEnd={() => {
          end(); setMouseInCanvas(false) 
        }}
        onTouchMove={handleMove}
        onTouchStart={begin}
        ref={canvasRef}
        style={{ height: canvasSize.height, width: canvasSize.width }}
      />
      {mouseInCanvas && model === 'eraser' ? <div className="mona-screen-eraser-cursor" style={{ height: rubberSize, left: mouse.x - rubberSize / 2, top: mouse.y - rubberSize / 2, width: rubberSize }} /> : null}
      {mouseInCanvas && model === 'pen' ? <div className="mona-screen-pen-cursor" style={{ color, left: mouse.x - penSize / 2, top: mouse.y - penSize * 6 + penSize / 2 }}><PenIcon style={{ fontSize: penSize * 6 }} /></div> : null}
      {mouseInCanvas && model === 'mark' ? <div className="mona-screen-pen-cursor" style={{ color, left: mouse.x - markSize / 2, top: mouse.y }}><HighlighterIcon style={{ fontSize: markSize * 1.5 }} /></div> : null}
      {mouseInCanvas && model === 'shape' ? <div className="mona-screen-pen-cursor" style={{ color, left: mouse.x - 20, top: mouse.y - 20 }}><PlusIcon style={{ fontSize: 40 }} /></div> : null}
    </div>
  )
}

function WritingToolPopover({
  active,
  children,
  label,
  name,
  onClick,
  onHide,
  open,
  trigger,
}: {
  active: boolean
  children: React.ReactNode
  label: string
  name: DrawingModel
  onClick: () => void
  onHide: (name: DrawingModel) => void
  open: boolean
  trigger: React.ReactNode
}) {
  const anchorRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const instanceRef = useRef<Instance | null>(null)
  const handleHidden = useCallback(() => onHide(name), [name, onHide])

  useLayoutEffect(() => {
    const anchor = anchorRef.current
    const content = contentRef.current
    if (!anchor || !content) return undefined
    const instance = tippy(anchor, {
      allowHTML: true,
      animation: 'scale',
      appendTo: document.body,
      content,
      duration: 200,
      interactive: true,
      maxWidth: 'none',
      offset: [0, 8],
      onHidden: handleHidden,
      placement: 'top',
      theme: 'popover',
      trigger: 'manual',
    })
    instanceRef.current = instance
    return () => {
      instanceRef.current = null
      instance.destroy()
    }
  }, [handleHidden])

  useEffect(() => {
    if (open) instanceRef.current?.show()
    else instanceRef.current?.hide()
  }, [open])

  return (
    <div className="mona-screen-writing-tool-wrap" ref={anchorRef}>
      <div className="mona-screen-writing-setting-popover" ref={contentRef}>{children}</div>
      <ScreenTooltip content={label}>
        <div className={`mona-screen-writing-btn${active ? ' is-active' : ''}`} onClick={onClick}>{trigger}</div>
      </ScreenTooltip>
    </div>
  )
}

export function ScreenWritingBoard({
  left = -5,
  onClose,
  slideHeight,
  slideId,
  slideWidth,
  top = -5,
}: {
  left?: number
  onClose: () => void
  slideHeight: number
  slideId: string
  slideWidth: number
  top?: number
}) {
  const { t } = useTranslation()
  const canvasRef = useRef<DrawingCanvasHandle | null>(null)
  const channelRef = useRef<BroadcastChannel | null>(null)
  const blackboardRef = useRef(false)
  const [color, setColor] = useState('#e2534d')
  const [model, setModel] = useState<DrawingModel>('pen')
  const [blackboard, setBlackboard] = useState(false)
  const [sizePopover, setSizePopover] = useState<DrawingModel | null>(null)
  const [shapeType, setShapeType] = useState<ShapeType>('rect')
  const [penSize, setPenSize] = useState(6)
  const [markSize, setMarkSize] = useState(24)
  const [rubberSize, setRubberSize] = useState(80)
  const [shapeSize, setShapeSize] = useState(4)

  const broadcast = useCallback((dataURL: string, nextBlackboard = blackboardRef.current) => {
    channelRef.current?.postMessage({ type: 'WRITING_BOARD_UPDATE', dataURL, blackboard: nextBlackboard } satisfies ScreenSyncMessage)
  }, [])
  const persist = useCallback(() => {
    const dataURL = canvasRef.current?.getDataURL() || ''
    if (!dataURL) return
    broadcast(dataURL)
    void writeWritingBoardImage(slideId, dataURL)
  }, [broadcast, slideId])

  useEffect(() => {
    const channel = new BroadcastChannel(AUDIENCE_SYNC_CHANNEL)
    channelRef.current = channel
    channel.onmessage = ({ data }: MessageEvent<ScreenSyncMessage>) => {
      if (data.type === 'REQUEST_WRITING_BOARD') broadcast(canvasRef.current?.getDataURL() || '')
    }
    return () => {
      channel.postMessage({ type: 'WRITING_BOARD_CLOSE' } satisfies ScreenSyncMessage)
      channelRef.current = null
      channel.close()
    }
  }, [broadcast])
  useEffect(() => {
    void readWritingBoardImage(slideId).then(dataURL => {
      canvasRef.current?.setDataURL(dataURL)
      broadcast(dataURL)
    })
  }, [broadcast, slideId])
  useEffect(() => {
    blackboardRef.current = blackboard
    broadcast(canvasRef.current?.getDataURL() || '', blackboard)
  }, [blackboard, broadcast])

  const changeModel = (next: DrawingModel) => {
    setModel(next)
    setSizePopover(current => current === next ? null : next)
  }
  const close = () => {
    channelRef.current?.postMessage({ type: 'WRITING_BOARD_CLOSE' } satisfies ScreenSyncMessage)
    onClose()
  }
  const clear = () => {
    canvasRef.current?.clear()
    broadcast('')
  }
  const chooseColor = (next: string) => {
    if (model === 'eraser') setModel('pen')
    setColor(next)
  }
  const hidePopover = useCallback((name: DrawingModel) => {
    setSizePopover(current => current === name ? null : current)
  }, [])
  const tool = (name: DrawingModel, label: string, icon: React.ReactNode, settings: React.ReactNode) => (
    <WritingToolPopover
      active={model === name}
      label={label}
      name={name}
      onClick={() => changeModel(name)}
      onHide={hidePopover}
      open={sizePopover === name}
      trigger={icon}
    >
      {settings}
    </WritingToolPopover>
  )

  return (
    <div className="mona-screen-writing-board">
      <div className="mona-screen-writing-wrap" style={{ height: slideHeight, width: slideWidth }}>
        <DrawingCanvas blackboard={blackboard} color={color} markSize={markSize} model={model} onEnd={persist} penSize={penSize} register={handle => {
          canvasRef.current = handle 
        }} rubberSize={rubberSize} shapeSize={shapeSize} shapeType={shapeType} />
      </div>
      <EditorMoveablePanel className="mona-screen-writing-tools-panel" height={50} left={left} top={top} width={510}>
        <div className="mona-screen-writing-tools" onMouseDown={event => event.stopPropagation()}>
          <div className="mona-screen-writing-tool-content">
            {tool('pen', t('screen.pen'), <PenIcon />, <div className="mona-screen-writing-setting"><span>{t('drawingTools.strokeWidth')}</span><InspectorSlider ariaLabel={t('drawingTools.strokeWidth')} max={10} min={4} onChange={setPenSize} step={2} value={penSize} /></div>)}
            {tool('shape', t('drawingTools.shape'), <ShapeIcon />, <div className="mona-screen-writing-setting is-shape"><div className="mona-screen-writing-shapes"><SquareIcon className={shapeType === 'rect' ? 'is-active' : ''} onClick={() => setShapeType('rect')} /><CircleIcon className={shapeType === 'circle' ? 'is-active' : ''} onClick={() => setShapeType('circle')} /><ArrowIcon className={shapeType === 'arrow' ? 'is-active' : ''} onClick={() => setShapeType('arrow')} /></div><div className="mona-screen-writing-divider" /><span>{t('drawingTools.strokeWidth')}</span><InspectorSlider ariaLabel={t('drawingTools.strokeWidth')} max={8} min={2} onChange={setShapeSize} step={2} value={shapeSize} /></div>)}
            {tool('mark', t('drawingTools.highlighter'), <HighlighterIcon />, <div className="mona-screen-writing-setting"><span>{t('drawingTools.strokeWidth')}</span><InspectorSlider ariaLabel={t('drawingTools.strokeWidth')} max={40} min={16} onChange={setMarkSize} step={4} value={markSize} /></div>)}
            {tool('eraser', t('drawingTools.eraser'), <EraserIcon />, <div className="mona-screen-writing-setting"><span>{t('drawingTools.eraserSize')}</span><InspectorSlider ariaLabel={t('drawingTools.eraserSize')} max={200} min={20} onChange={setRubberSize} step={20} value={rubberSize} /></div>)}
            <ScreenTooltip content={t('drawingTools.clear')}><div className="mona-screen-writing-btn" onClick={clear}><ClearIcon /></div></ScreenTooltip>
            <ScreenTooltip content={t('drawingTools.blackboard')}><div className={`mona-screen-writing-btn${blackboard ? ' is-active' : ''}`} onClick={() => setBlackboard(current => !current)}><FillIcon /></div></ScreenTooltip>
            <div className="mona-screen-writing-colors">
              {COLORS.map(item => <div className={`mona-screen-writing-color${item === color ? ' is-active' : ''}${item === '#ffffff' ? ' is-white' : ''}`} key={item} onClick={() => chooseColor(item)} style={{ backgroundColor: item }} />)}
            </div>
          </div>
          <ScreenTooltip content={t('drawingTools.close')}><div className="mona-screen-writing-btn is-close" onClick={close}><CloseIcon /></div></ScreenTooltip>
        </div>
      </EditorMoveablePanel>
    </div>
  )
}
