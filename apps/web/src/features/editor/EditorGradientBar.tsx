/* oxlint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- Preserve PPTist's click-anywhere gradient track while the individual stops remain semantic buttons. */
import { useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'

import type { GradientColor } from '@mona/presentation-core/model'

export function EditorGradientBar({
  index,
  onChange,
  onIndexChange,
  value,
}: {
  index: number
  onChange: (value: GradientColor[]) => void
  onIndexChange: (index: number) => void
  value: GradientColor[]
}) {
  const barRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState<GradientColor[] | null>(null)
  const points = draft ?? value
  const gradient = `linear-gradient(to right, ${points.map(item => `${item.color} ${item.pos}%`).join(',')})`

  const position = (clientX: number) => {
    const rect = barRef.current!.getBoundingClientRect()
    return Math.min(100, Math.max(0, Math.round(((clientX - rect.left) / barRef.current!.clientWidth) * 100)))
  }

  const addPoint = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (value.length >= 6 || event.target !== event.currentTarget) return
    const pos = position(event.clientX)
    let targetIndex = 0
    for (let itemIndex = 0; itemIndex < value.length; itemIndex += 1) {
      if (pos > value[itemIndex]!.pos) targetIndex = itemIndex + 1
    }
    const color = value[targetIndex - 1]?.color ?? value[targetIndex]!.color
    const next = [...value]
    next.splice(targetIndex, 0, { pos, color })
    onIndexChange(targetIndex)
    onChange(next)
  }

  const startMove = (event: ReactMouseEvent<HTMLButtonElement>, pointIndex: number) => {
    if (event.button !== 0) return
    event.preventDefault()
    let next = value
    const move = (pointer: MouseEvent) => {
      const pos = position(pointer.clientX)
      next = next.map((point, itemIndex) => itemIndex === pointIndex ? { ...point, pos } : point)
      setDraft(next)
    }
    const stop = () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', stop)
      const point = next[pointIndex]!
      const sorted = next.filter((_, itemIndex) => itemIndex !== pointIndex)
      let targetIndex = 0
      for (let itemIndex = 0; itemIndex < sorted.length; itemIndex += 1) {
        if (point.pos > sorted[itemIndex]!.pos) targetIndex = itemIndex + 1
      }
      sorted.splice(targetIndex, 0, point)
      setDraft(null)
      onIndexChange(targetIndex)
      onChange(sorted)
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', stop, { once: true })
  }

  const removePoint = (event: ReactMouseEvent<HTMLButtonElement>, pointIndex: number) => {
    event.preventDefault()
    if (value.length <= 2) return
    let targetIndex = 0
    if (pointIndex === index) targetIndex = pointIndex - 1 < 0 ? 0 : pointIndex - 1
    else if (index === value.length - 1) targetIndex = value.length - 2
    onIndexChange(targetIndex)
    onChange(value.filter((_, itemIndex) => itemIndex !== pointIndex))
  }

  return (
    <div className="mona-design-gradient-bar">
      <div className="mona-design-gradient-bar-track" onClick={addPoint} ref={barRef} style={{ backgroundImage: gradient }} />
      {points.map((point, pointIndex) => (
        <button
          aria-label={`Gradient stop ${pointIndex + 1}`}
          aria-pressed={index === pointIndex}
          className={`mona-design-gradient-bar-point${index === pointIndex ? ' is-active' : ''}`}
          key={`${point.pos}-${pointIndex}`}
          onContextMenu={event => removePoint(event, pointIndex)}
          onMouseDown={event => startMove(event, pointIndex)}
          style={{ backgroundColor: point.color, left: `calc(${point.pos}% - 5px)` }}
          type="button"
        />
      ))}
    </div>
  )
}
