import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'

import ChartIcon from '~icons/icon-park-outline/chart-histogram'
import EditIcon from '~icons/icon-park-outline/edit'
import type { PPTChartElement } from '@mona/presentation-core/model'
import { Popover as PopoverPrimitive } from 'radix-ui'

import { CHART_TYPES } from '@/features/editor/editor-chart'
import { getElementBounds } from '@/features/editor/editor-geometry'
import type { EditorRuntime } from '@/features/editor/editor-runtime'

export function EditorFloatingChartToolbar({ element, frameRef, onEditData, runtime, scale, stageRef }: {
  element: PPTChartElement
  frameRef: RefObject<HTMLDivElement | null>
  onEditData: () => void
  runtime: EditorRuntime
  scale: number
  stageRef: RefObject<HTMLElement | null>
}) {
  const { t } = useTranslation()
  const toolbarRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
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
      // Charts have no rotate handle in PPTist, so the above-placement gap is
      // 10 (not the 40 rotate gap): 10 gap + 40 toolbar height.
      const requestedTop = placeAbove ? range.minY * scale - 50 : bottomTop
      const top = Math.max(stageRect.top - frameRect.top + 10, requestedTop)
      setPosition(current => current?.left === left && current.top === top ? current : { left, top })
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(toolbar)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [element, frameRef, scale, stageRef])

  const changeType = (chartType: PPTChartElement['chartType']) => {
    if (element.chartType === chartType) return
    runtime.commit('Change chart type', [{ type: 'element.update', payload: { id: element.id, props: { chartType } } }])
  }

  return (
    <div className="mona-floating-toolbar mona-floating-chart-toolbar" onPointerDown={event => event.stopPropagation()} ref={toolbarRef} style={position || { visibility: 'hidden' }}>
      <div className="mona-floating-toolbar-content">
        <button className="mona-floating-toolbar-button is-labeled" onClick={onEditData} type="button"><EditIcon /><span>{t('foundation.editor.chartStyle.editData')}</span></button>
        <PopoverPrimitive.Root>
          <PopoverPrimitive.Trigger asChild><button className="mona-floating-toolbar-button is-labeled" type="button"><ChartIcon /><span>{t('foundation.editor.chartStyle.type')}</span></button></PopoverPrimitive.Trigger>
          <PopoverPrimitive.Portal>
            <PopoverPrimitive.Content align="center" className="mona-chart-type-menu is-floating" sideOffset={8}>
              {CHART_TYPES.map(type => <button key={type} onClick={() => changeType(type)} type="button">{t(`foundation.editor.chartTypes.${type}`)}</button>)}
            </PopoverPrimitive.Content>
          </PopoverPrimitive.Portal>
        </PopoverPrimitive.Root>
      </div>
    </div>
  )
}
