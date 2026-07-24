import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { BetweenHorizontalEnd, Blend, Bold, Italic, Layers3, Minus, Move, Plus, Sparkles, Strikethrough, SwatchBook, Type } from 'lucide-react'

import FlipHorizontalIcon from '~icons/icon-park-outline/flip-horizontally'
import FlipVerticalIcon from '~icons/icon-park-outline/flip-vertically'
import type { EditorToolbarState } from '@mona/editor-state'
import type { PresentationState } from '@mona/presentation-core'
import type {
  PPTElement,
  PPTImageElement,
  PPTLatexElement,
  PPTLineElement,
  PPTShapeElement,
  PPTTableElement,
  PPTTextElement,
  PPTChartElement,
  PPTAudioElement,
  PPTVideoElement,
  Slide,
  TableCell,
} from '@mona/presentation-core/model'
import type { RichTextAction } from '@mona/rich-text'

import { Button } from '@/components/ui/button'
import { Toggle } from '@/components/ui/toggle'
import { EditorColorPicker } from '@/features/editor/EditorColorPicker'
import { InspectorPopoverButton, InspectorSelect, InspectorSlider } from '@/features/editor/EditorInspectorPrimitives'
import { EditorChartContextControls } from '@/features/editor/contextual/EditorChartContextControls'
import { EditorEquationContextControls } from '@/features/editor/contextual/EditorEquationContextControls'
import { EditorImageContextControls } from '@/features/editor/contextual/EditorImageContextControls'
import { EditorMediaContextControls } from '@/features/editor/contextual/EditorMediaContextControls'
import { EditorShapeLineContextControls } from '@/features/editor/contextual/EditorShapeLineContextControls'
import { EditorTableContextControls } from '@/features/editor/contextual/EditorTableContextControls'
import { EditorTextContextControls } from '@/features/editor/contextual/EditorTextContextControls'
import {
  contextualAction,
  contextualChildBadge,
  contextualControlIcon,
  contextualControlLabeled,
  contextualControlRow,
  contextualControlsShell,
  contextualControlTextColor,
  contextualDeepActions,
  contextualDivider,
  contextualGhostSelect,
  contextualSelectionLabel,
  contextualTextColorBar,
  contextualToggleFlat,
  contextualTransparencyPopover,
} from '@/features/editor/contextual/contextual-control-styles'
import { cn } from '@/lib/utils'
import type {
  ContextualSelectionKind,
  ElementCapabilityKind,
  SelectionCapabilities,
} from '@/features/editor/contextual/resolve-selection-capabilities'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { editorFontOptions } from '@/features/editor/editor-text-options'

export interface ContextualControlRegistryContext {
  capabilities: SelectionCapabilities
  currentSlide: Slide
  onEditChart: (id: string) => void
  onEditLatex: (id: string) => void
  onOpenInspector: (state: EditorToolbarState) => void
  presentation: PresentationState
  runtime: EditorRuntime
  selectedCells: readonly string[]
}

function ContextAction({
  children,
  icon,
  onClick,
}: {
  children: string
  icon: ReactNode
  onClick: () => void
}) {
  return (
    <Button aria-label={children} className={contextualAction} onClick={onClick} size="editor" title={children} type="button" variant="ghost">
      {icon}
      <span>{children}</span>
    </Button>
  )
}

const targetAs = <T extends PPTElement>(context: ContextualControlRegistryContext) => context.capabilities.targetElement as T

const elementControlRegistry: Record<ElementCapabilityKind, (context: ContextualControlRegistryContext) => ReactNode> = {
  text: context => <EditorTextContextControls element={targetAs<PPTTextElement>(context)} runtime={context.runtime} />,
  shape: context => <EditorShapeLineContextControls element={targetAs<PPTShapeElement>(context)} presentation={context.presentation} runtime={context.runtime} />,
  line: context => <EditorShapeLineContextControls element={targetAs<PPTLineElement>(context)} presentation={context.presentation} runtime={context.runtime} />,
  image: context => <EditorImageContextControls element={targetAs<PPTImageElement>(context)} runtime={context.runtime} />,
  table: context => <EditorTableContextControls element={targetAs<PPTTableElement>(context)} presentation={context.presentation} runtime={context.runtime} selectedCells={context.selectedCells} />,
  chart: context => <EditorChartContextControls element={targetAs<PPTChartElement>(context)} onEditData={() => context.onEditChart(targetAs<PPTChartElement>(context).id)} runtime={context.runtime} />,
  equation: context => <EditorEquationContextControls element={targetAs<PPTLatexElement>(context)} onEdit={() => context.onEditLatex(targetAs<PPTLatexElement>(context).id)} runtime={context.runtime} />,
  media: context => <EditorMediaContextControls element={targetAs<PPTAudioElement | PPTVideoElement>(context)} runtime={context.runtime} />,
  'native-group': () => null,
  opaque: () => null,
}

function GroupChildControls({ context }: { context: ContextualControlRegistryContext }) {
  const { t } = useTranslation()
  return (
    <>
      <span className={cn('mona-contextual-child-badge', contextualChildBadge)}>{t('foundation.editor.contextual.groupChild')}</span>
      {context.capabilities.targetKind ? elementControlRegistry[context.capabilities.targetKind](context) : null}
    </>
  )
}

const cloneTableData = (data: readonly (readonly TableCell[])[]): TableCell[][] => structuredClone(data) as TableCell[][]

function EditorMultiContextControls({ capabilities, presentation, runtime }: Pick<
  ContextualControlRegistryContext,
  'capabilities' | 'presentation' | 'runtime'
>) {
  const { t } = useTranslation()
  const apply = (label: string, build: (element: PPTElement) => Partial<PPTElement> | undefined) => {
    const commands = capabilities.selectedElements.flatMap(element => {
      const props = build(element)
      return props ? [{ type: 'element.update' as const, payload: { id: element.id, props } }] : []
    })
    runtime.commit(label, commands, { historyKey: `contextual-multi-${label}` })
  }
  const updateFill = (fill: string) => apply('Update selection fill', element => {
    if (element.type === 'shape' || element.type === 'chart') return { fill }
    if (element.type === 'table') {
      const data = cloneTableData(element.data)
      for (const row of data) {
        for (const cell of row) cell.style = { ...cell.style, backcolor: fill }
      }
      return { data }
    }
    return undefined
  })
  const updateStroke = (color: string) => apply('Update selection stroke', element => {
    if (element.type === 'line') return { color }
    if ('outline' in element) return {
      outline: {
        ...(element.outline || presentation.theme.outline),
        color,
      },
    } as Partial<PPTElement>
    return undefined
  })
  const updateTransparency = (transparency: number) => apply('Update selection transparency', element => {
    if (element.type === 'image') return {
      filters: { ...element.filters, opacity: `${100 - transparency}%` },
    }
    if (element.type === 'shape' || element.type === 'text') return { opacity: 1 - transparency / 100 }
    return undefined
  })
  const updateFlip = (axis: 'flipH' | 'flipV') => {
    const next = capabilities.values[axis] !== true
    apply(`Update selection ${axis}`, element => (
      element.type === 'image' || element.type === 'shape' ? { [axis]: next } : undefined
    ))
  }
  const textElements = capabilities.selectedElements.filter(element => (
    element.type === 'text' || (element.type === 'shape' && Boolean(element.text?.content))
  ))
  const updateText = (action: RichTextAction) => {
    for (const element of textElements) {
      runtime.richText.execute(element.id, action, `contextual-multi-text-${element.id}`)
    }
  }
  const fill = capabilities.values.fill === 'mixed' ? '#ffffff' : capabilities.values.fill ?? '#ffffff'
  const stroke = capabilities.values.stroke === 'mixed' ? '#000000' : capabilities.values.stroke ?? '#000000'
  const transparency = capabilities.values.transparency === 'mixed' ? 0 : capabilities.values.transparency ?? 0
  const selectionLabel = capabilities.selectionKind === 'group'
    ? t('foundation.editor.contextual.groupSelection', { count: capabilities.selectedElements.length })
    : t('foundation.editor.contextual.mixedSelection', { count: capabilities.selectedElements.length })

  return (
    <div className={cn('mona-contextual-multi-controls', contextualControlsShell)}>
      <div className={contextualControlRow}>
        <span className={contextualSelectionLabel}><Layers3 />{selectionLabel}</span>
        {capabilities.canFill ? (
          <InspectorPopoverButton
            ariaLabel={t('foundation.editor.contextual.fill', { state: capabilities.values.fill === 'mixed' ? t('foundation.editor.contextual.mixed') : '' })}
            className={contextualControlLabeled}
            content={<EditorColorPicker onChange={updateFill} value={fill} />}
          >
            <span
              className="inline-block box-border size-4 flex-none rounded-control"
              data-mixed={capabilities.values.fill === 'mixed' || undefined}
              style={capabilities.values.fill === 'mixed'
                ? { background: 'linear-gradient(135deg, #fff 0 42%, #737780 42% 58%, #fff 58% 100%)', border: '1px solid #737780' }
                : { backgroundColor: fill, border: '1px solid rgb(16 18 25 / 35%)' }}
            />
            <span>{t('foundation.editor.contextual.fillLabel')}</span>
          </InspectorPopoverButton>
        ) : null}
        {capabilities.canStroke ? (
          <InspectorPopoverButton
            ariaLabel={t('foundation.editor.contextual.stroke', { state: capabilities.values.stroke === 'mixed' ? t('foundation.editor.contextual.mixed') : '' })}
            className={contextualControlLabeled}
            content={<EditorColorPicker onChange={updateStroke} value={stroke} />}
          >
            <span
              className="inline-block box-border size-4 flex-none rounded-control"
              data-mixed={capabilities.values.stroke === 'mixed' || undefined}
              style={capabilities.values.stroke === 'mixed'
                ? { background: 'linear-gradient(135deg, #fff 0 42%, #737780 42% 58%, #fff 58% 100%)', border: '3px solid #737780' }
                : { background: 'var(--background)', border: `3px solid ${stroke}` }}
            />
            <span>{t('foundation.editor.contextual.strokeLabel')}</span>
          </InspectorPopoverButton>
        ) : null}
        {capabilities.canTransparency ? (
          <InspectorPopoverButton
            ariaLabel={t('foundation.editor.contextual.transparency', { state: capabilities.values.transparency === 'mixed' ? t('foundation.editor.contextual.mixed') : '' })}
            className={contextualControlLabeled}
            content={(
              <div className={contextualTransparencyPopover}>
                <span>{capabilities.values.transparency === 'mixed' ? t('foundation.editor.contextual.mixed') : `${transparency}%`}</span>
                <InspectorSlider ariaLabel={t('foundation.editor.contextual.transparencyLabel')} max={100} min={0} onChange={updateTransparency} value={transparency} />
              </div>
            )}
          >
            <Blend /><span>{t('foundation.editor.contextual.transparencyLabel')}</span>
          </InspectorPopoverButton>
        ) : null}
        {capabilities.canFlip ? (
          <>
            <Toggle
              aria-label={t('foundation.editor.shape.horizontalFlip')}
              className={`${contextualControlIcon} ${contextualToggleFlat}`}
              data-mixed={capabilities.values.flipH === 'mixed' || undefined}
              onPressedChange={() => updateFlip('flipH')}
              pressed={capabilities.values.flipH === true}
            ><FlipHorizontalIcon /></Toggle>
            <Toggle
              aria-label={t('foundation.editor.shape.verticalFlip')}
              className={`${contextualControlIcon} ${contextualToggleFlat}`}
              data-mixed={capabilities.values.flipV === 'mixed' || undefined}
              onPressedChange={() => updateFlip('flipV')}
              pressed={capabilities.values.flipV === true}
            ><FlipVerticalIcon /></Toggle>
          </>
        ) : null}
        {capabilities.canEditText ? (
          <>
            <div className={contextualDivider} />
            <InspectorSelect
              ariaLabel={t('foundation.editor.text.fontFamily')}
              className={`${contextualGhostSelect} w-27.5 mr-px`}
              onChange={value => updateText({ command: 'fontname', value })}
              options={[
                ...(capabilities.values.fontFamily === 'mixed'
                  ? [{ disabled: true, label: t('foundation.editor.contextual.mixed'), value: '__mixed__' }]
                  : []),
                { label: t('common.defaultFont'), value: '' },
                ...editorFontOptions,
              ]}
              search
              searchLabel={t('foundation.editor.text.fontSearch')}
              value={capabilities.values.fontFamily === 'mixed' ? '__mixed__' : capabilities.values.fontFamily ?? ''}
            />
            <Button aria-label={t('foundation.editor.text.decreaseFont')} className={contextualControlIcon} onClick={() => updateText({ command: 'fontsize-reduce', value: '2' })} size="editor-icon" title={t('foundation.editor.text.decreaseFont')} type="button" variant="ghost"><Type /><Minus /></Button>
            <Button aria-label={t('foundation.editor.text.increaseFont')} className={contextualControlIcon} onClick={() => updateText({ command: 'fontsize-add', value: '2' })} size="editor-icon" title={t('foundation.editor.text.increaseFont')} type="button" variant="ghost"><Type /><Plus /></Button>
            <InspectorPopoverButton
              ariaLabel={t('foundation.editor.contextual.textColor', { state: capabilities.values.textColor === 'mixed' ? t('foundation.editor.contextual.mixed') : '' })}
              className={contextualControlTextColor}
              content={<EditorColorPicker onChange={value => updateText({ command: 'color', value })} value={capabilities.values.textColor === 'mixed' ? '#171717' : capabilities.values.textColor ?? '#171717'} />}
            >
              <Type />
              <span className={contextualTextColorBar}>
                <span style={{ backgroundColor: capabilities.values.textColor === 'mixed' ? 'transparent' : capabilities.values.textColor ?? '#171717' }} />
              </span>
            </InspectorPopoverButton>
            {([
              ['bold', Bold, 'bold'],
              ['em', Italic, 'italic'],
              ['strikethrough', Strikethrough, 'strikethrough'],
            ] as const).map(([command, CommandIcon, label]) => (
              <Button
                aria-label={t(`foundation.editor.text.${label}`)}
                className={contextualControlIcon}
                key={command}
                onClick={() => updateText({ command })}
                size="editor-icon"
                title={t(`foundation.editor.text.${label}`)}
                type="button"
                variant="ghost"
              ><CommandIcon /></Button>
            ))}
          </>
        ) : null}
      </div>
    </div>
  )
}

// Compact aspect-ratio labels for the pill trigger; the dropdown still shows the
// full descriptive names. Keys are the exact ratio values listed in ratioOptions.
const VIEWPORT_RATIO_SHORT = new Map<number | string, string>([
  [0.5625, '16:9'],
  [0.625, '16:10'],
  [0.75, '4:3'],
  [0.70710678, 'A4 ↔'],
  [1.41421356, 'A4 ↕'],
])

function EditorPageContextControls({ currentSlide, onOpenInspector, presentation, runtime }: Pick<
  ContextualControlRegistryContext,
  'currentSlide' | 'onOpenInspector' | 'presentation' | 'runtime'
>) {
  const { t } = useTranslation()
  const background = currentSlide.background?.color || '#ffffff'
  // Mirrors SlideDesignPanel's ratio list; 'custom' routes to the Design panel
  // where the custom-size dialog lives (it applies deck-wide).
  const ratioOptions = [
    { label: t('designPanel.wide169'), value: 0.5625 },
    { label: t('designPanel.wide1610'), value: 0.625 },
    { label: t('designPanel.standard43'), value: 0.75 },
    { label: t('designPanel.paperLandscape'), value: 0.70710678 },
    { label: t('designPanel.paperPortrait'), value: 1.41421356 },
    { label: t('common.custom'), value: 'custom' as const },
  ]
  const activeRatio = ratioOptions.some(option => option.value === presentation.viewportRatio) ? presentation.viewportRatio : 'custom'
  return (
    <div className={cn('mona-contextual-slide-controls', contextualControlsShell)}>
      <div className={contextualControlRow}>
        <InspectorPopoverButton
          ariaLabel={t('foundation.editor.contextual.pageBackground')}
          className={contextualControlLabeled}
          content={<EditorColorPicker onChange={color => runtime.commit('Update page background', [{
            type: 'slide.update',
            slideId: currentSlide.id,
            props: { background: { type: 'solid', color } },
          }], { historyKey: `page-background-${currentSlide.id}` })} value={background} />}
        >
          <span
            className="inline-block box-border size-4 flex-none rounded-control"
            style={{ backgroundColor: background, border: '1px solid rgb(16 18 25 / 35%)' }}
          />
          <span>{t('foundation.editor.contextual.background')}</span>
        </InspectorPopoverButton>
        <div className={contextualDivider} />
        <InspectorSelect
          ariaLabel={t('designPanel.customCanvas')}
          className={`${contextualGhostSelect} w-22`}
          onChange={value => {
            if (value === 'custom') onOpenInspector('slideDesign')
            else if (typeof value === 'number') runtime.commit('Set viewport ratio', [{ type: 'presentation.viewport-ratio.set', ratio: value }], { historyKey: 'slide-design-viewport' })
          }}
          options={ratioOptions}
          renderLabel={option => (option && VIEWPORT_RATIO_SHORT.get(option.value)) || t('common.custom')}
          value={activeRatio}
        />
      </div>
    </div>
  )
}

const controlRegistry: Record<ContextualSelectionKind, (context: ContextualControlRegistryContext) => ReactNode> = {
  empty: () => null,
  page: context => <EditorPageContextControls currentSlide={context.currentSlide} onOpenInspector={context.onOpenInspector} presentation={context.presentation} runtime={context.runtime} />,
  group: context => <EditorMultiContextControls capabilities={context.capabilities} presentation={context.presentation} runtime={context.runtime} />,
  mixed: context => <EditorMultiContextControls capabilities={context.capabilities} presentation={context.presentation} runtime={context.runtime} />,
  'group-child': context => <GroupChildControls context={context} />,
  ...elementControlRegistry,
}

export function ContextualPrimaryControls({ context }: { context: ContextualControlRegistryContext }) {
  return controlRegistry[context.capabilities.selectionKind](context)
}

export function ContextualDeepActions({
  capabilities,
  onOpenInspector,
}: Pick<ContextualControlRegistryContext, 'capabilities' | 'onOpenInspector'>) {
  const { t } = useTranslation()
  if (capabilities.selectionKind === 'empty') return null
  const page = capabilities.selectionKind === 'page'
  const multiple = capabilities.selectionKind === 'group' || capabilities.selectionKind === 'mixed'
  return (
    <div className={cn('mona-contextual-deep-actions', contextualDeepActions)}>
      {page ? (
        <ContextAction icon={<SwatchBook />} onClick={() => onOpenInspector('slideDesign')}>{t('foundation.editor.toolbar.design')}</ContextAction>
      ) : (
        <ContextAction icon={<SwatchBook />} onClick={() => onOpenInspector(multiple ? 'multiStyle' : 'elStyle')}>{t('foundation.editor.text.style')}</ContextAction>
      )}
      {capabilities.canAnimate ? (
        <ContextAction icon={page ? <BetweenHorizontalEnd /> : <Sparkles />} onClick={() => onOpenInspector(page ? 'slideAnimation' : 'elAnimation')}>{t(page ? 'foundation.editor.toolbar.transition' : 'foundation.editor.text.animation')}</ContextAction>
      ) : null}
      {capabilities.canPosition && !page ? (
        <ContextAction icon={<Move />} onClick={() => onOpenInspector(multiple ? 'multiPosition' : 'elPosition')}>{t('foundation.editor.text.position')}</ContextAction>
      ) : null}
    </div>
  )
}
