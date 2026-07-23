import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Blend, Layers3, Move, Sparkles, SwatchBook } from 'lucide-react'

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

import { Button } from '@/components/ui/button'
import { Toggle } from '@/components/ui/toggle'
import { EditorColorPicker } from '@/features/editor/EditorColorPicker'
import { InspectorPopoverButton, InspectorSlider } from '@/features/editor/EditorInspectorPrimitives'
import { EditorChartContextControls } from '@/features/editor/contextual/EditorChartContextControls'
import { EditorEquationContextControls } from '@/features/editor/contextual/EditorEquationContextControls'
import { EditorImageContextControls } from '@/features/editor/contextual/EditorImageContextControls'
import { EditorMediaContextControls } from '@/features/editor/contextual/EditorMediaContextControls'
import { EditorShapeLineContextControls } from '@/features/editor/contextual/EditorShapeLineContextControls'
import { EditorTableContextControls } from '@/features/editor/contextual/EditorTableContextControls'
import { EditorTextContextControls } from '@/features/editor/contextual/EditorTextContextControls'
import type {
  ContextualSelectionKind,
  ElementCapabilityKind,
  SelectionCapabilities,
} from '@/features/editor/contextual/resolve-selection-capabilities'
import type { EditorRuntime } from '@/features/editor/editor-runtime'

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
    <Button aria-label={children} className="mona-contextual-action" onClick={onClick} size="editor" title={children} type="button" variant="ghost">
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
}

function GroupChildControls({ context }: { context: ContextualControlRegistryContext }) {
  const { t } = useTranslation()
  return (
    <>
      <span className="mona-contextual-child-badge">{t('foundation.editor.contextual.groupChild')}</span>
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
  const fill = capabilities.values.fill === 'mixed' ? '#ffffff' : capabilities.values.fill ?? '#ffffff'
  const stroke = capabilities.values.stroke === 'mixed' ? '#000000' : capabilities.values.stroke ?? '#000000'
  const transparency = capabilities.values.transparency === 'mixed' ? 0 : capabilities.values.transparency ?? 0
  const selectionLabel = capabilities.selectionKind === 'group'
    ? t('foundation.editor.contextual.groupSelection', { count: capabilities.selectedElements.length })
    : t('foundation.editor.contextual.mixedSelection', { count: capabilities.selectedElements.length })

  return (
    <div className="mona-contextual-controls mona-contextual-multi-controls">
      <div className="mona-contextual-control-row">
        <span className="mona-contextual-selection-label"><Layers3 />{selectionLabel}</span>
        {capabilities.canFill ? (
          <InspectorPopoverButton
            ariaLabel={t('foundation.editor.contextual.fill', { state: capabilities.values.fill === 'mixed' ? t('foundation.editor.contextual.mixed') : '' })}
            className="mona-contextual-control is-labeled"
            content={<EditorColorPicker onChange={updateFill} value={fill} />}
          >
            <span className="mona-contextual-color-dot" data-mixed={capabilities.values.fill === 'mixed' || undefined} style={{ backgroundColor: fill }} />
            <span>{t('foundation.editor.contextual.fillLabel')}</span>
          </InspectorPopoverButton>
        ) : null}
        {capabilities.canStroke ? (
          <InspectorPopoverButton
            ariaLabel={t('foundation.editor.contextual.stroke', { state: capabilities.values.stroke === 'mixed' ? t('foundation.editor.contextual.mixed') : '' })}
            className="mona-contextual-control is-labeled"
            content={<EditorColorPicker onChange={updateStroke} value={stroke} />}
          >
            <span className="mona-contextual-stroke-dot" data-mixed={capabilities.values.stroke === 'mixed' || undefined} style={{ borderColor: stroke }} />
            <span>{t('foundation.editor.contextual.strokeLabel')}</span>
          </InspectorPopoverButton>
        ) : null}
        {capabilities.canTransparency ? (
          <InspectorPopoverButton
            ariaLabel={t('foundation.editor.contextual.transparency', { state: capabilities.values.transparency === 'mixed' ? t('foundation.editor.contextual.mixed') : '' })}
            className="mona-contextual-control is-labeled"
            content={(
              <div className="mona-contextual-transparency-popover">
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
              className="mona-contextual-control"
              data-mixed={capabilities.values.flipH === 'mixed' || undefined}
              onPressedChange={() => updateFlip('flipH')}
              pressed={capabilities.values.flipH === true}
            ><FlipHorizontalIcon /></Toggle>
            <Toggle
              aria-label={t('foundation.editor.shape.verticalFlip')}
              className="mona-contextual-control"
              data-mixed={capabilities.values.flipV === 'mixed' || undefined}
              onPressedChange={() => updateFlip('flipV')}
              pressed={capabilities.values.flipV === true}
            ><FlipVerticalIcon /></Toggle>
          </>
        ) : null}
      </div>
    </div>
  )
}

function EditorPageContextControls({ currentSlide, runtime }: Pick<
  ContextualControlRegistryContext,
  'currentSlide' | 'runtime'
>) {
  const { t } = useTranslation()
  const background = currentSlide.background?.color || '#ffffff'
  return (
    <div className="mona-contextual-controls mona-contextual-slide-controls">
      <div className="mona-contextual-control-row">
        <InspectorPopoverButton
          ariaLabel={t('foundation.editor.contextual.pageBackground')}
          className="mona-contextual-control is-labeled"
          content={<EditorColorPicker onChange={color => runtime.commit('Update page background', [{
            type: 'slide.update',
            slideId: currentSlide.id,
            props: { background: { type: 'solid', color } },
          }], { historyKey: `page-background-${currentSlide.id}` })} value={background} />}
        >
          <span className="mona-contextual-color-dot" style={{ backgroundColor: background }} />
          <span>{t('foundation.editor.contextual.background')}</span>
        </InspectorPopoverButton>
      </div>
    </div>
  )
}

const controlRegistry: Record<ContextualSelectionKind, (context: ContextualControlRegistryContext) => ReactNode> = {
  empty: () => null,
  page: context => <EditorPageContextControls currentSlide={context.currentSlide} runtime={context.runtime} />,
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
    <div className="mona-contextual-deep-actions">
      {page ? (
        <ContextAction icon={<SwatchBook />} onClick={() => onOpenInspector('slideDesign')}>{t('foundation.editor.toolbar.design')}</ContextAction>
      ) : (
        <ContextAction icon={<SwatchBook />} onClick={() => onOpenInspector(multiple ? 'multiStyle' : 'elStyle')}>{t('foundation.editor.text.style')}</ContextAction>
      )}
      {capabilities.canAnimate ? (
        <ContextAction icon={<Sparkles />} onClick={() => onOpenInspector(page ? 'slideAnimation' : 'elAnimation')}>{t(page ? 'foundation.editor.toolbar.transition' : 'foundation.editor.text.animation')}</ContextAction>
      ) : null}
      {capabilities.canPosition && !page ? (
        <ContextAction icon={<Move />} onClick={() => onOpenInspector(multiple ? 'multiPosition' : 'elPosition')}>{t('foundation.editor.text.position')}</ContextAction>
      ) : null}
    </div>
  )
}
