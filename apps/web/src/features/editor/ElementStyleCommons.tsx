import { useId, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import FlipHorizontalIcon from '~icons/icon-park-outline/flip-horizontally'
import FlipVerticalIcon from '~icons/icon-park-outline/flip-vertically'
import type { PresentationState } from '@mona/presentation-core'
import type {
  LinePoint,
  LineStyleType,
  PPTElement,
  PPTElementOutline,
  PPTElementShadow,
} from '@mona/presentation-core/model'

import {
  InspectorButton,
  InspectorButtonGroup,
  InspectorColorButton,
  InspectorNumberInput,
  InspectorSelect,
  InspectorSlider,
  InspectorSwitch,
  inspectorRowClass,
} from '@/features/editor/EditorInspectorPrimitives'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { lineStyleOptions } from '@/features/editor/editor-style-options'

export function PropertyRow({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className={inspectorRowClass}>
      <div className="w-[48%] text-xs">{label}</div>
      <div className="w-[52%] [&>*]:w-full">{children}</div>
    </div>
  )
}

export function LinePointMarker({
  baseSize,
  color = '#333',
  id,
  position,
  preview = false,
  type,
}: {
  baseSize: number
  color?: string
  id: string
  position: 'end' | 'start'
  preview?: boolean
  type: Exclude<LinePoint, ''>
}) {
  const size = Math.max(baseSize, 2)
  const rotate = type === 'arrow' && position === 'start' ? 180 : 0
  const refX = preview ? size * 1.5 : position === 'start' ? 0 : size * 3
  return (
    <marker
      id={`${id}-${type}-${position}`}
      markerHeight={size * 3}
      markerUnits="userSpaceOnUse"
      markerWidth={size * 3}
      orient="auto"
      refX={refX}
      refY={size * 1.5}
    >
      <path
        d={type === 'dot' ? 'm0 5a5 5 0 1 0 10 0a5 5 0 1 0 -10 0z' : 'M0,0 L10,5 0,10 Z'}
        fill={color}
        transform={`scale(${size * 0.3}, ${size * 0.3}) rotate(${rotate}, 5, 5)`}
      />
    </marker>
  )
}

export function LinePreview({
  color = '#333',
  markers,
  padding = 0,
  type = 'solid',
  width = 2,
}: {
  color?: string
  markers?: [LinePoint, LinePoint]
  padding?: number
  type?: LineStyleType
  width?: number
}) {
  const uniqueId = useId().replaceAll(':', '')
  const id = `mona-line-preview-${uniqueId}-${type}-${markers?.[0] || 'none'}-${markers?.[1] || 'none'}`
  const dashArray = type === 'dashed'
    ? width <= 8 ? `${width * 5} ${width * 2.5}` : `${width * 5} ${width * 1.5}`
    : type === 'dotted'
      ? width <= 8 ? `${width * 1.8} ${width * 1.6}` : `${width * 1.5} ${width * 1.2}`
      : '0 0'
  return (
    <svg aria-hidden="true" className="mona-line-style-preview" height="100%" viewBox="0 0 100 10" width="100%">
      <defs>
        {markers?.[0] ? <LinePointMarker baseSize={width} color={color} id={id} position="start" preview type={markers[0]} /> : null}
        {markers?.[1] ? <LinePointMarker baseSize={width} color={color} id={id} position="end" preview type={markers[1]} /> : null}
      </defs>
      <line
        markerEnd={markers?.[1] ? `url(#${id}-${markers[1]}-end)` : undefined}
        markerStart={markers?.[0] ? `url(#${id}-${markers[0]}-start)` : undefined}
        stroke={color}
        strokeDasharray={dashArray}
        strokeWidth={width}
        x1={padding}
        x2={100 - padding}
        y1="5"
        y2="5"
      />
    </svg>
  )
}

function commitUpdate(runtime: EditorRuntime, element: PPTElement, props: Partial<PPTElement>, historyKey: string) {
  return runtime.commit('Update element style', [{ type: 'element.update', payload: { id: element.id, props } }], { historyKey })
}

function commitRemove(runtime: EditorRuntime, element: PPTElement, property: string | string[], historyKey: string) {
  return runtime.commit('Remove element style', [{ type: 'element.properties.remove', payload: { id: element.id, property } }], { historyKey })
}

export function ElementFlipControls({
  element,
  runtime,
}: {
  element: Extract<PPTElement, { type: 'image' | 'shape' }>
  runtime: EditorRuntime
}) {
  const { t } = useTranslation()
  return (
    <InspectorButtonGroup className={`${inspectorRowClass} mona-panel-flip-group`}>
      <InspectorButton active={Boolean(element.flipV)} ariaLabel={t('foundation.editor.shape.verticalFlip')} onClick={() => commitUpdate(runtime, element, { flipV: !element.flipV }, `element-flip-${element.id}`)} style={{ flex: 1 }}><FlipVerticalIcon /> {t('foundation.editor.shape.verticalFlip')}</InspectorButton>
      <InspectorButton active={Boolean(element.flipH)} ariaLabel={t('foundation.editor.shape.horizontalFlip')} onClick={() => commitUpdate(runtime, element, { flipH: !element.flipH }, `element-flip-${element.id}`)} style={{ flex: 1 }}><FlipHorizontalIcon /> {t('foundation.editor.shape.horizontalFlip')}</InspectorButton>
    </InspectorButtonGroup>
  )
}

export function ElementOutlineControls({
  element,
  fixed = false,
  presentation,
  runtime,
}: {
  element: PPTElement & { outline?: PPTElementOutline }
  fixed?: boolean
  presentation: PresentationState
  runtime: EditorRuntime
}) {
  const { t } = useTranslation()
  const update = (props: Partial<PPTElementOutline>) => commitUpdate(
    runtime,
    element,
    { outline: { ...(element.outline || presentation.theme.outline), ...props } } as Partial<PPTElement>,
    `element-outline-${element.id}`,
  )
  return (
    <div className="mona-element-outline-controls">
      {!fixed ? (
        <PropertyRow label={t('foundation.editor.text.enableBorder')}>
          <div className="w-full text-right">
            <InspectorSwitch ariaLabel={t('foundation.editor.text.enableBorder')} checked={Boolean(element.outline)} onChange={checked => checked
              ? commitUpdate(runtime, element, { outline: presentation.theme.outline } as Partial<PPTElement>, `element-outline-${element.id}`)
              : commitRemove(runtime, element, 'outline', `element-outline-${element.id}`)} />
          </div>
        </PropertyRow>
      ) : null}
      {element.outline ? (
        <>
          <PropertyRow label={t('foundation.editor.text.borderStyle')}>
            <InspectorSelect<LineStyleType> ariaLabel={t('foundation.editor.text.borderStyle')} onChange={value => update({ style: value })} options={lineStyleOptions} renderLabel={option => <LinePreview type={option?.value || 'solid'} />} renderOption={option => <LinePreview type={option.value} />} value={element.outline.style || 'solid'} />
          </PropertyRow>
          <PropertyRow label={t('foundation.editor.text.borderColor')}><InspectorColorButton ariaLabel={t('foundation.editor.text.borderColor')} color={element.outline.color || '#000'} onChange={value => update({ color: value })} /></PropertyRow>
          <PropertyRow label={t('foundation.editor.text.borderWidth')}><InspectorNumberInput ariaLabel={t('foundation.editor.text.borderWidth')} min={0} onChange={value => update({ width: value })} value={element.outline.width || 0} /></PropertyRow>
        </>
      ) : null}
    </div>
  )
}

export function ElementShadowControls({
  element,
  presentation,
  runtime,
}: {
  element: PPTElement & { shadow?: PPTElementShadow }
  presentation: PresentationState
  runtime: EditorRuntime
}) {
  const { t } = useTranslation()
  const update = (props: Partial<PPTElementShadow>) => {
    if (!element.shadow) return false
    return commitUpdate(runtime, element, { shadow: { ...element.shadow, ...props } } as Partial<PPTElement>, `element-shadow-${element.id}`)
  }
  return (
    <div className="mona-element-shadow-controls">
      <PropertyRow label={t('foundation.editor.text.enableShadow')}>
        <div className="w-full text-right"><InspectorSwitch ariaLabel={t('foundation.editor.text.enableShadow')} checked={Boolean(element.shadow)} onChange={checked => checked
          ? commitUpdate(runtime, element, { shadow: presentation.theme.shadow } as Partial<PPTElement>, `element-shadow-${element.id}`)
          : commitRemove(runtime, element, 'shadow', `element-shadow-${element.id}`)} /></div>
      </PropertyRow>
      {element.shadow ? (
        <>
          <PropertyRow label={t('foundation.editor.text.shadowHorizontal')}><InspectorSlider ariaLabel={t('foundation.editor.text.shadowHorizontal')} max={20} min={-20} onChange={value => update({ h: value })} value={element.shadow.h} /></PropertyRow>
          <PropertyRow label={t('foundation.editor.text.shadowVertical')}><InspectorSlider ariaLabel={t('foundation.editor.text.shadowVertical')} max={20} min={-20} onChange={value => update({ v: value })} value={element.shadow.v} /></PropertyRow>
          <PropertyRow label={t('foundation.editor.text.shadowBlur')}><InspectorSlider ariaLabel={t('foundation.editor.text.shadowBlur')} max={30} min={1} onChange={value => update({ blur: value })} value={element.shadow.blur} /></PropertyRow>
          <PropertyRow label={t('foundation.editor.text.shadowColor')}><InspectorColorButton ariaLabel={t('foundation.editor.text.shadowColor')} color={element.shadow.color} onChange={value => update({ color: value })} /></PropertyRow>
        </>
      ) : null}
    </div>
  )
}

export function ElementOpacityControl({
  element,
  runtime,
}: {
  element: PPTElement & { opacity?: number }
  runtime: EditorRuntime
}) {
  const { t } = useTranslation()
  return (
    <PropertyRow label={t('foundation.editor.text.opacity')}>
      <InspectorSlider ariaLabel={t('foundation.editor.text.opacity')} max={1} min={0} onChange={value => commitUpdate(runtime, element, { opacity: value } as Partial<PPTElement>, `element-opacity-${element.id}`)} step={0.1} value={element.opacity === undefined ? 1 : element.opacity} />
    </PropertyRow>
  )
}
