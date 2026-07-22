import { useLayoutEffect, useRef, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'

import EditIcon from '~icons/icon-park-outline/edit'
import PaletteIcon from '~icons/icon-park-outline/platte'
import type { PPTLatexElement } from '@mona/presentation-core/model'

import { InspectorPopoverButton } from '@/features/editor/EditorInspectorPrimitives'
import { EditorColorPicker } from '@/features/editor/EditorColorPicker'
import { getElementBounds } from '@/features/editor/editor-geometry'
import type { EditorRuntime } from '@/features/editor/editor-runtime'

export function EditorFloatingLatexToolbar({ element, frameRef, onEdit, runtime, scale, stageRef }: {
  element: PPTLatexElement
  frameRef: RefObject<HTMLDivElement | null>
  onEdit: () => void
  runtime: EditorRuntime
  scale: number
  stageRef: RefObject<HTMLElement | null>
}) {
  const { t } = useTranslation()
  const toolbarRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const toolbar = toolbarRef.current
    const frame = frameRef.current
    const stage = stageRef.current
    if (!toolbar || !frame || !stage) return undefined
    const update = () => {
      const range = getElementBounds(element)
      const stageRect = stage.getBoundingClientRect()
      const frameRect = frame.getBoundingClientRect()
      const minLeft = stageRect.left - frameRect.left + 10
      const maxLeft = stageRect.right - frameRect.left - toolbar.clientWidth - 10
      const requestedLeft = range.minX * scale
      const left = maxLeft < minLeft ? minLeft : Math.min(Math.max(requestedLeft, minLeft), maxLeft)
      const bottomTop = range.maxY * scale + 10
      const placeAbove = stageRect.height > 0 && bottomTop + 40 > stageRect.bottom - frameRect.top
      const requestedTop = placeAbove ? range.minY * scale - 80 : bottomTop
      const top = Math.max(stageRect.top - frameRect.top + 10, requestedTop)
      toolbar.style.left = left + 'px'
      toolbar.style.top = top + 'px'
      toolbar.style.visibility = 'visible'
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(toolbar)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [element, frameRef, scale, stageRef])

  const updateColor = (color: string) => runtime.commit('Update equation color', [{
    type: 'element.update',
    payload: { id: element.id, props: { color } },
  }])

  return (
    <div className="mona-floating-toolbar mona-floating-latex-toolbar" onPointerDown={event => event.stopPropagation()} ref={toolbarRef} style={{ visibility: 'hidden' }}>
      <div className="mona-floating-toolbar-content">
        <button className="mona-floating-toolbar-button is-labeled" onClick={onEdit} type="button"><EditIcon /><span>{t('foundation.editor.latex.edit')}</span></button>
        <InspectorPopoverButton ariaLabel={t('foundation.editor.latex.colorName')} className="mona-floating-toolbar-button is-labeled" content={<EditorColorPicker onChange={updateColor} value={element.color} />}><PaletteIcon /><span>{t('foundation.editor.latex.colorName')}</span></InspectorPopoverButton>
      </div>
    </div>
  )
}
