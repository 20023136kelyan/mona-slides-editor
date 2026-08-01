import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import ConnectionIcon from '~icons/icon-park-outline/connection'
import FillIcon from '~icons/icon-park-outline/fill'
import FlipHorizontalIcon from '~icons/icon-park-outline/flip-horizontally'
import FlipVerticalIcon from '~icons/icon-park-outline/flip-vertically'
import PaletteIcon from '~icons/icon-park-outline/platte'
import SelectedIcon from '~icons/icon-park-outline/selected'
import SwitchIcon from '~icons/icon-park-outline/switch'
import { Blend } from 'lucide-react'
import type { PresentationState } from '@mona/presentation-core'
import type {
  LinePoint,
  LineStyleType,
  PPTLineElement,
  PPTShapeElement,
} from '@mona/presentation-core/model'

import { Button } from '@/components/ui/button'
import { Toggle } from '@/components/ui/toggle'
import { EditorColorPicker } from '@/features/editor/EditorColorPicker'
import {
  InspectorColorButton,
  InspectorNumberInput,
  InspectorPopoverButton,
  InspectorSelect,
  InspectorSlider,
} from '@/features/editor/EditorInspectorPrimitives'
import { LinePreview, PropertyRow } from '@/features/editor/ElementStyleCommons'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { lineStyleOptions } from '@/features/editor/editor-style-options'
import {
  contextualBorderPanel,
  contextualControlIcon,
  contextualControlLabeled,
  contextualControlLabeledBorder,
  contextualControlRow,
  contextualControlsShell,
  contextualDivider,
  contextualGhostSelect,
  contextualLineStyleItem,
  contextualLineStyleItemActive,
  contextualLineStyleList,
  contextualLineWidth,
  contextualToggleFlat,
  contextualTransparencyPopover,
} from '@/features/editor/contextual/contextual-control-styles'
import { cn } from '@/lib/utils'
import { EditorRichTextContextControls } from '@/features/editor/contextual/EditorTextContextControls'

const markerOptions: Array<{ label: string; value: LinePoint }> = [
  { label: 'None', value: '' },
  { label: 'Arrow', value: 'arrow' },
  { label: 'Dot', value: 'dot' },
]

function ShapeControls({
  element,
  presentation,
  runtime,
}: {
  element: PPTShapeElement
  presentation: PresentationState
  runtime: EditorRuntime
}) {
  const { t } = useTranslation()
  const [borderOpen, setBorderOpen] = useState(false)
  const [fillOpen, setFillOpen] = useState(false)
  const transparency = Math.round((1 - (element.opacity ?? 1)) * 100)
  const update = (props: Partial<PPTShapeElement>, historyKey = `shape-contextual-${element.id}`) => runtime.commit(
    'Update shape',
    [{ type: 'element.update', payload: { id: element.id, props } }],
    { historyKey },
  )
  const updateOutline = (props: Partial<NonNullable<PPTShapeElement['outline']>>) => update({
    outline: { ...(element.outline || presentation.theme.outline), ...props },
  })

  return (
    <>
      <InspectorPopoverButton
        ariaLabel={t('foundation.editor.shape.fillColor')}
        className={contextualControlLabeled}
        content={<EditorColorPicker onChange={fill => runtime.commit('Set solid shape fill', [
          { type: 'element.properties.remove', payload: { id: element.id, property: ['gradient', 'pattern'] } },
          { type: 'element.update', payload: { id: element.id, props: { fill } } },
        ], { historyKey: `shape-fill-${element.id}` })} value={element.fill || '#fff'} />}
        onOpenChange={open => {
          setFillOpen(open)
          if (open) setBorderOpen(false)
        }}
        open={fillOpen}
      ><FillIcon /><span>{t('foundation.editor.shape.fill')}</span></InspectorPopoverButton>
      <InspectorPopoverButton
        ariaLabel={t('foundation.editor.shape.border')}
        className={contextualControlLabeledBorder}
        content={(
          <div className={contextualBorderPanel}>
            <PropertyRow label={t('foundation.editor.text.borderStyle')}>
              <InspectorSelect<LineStyleType>
                ariaLabel={t('foundation.editor.text.borderStyle')}
                onChange={style => updateOutline({ style })}
                options={lineStyleOptions}
                renderLabel={option => <LinePreview type={option?.value || 'solid'} />}
                renderOption={option => <LinePreview type={option.value} />}
                value={element.outline?.style || 'solid'}
              />
            </PropertyRow>
            <PropertyRow label={t('foundation.editor.text.borderColor')}><InspectorColorButton ariaLabel={t('foundation.editor.text.borderColor')} color={element.outline?.color || '#000'} onChange={color => updateOutline({ color })} /></PropertyRow>
            <PropertyRow label={t('foundation.editor.text.borderWidth')}><InspectorNumberInput ariaLabel={t('foundation.editor.text.borderWidth')} onChange={width => updateOutline({ width })} value={element.outline?.width || 0} /></PropertyRow>
          </div>
        )}
        onOpenChange={open => {
          setBorderOpen(open)
          if (open) setFillOpen(false)
        }}
        open={borderOpen}
      ><SelectedIcon /><span>{t('foundation.editor.shape.border')}</span></InspectorPopoverButton>
      <div className={contextualDivider} />
      <Toggle aria-label={t('foundation.editor.shape.horizontalFlip')} className={`${contextualControlIcon} ${contextualToggleFlat}`} onPressedChange={() => update({ flipH: !element.flipH }, `shape-flip-${element.id}`)} pressed={Boolean(element.flipH)}><FlipHorizontalIcon /></Toggle>
      <Toggle aria-label={t('foundation.editor.shape.verticalFlip')} className={`${contextualControlIcon} ${contextualToggleFlat}`} onPressedChange={() => update({ flipV: !element.flipV }, `shape-flip-${element.id}`)} pressed={Boolean(element.flipV)}><FlipVerticalIcon /></Toggle>
      <InspectorPopoverButton
        ariaLabel={t('foundation.editor.contextual.transparencyLabel')}
        className={contextualControlLabeled}
        content={(
          <div className={contextualTransparencyPopover}>
            <span>{transparency}%</span>
            <InspectorSlider ariaLabel={t('foundation.editor.contextual.transparencyLabel')} max={100} min={0} onChange={value => update({ opacity: 1 - value / 100 }, `shape-transparency-${element.id}`)} value={transparency} />
          </div>
        )}
      ><Blend /><span>{t('foundation.editor.contextual.transparencyLabel')}</span></InspectorPopoverButton>
      {element.text?.content ? (
        <>
          <div className={contextualDivider} />
          <EditorRichTextContextControls elementId={element.id} runtime={runtime} />
        </>
      ) : null}
    </>
  )
}

function LineControls({
  element,
  runtime,
}: {
  element: PPTLineElement
  runtime: EditorRuntime
}) {
  const { t } = useTranslation()
  const [lineColorOpen, setLineColorOpen] = useState(false)
  const [lineStyleOpen, setLineStyleOpen] = useState(false)
  const update = (props: Partial<PPTLineElement>, historyKey = `line-contextual-${element.id}`) => runtime.commit(
    'Update line',
    [{ type: 'element.update', payload: { id: element.id, props } }],
    { historyKey },
  )

  return (
    <>
      <InspectorPopoverButton
        ariaLabel={t('foundation.editor.line.styleLabel')}
        className={contextualControlLabeled}
        content={(
          <div className={contextualLineStyleList}>
            {lineStyleOptions.map(option => (
              <Button
                aria-pressed={element.style === option.value}
                className={cn(contextualLineStyleItem, element.style === option.value && contextualLineStyleItemActive)}
                key={option.value}
                onClick={() => update({ style: option.value })}
                size="editor"
                type="button"
                variant="ghost"
              >
                <LinePreview type={option.value} />
              </Button>
            ))}
          </div>
        )}
        onOpenChange={open => {
          setLineStyleOpen(open)
          if (open) setLineColorOpen(false)
        }}
        open={lineStyleOpen}
      ><ConnectionIcon /><span>{t('foundation.editor.line.styleLabel')}</span></InspectorPopoverButton>
      <InspectorPopoverButton
        ariaLabel={t('foundation.editor.line.colorLabel')}
        className={contextualControlLabeled}
        content={<EditorColorPicker onChange={color => update({ color })} value={element.color} />}
        onOpenChange={open => {
          setLineColorOpen(open)
          if (open) setLineStyleOpen(false)
        }}
        open={lineColorOpen}
      ><PaletteIcon /><span>{t('foundation.editor.line.colorLabel')}</span></InspectorPopoverButton>
      <div className={contextualLineWidth}><InspectorSlider ariaLabel={t('foundation.editor.line.width')} max={12} min={1} onChange={width => update({ width })} value={element.width} /></div>
      <div className={contextualDivider} />
      <InspectorSelect<LinePoint>
        ariaLabel={t('foundation.editor.line.startMarker')}
        className={contextualGhostSelect}
        onChange={marker => update({ points: [marker, element.points[1]] })}
        options={markerOptions}
        renderLabel={option => <LinePreview markers={[option?.value || '', '']} padding={5} />}
        renderOption={option => <LinePreview markers={[option.value, '']} padding={5} />}
        value={element.points[0]}
      />
      <Button aria-label={t('foundation.editor.line.swap')} className={contextualControlIcon} onClick={() => update({
        connections: {
          ...(element.connections?.end ? { start: element.connections.end } : {}),
          ...(element.connections?.start ? { end: element.connections.start } : {}),
        },
        end: element.start,
        start: element.end,
      }, `line-swap-${element.id}`)} size="editor-icon" title={t('foundation.editor.line.swap')} type="button" variant="ghost"><SwitchIcon /></Button>
      <InspectorSelect<LinePoint>
        ariaLabel={t('foundation.editor.line.endMarker')}
        className={contextualGhostSelect}
        onChange={marker => update({ points: [element.points[0], marker] })}
        options={markerOptions}
        renderLabel={option => <LinePreview markers={['', option?.value || '']} padding={5} />}
        renderOption={option => <LinePreview markers={['', option.value]} padding={5} />}
        value={element.points[1]}
      />
    </>
  )
}

export function EditorShapeLineContextControls({
  element,
  presentation,
  runtime,
}: {
  element: PPTLineElement | PPTShapeElement
  presentation: PresentationState
  runtime: EditorRuntime
}) {
  return (
    <div className={cn(`mona-contextual-${element.type}-controls`, contextualControlsShell)}>
      <div className={contextualControlRow}>
        {element.type === 'shape'
          ? <ShapeControls element={element} presentation={presentation} runtime={runtime} />
          : <LineControls element={element} runtime={runtime} />}
      </div>
    </div>
  )
}
