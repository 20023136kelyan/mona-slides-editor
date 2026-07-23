import { useTranslation } from 'react-i18next'

import DownIcon from '~icons/icon-park-outline/down'
import SwitchIcon from '~icons/icon-park-outline/switch'
import type { PresentationState } from '@mona/presentation-core'
import type { Broken2LineDirection, LinePoint, LineStyleType, PPTLineElement } from '@mona/presentation-core/model'

import { Button } from '@/components/ui/button'
import {
  InspectorButton,
  InspectorColorButton,
  InspectorNumberInput,
  InspectorSelect,
} from '@/features/editor/EditorInspectorPrimitives'
import {
  ElementShadowControls,
  LinePointMarker,
  LinePreview,
  PropertyRow,
} from '@/features/editor/ElementStyleCommons'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { lineStyleOptions } from '@/features/editor/editor-style-options'

const markerOptions: Array<{ label: string; value: LinePoint }> = [
  { label: 'None', value: '' },
  { label: 'Arrow', value: 'arrow' },
  { label: 'Dot', value: 'dot' },
]

interface LineTypeOption {
  isBroken?: boolean
  isBroken2?: boolean
  isCubic?: boolean
  isCurve?: boolean
  key: string
  path: string
}

const lineTypeOptions: LineTypeOption[] = [
  { key: 'straight', path: 'M 2 2 L 22 22' },
  { key: 'broken', path: 'M 2 2 L 2 22 L 22 22', isBroken: true },
  { key: 'broken2', path: 'M 2 2 L 12 2 L 12 22 L 22 22', isBroken2: true },
  { key: 'curve', path: 'M 2 2 Q 2 22 22 22', isCurve: true },
  { key: 'cubic', path: 'M 2 2 C 22 2 2 22 22 22', isCubic: true },
]

function LineTypeThumbnail({ element, item, onSelect }: { element: PPTLineElement; item: LineTypeOption; onSelect: () => void }) {
  const id = `mona-replace-line-${item.key}`
  return (
    <Button aria-label={`Replace with ${item.key} line`} className="mona-line-type-item" onClick={onSelect} size="editor-icon" type="button" variant="ghost">
      <svg height="24" overflow="visible" width="24">
        <defs>
          {element.points[0] ? <LinePointMarker baseSize={2} color="currentColor" id={id} position="start" preview type={element.points[0]} /> : null}
          {element.points[1] ? <LinePointMarker baseSize={2} color="currentColor" id={id} position="end" preview type={element.points[1]} /> : null}
        </defs>
        <path
          d={item.path}
          fill="none"
          markerEnd={element.points[1] ? `url(#${id}-${element.points[1]}-end)` : undefined}
          markerStart={element.points[0] ? `url(#${id}-${element.points[0]}-start)` : undefined}
          stroke="currentColor"
          strokeDasharray={element.style === 'solid' ? '0, 0' : '4, 1'}
          strokeWidth="2"
        />
      </svg>
    </Button>
  )
}

export function LineStylePanel({
  element,
  presentation,
  runtime,
}: {
  element: PPTLineElement
  presentation: PresentationState
  runtime: EditorRuntime
}) {
  const { t } = useTranslation()
  const update = (props: Partial<PPTLineElement>, historyKey = `line-style-${element.id}`) => runtime.commit(
    'Update line style',
    [{ type: 'element.update', payload: { id: element.id, props } }],
    { historyKey },
  )
  const changeLineType = (item: LineTypeOption) => {
    const midpoint: [number, number] = [(element.start[0] + element.end[0]) / 2, (element.start[1] + element.end[1]) / 2]
    const property: string[] = ['broken', 'broken2', 'curve', 'cubic']
    if (!item.isBroken2) property.push('broken2Direction')
    const props: Partial<PPTLineElement> = {}
    if (item.isBroken) props.broken = midpoint
    if (item.isBroken2) props.broken2 = midpoint
    if (item.isCurve) props.curve = midpoint
    if (item.isCubic) props.cubic = [midpoint, midpoint]
    runtime.commit('Replace line type', [
      { type: 'element.properties.remove', payload: { id: element.id, property } },
      { type: 'element.update', payload: { id: element.id, props } },
    ], { historyKey: `line-replace-${element.id}` })
  }
  const directionOptions: Array<{ label: string; value: Broken2LineDirection | 'auto' }> = [
    { label: t('foundation.editor.line.auto'), value: 'auto' },
    { label: t('foundation.editor.line.horizontal'), value: 'horizontal' },
    { label: t('foundation.editor.line.vertical'), value: 'vertical' },
  ]
  return (
    <div className="mona-line-style-panel">
      <div className="mona-shape-panel-title"><span>{t('foundation.editor.line.replace')}</span><DownIcon /></div>
      <div className="mona-line-type-pool">
        {lineTypeOptions.map(item => <LineTypeThumbnail element={element} item={item} key={item.key} onSelect={() => changeLineType(item)} />)}
      </div>
      <PropertyRow label={t('foundation.editor.line.style')}>
        <InspectorSelect<LineStyleType> ariaLabel={t('foundation.editor.line.style')} onChange={style => update({ style })} options={lineStyleOptions} renderLabel={option => <LinePreview type={option?.value || 'solid'} />} renderOption={option => <LinePreview type={option.value} />} value={element.style} />
      </PropertyRow>
      <PropertyRow label={t('foundation.editor.line.color')}><InspectorColorButton ariaLabel={t('foundation.editor.line.color')} color={element.color} onChange={color => update({ color })} /></PropertyRow>
      <PropertyRow label={t('foundation.editor.line.width')}><InspectorNumberInput ariaLabel={t('foundation.editor.line.width')} onChange={width => update({ width })} value={element.width} /></PropertyRow>
      <PropertyRow label={t('foundation.editor.line.startMarker')}>
        <InspectorSelect<LinePoint> ariaLabel={t('foundation.editor.line.startMarker')} onChange={marker => update({ points: [marker, element.points[1]] })} options={markerOptions} renderLabel={option => <LinePreview markers={[option?.value || '', '']} padding={5} />} renderOption={option => <LinePreview markers={[option.value, '']} padding={5} />} value={element.points[0]} />
      </PropertyRow>
      <PropertyRow label={t('foundation.editor.line.endMarker')}>
        <InspectorSelect<LinePoint> ariaLabel={t('foundation.editor.line.endMarker')} onChange={marker => update({ points: [element.points[0], marker] })} options={markerOptions} renderLabel={option => <LinePreview markers={['', option?.value || '']} padding={5} />} renderOption={option => <LinePreview markers={['', option.value]} padding={5} />} value={element.points[1]} />
      </PropertyRow>
      {element.broken2 ? (
        <PropertyRow label={t('foundation.editor.line.direction')}>
          <InspectorSelect<Broken2LineDirection | 'auto'> ariaLabel={t('foundation.editor.line.direction')} onChange={direction => direction === 'auto'
            ? runtime.commit('Use automatic line direction', [{ type: 'element.properties.remove', payload: { id: element.id, property: 'broken2Direction' } }], { historyKey: `line-style-${element.id}` })
            : update({ broken2Direction: direction })} options={directionOptions} value={element.broken2Direction || 'auto'} />
        </PropertyRow>
      ) : null}
      <div className="mona-panel-divider" />
      <InspectorButton ariaLabel={t('foundation.editor.line.swap')} onClick={() => update({ start: element.end, end: element.start }, `line-swap-${element.id}`)} style={{ width: '100%' }}><SwitchIcon /> {t('foundation.editor.line.swap')}</InspectorButton>
      <div className="mona-panel-divider" />
      <ElementShadowControls element={element} presentation={presentation} runtime={runtime} />
    </div>
  )
}
