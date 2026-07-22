import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'

import ConnectionIcon from '~icons/icon-park-outline/connection'
import FillIcon from '~icons/icon-park-outline/fill'
import PaletteIcon from '~icons/icon-park-outline/platte'
import SelectedIcon from '~icons/icon-park-outline/selected'
import type { PresentationState } from '@mona/presentation-core'
import type { LineStyleType, PPTLineElement, PPTShapeElement } from '@mona/presentation-core/model'

import { EditorColorPicker } from '@/features/editor/EditorColorPicker'
import { EditorFloatingRichTextControls } from '@/features/editor/EditorFloatingTextToolbar'
import {
  InspectorColorButton,
  InspectorNumberInput,
  InspectorPopoverButton,
  InspectorSelect,
  InspectorSlider,
} from '@/features/editor/EditorInspectorPrimitives'
import { LinePreview, PropertyRow } from '@/features/editor/ElementStyleCommons'
import { getElementBounds } from '@/features/editor/editor-geometry'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { lineStyleOptions } from '@/features/editor/editor-style-options'

type ToolbarElement = PPTLineElement | PPTShapeElement

export function EditorFloatingElementToolbar({
  element,
  frameRef,
  presentation,
  runtime,
  scale,
  stageRef,
}: {
  element: ToolbarElement
  frameRef: RefObject<HTMLDivElement | null>
  presentation: PresentationState
  runtime: EditorRuntime
  scale: number
  stageRef: RefObject<HTMLElement | null>
}) {
  const { t } = useTranslation()
  const toolbarRef = useRef<HTMLDivElement>(null)
  const [borderOpen, setBorderOpen] = useState(false)
  const [fillOpen, setFillOpen] = useState(false)
  const [lineColorOpen, setLineColorOpen] = useState(false)
  const [lineStyleOpen, setLineStyleOpen] = useState(false)
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
      const availableTop = stageRect.top - frameRect.top
      const availableBottom = stageRect.bottom - frameRect.top
      const availableLeft = stageRect.left - frameRect.left
      const availableRight = stageRect.right - frameRect.left
      const minLeft = availableLeft + 10
      const maxLeft = availableRight - toolbar.clientWidth - 10
      const requestedLeft = range.minX * scale
      const left = maxLeft < minLeft ? minLeft : Math.min(Math.max(requestedLeft, minLeft), maxLeft)
      const bottomTop = range.maxY * scale + 10
      const topPlacement = stageRect.height && bottomTop + 40 > availableBottom
      const rotateGap = element.type === 'shape' ? 40 : 10
      const requestedTop = topPlacement ? range.minY * scale - rotateGap - 40 : bottomTop
      const top = Math.max(availableTop + 10, requestedTop)
      setPosition(current => current?.left === left && current.top === top ? current : { left, top })
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(toolbar)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [element, frameRef, scale, stageRef])

  const updateShape = (props: Partial<PPTShapeElement>) => runtime.commit('Update shape from floating toolbar', [{ type: 'element.update', payload: { id: element.id, props } }], { historyKey: `shape-floating-${element.id}` })
  const updateShapeOutline = (props: Partial<NonNullable<PPTShapeElement['outline']>>) => {
    if (element.type !== 'shape') return
    // Vue keeps the border popover open across style/color/width edits so a
    // multi-digit width can be typed in one session.
    updateShape({ outline: { ...(element.outline || presentation.theme.outline), ...props } })
  }
  const updateLine = (props: Partial<PPTLineElement>) => runtime.commit('Update line from floating toolbar', [{ type: 'element.update', payload: { id: element.id, props } }], { historyKey: `line-floating-${element.id}` })

  return (
    <div className={`mona-floating-toolbar mona-floating-${element.type}-toolbar`} onPointerDown={event => event.stopPropagation()} ref={toolbarRef} style={position || { visibility: 'hidden' }}>
      <div className="mona-floating-toolbar-content">
        {element.type === 'shape' ? (
          <>
            <InspectorPopoverButton
              ariaLabel={t('foundation.editor.shape.fillColor')}
              className="mona-floating-toolbar-button is-labeled"
              onOpenChange={open => {
                setFillOpen(open)
                if (open) setBorderOpen(false)
              }}
              open={fillOpen}
              content={<EditorColorPicker onChange={fill => runtime.commit('Set solid shape fill', [
                { type: 'element.properties.remove', payload: { id: element.id, property: ['gradient', 'pattern'] } },
                { type: 'element.update', payload: { id: element.id, props: { fill } } },
              ], { historyKey: `shape-floating-${element.id}` })} value={element.fill || '#fff'} />}
            ><FillIcon /><span>{t('foundation.editor.shape.fill')}</span></InspectorPopoverButton>
            <InspectorPopoverButton
              ariaLabel={t('foundation.editor.shape.border')}
              asDiv
              className="mona-floating-toolbar-button is-labeled is-border"
              onOpenChange={open => {
                setBorderOpen(open)
                if (open) setFillOpen(false)
              }}
              open={borderOpen}
              content={(
                <div className="mona-floating-border-panel">
                  <PropertyRow label={t('foundation.editor.text.borderStyle')}>
                    <InspectorSelect<LineStyleType> ariaLabel={t('foundation.editor.text.borderStyle')} onChange={style => updateShapeOutline({ style })} options={lineStyleOptions} renderLabel={option => <LinePreview type={option?.value || 'solid'} />} renderOption={option => <LinePreview type={option.value} />} value={element.outline?.style || 'solid'} />
                  </PropertyRow>
                  <PropertyRow label={t('foundation.editor.text.borderColor')}><InspectorColorButton ariaLabel={t('foundation.editor.text.borderColor')} color={element.outline?.color || '#000'} onChange={color => updateShapeOutline({ color })} /></PropertyRow>
                  <PropertyRow label={t('foundation.editor.text.borderWidth')}><InspectorNumberInput ariaLabel={t('foundation.editor.text.borderWidth')} onChange={width => updateShapeOutline({ width })} value={element.outline?.width || 0} /></PropertyRow>
                </div>
              )}
            ><SelectedIcon /><span>{t('foundation.editor.shape.border')}</span></InspectorPopoverButton>
            {element.text?.content ? (
              <>
                <div className="mona-floating-divider" />
                <EditorFloatingRichTextControls elementId={element.id} runtime={runtime} />
              </>
            ) : null}
          </>
        ) : (
          <>
            <InspectorPopoverButton
              active={false}
              ariaLabel={t('foundation.editor.line.styleLabel')}
              className="mona-floating-toolbar-button is-labeled"
              onOpenChange={open => {
                setLineStyleOpen(open)
                if (open) setLineColorOpen(false)
              }}
              open={lineStyleOpen}
              content={(
                <div className="mona-floating-line-style-list">
                  {lineStyleOptions.map(option => <button className={element.style === option.value ? 'is-active' : ''} key={option.value} onClick={() => updateLine({ style: option.value })} type="button"><LinePreview type={option.value} /></button>)}
                </div>
              )}
            ><ConnectionIcon /><span>{t('foundation.editor.line.styleLabel')}</span></InspectorPopoverButton>
            <InspectorPopoverButton
              ariaLabel={t('foundation.editor.line.colorLabel')}
              className="mona-floating-toolbar-button is-labeled"
              onOpenChange={open => {
                setLineColorOpen(open)
                if (open) setLineStyleOpen(false)
              }}
              open={lineColorOpen}
              content={<EditorColorPicker onChange={color => updateLine({ color })} value={element.color} />}
            ><PaletteIcon /><span>{t('foundation.editor.line.colorLabel')}</span></InspectorPopoverButton>
            <div className="mona-floating-line-width"><InspectorSlider ariaLabel={t('foundation.editor.line.width')} max={12} min={1} onChange={width => updateLine({ width })} value={element.width} /></div>
          </>
        )}
      </div>
    </div>
  )
}
