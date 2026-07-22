import { useEffect, useRef, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'

import { editorActions } from '@mona/editor-state'
import type { PPTElement } from '@mona/presentation-core/model'

import { getElementBounds } from '@/features/editor/editor-geometry'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { replaceLegacyPlaceholders } from '@/lib/utils'

const FLOAT_LAYER_GAP = 10
const FLOATING_TOOLBAR_HEIGHT = 40

export function EditorFloatingLinkHandler({
  element,
  frameRef,
  onChangeLink,
  runtime,
  scale,
  stageRef,
  toolbarVisible,
}: {
  element: PPTElement
  frameRef: RefObject<HTMLDivElement | null>
  onChangeLink: () => void
  runtime: EditorRuntime
  scale: number
  stageRef: RefObject<HTMLElement | null>
  toolbarVisible: boolean
}) {
  const { t } = useTranslation()
  const handlerRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => {
    const handler = handlerRef.current
    const frame = frameRef.current
    const stage = stageRef.current
    if (!handler || !frame || !stage) return undefined
    const update = () => {
      const range = getElementBounds(element)
      const stageRect = stage.getBoundingClientRect()
      const frameRect = frame.getBoundingClientRect()
      const minLeft = stageRect.left - frameRect.left + FLOAT_LAYER_GAP
      const maxLeft = stageRect.right - frameRect.left - handler.clientWidth - FLOAT_LAYER_GAP
      const requestedLeft = range.minX * scale
      const left = maxLeft < minLeft ? minLeft : Math.min(Math.max(requestedLeft, minLeft), maxLeft)
      const bottomTop = range.maxY * scale + FLOAT_LAYER_GAP
      // Vue stacks the handler below a bottom-placed floating toolbar for the
      // same element; the toolbars share this placement formula.
      const toolbarPlacedBottom = toolbarVisible &&
        !(stageRect.height > 0 && bottomTop + FLOATING_TOOLBAR_HEIGHT > stageRect.bottom - frameRect.top)
      const top = bottomTop + (toolbarPlacedBottom ? FLOATING_TOOLBAR_HEIGHT + FLOAT_LAYER_GAP : 0)
      setPosition(current => current?.left === left && current.top === top ? current : { left, top })
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(handler)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [element, frameRef, scale, stageRef, toolbarVisible])

  const link = element.link
  if (!link) return null

  const goToSlide = () => {
    const slides = runtime.store.getState().presentation.slides
    const index = slides.findIndex(slide => slide.id === link.target)
    if (index === -1) return
    runtime.store.dispatch(editorActions.selectionChanged([]))
    runtime.focusSlide(index)
  }

  const removeLink = () => {
    runtime.commit('Remove element link', [{
      type: 'element.properties.remove',
      payload: { id: element.id, property: ['link'] },
    }])
  }

  return (
    <div className="mona-link-handler" onPointerDown={event => event.stopPropagation()} ref={handlerRef} style={position || { visibility: 'hidden' }}>
      {link.type === 'web'
        ? <a className="mona-link-handler-link" href={link.target} rel="noreferrer" target="_blank">{link.target}</a>
        : <button className="mona-link-handler-link" onClick={goToSlide} type="button">{replaceLegacyPlaceholders(t('canvas.slideLink'), { number: link.target })}</button>}
      <div className="mona-link-handler-buttons">
        <button className="mona-link-handler-button" onClick={onChangeLink} type="button">{t('canvas.change')}</button>
        <div className="mona-link-handler-divider" />
        <button className="mona-link-handler-button" onClick={removeLink} type="button">{t('canvas.remove')}</button>
      </div>
    </div>
  )
}
