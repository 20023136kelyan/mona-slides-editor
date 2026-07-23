import { useTranslation } from 'react-i18next'

import AlignBottomIcon from '~icons/icon-park-outline/align-bottom'
import AlignHorizontallyIcon from '~icons/icon-park-outline/align-horizontally'
import AlignLeftIcon from '~icons/icon-park-outline/align-left'
import AlignRightIcon from '~icons/icon-park-outline/align-right'
import AlignTopIcon from '~icons/icon-park-outline/align-top'
import AlignVerticallyIcon from '~icons/icon-park-outline/align-vertically'
import GroupIcon from '~icons/icon-park-outline/group'
import UngroupIcon from '~icons/icon-park-outline/ungroup'
import { editorActions } from '@mona/editor-state'
import { createPresentationId, type PresentationState } from '@mona/presentation-core'

import { InspectorButton, InspectorButtonGroup } from '@/features/editor/EditorInspectorPrimitives'
import {
  alignActiveElements,
  alignElementsToCanvas,
  getMultiSelectionState,
  groupElements,
  distributeElements,
  ungroupElements,
  type MultiAlignmentCommand,
  type UniformDisplayAxis,
} from '@/features/editor/editor-geometry'
import type { EditorRuntime } from '@/features/editor/editor-runtime'

export function MultiPositionPanel({
  activeElementIds,
  handleElementId,
  presentation,
  runtime,
}: {
  activeElementIds: string[]
  handleElementId: string | null
  presentation: PresentationState
  runtime: EditorRuntime
}) {
  const { t } = useTranslation()
  const slide = presentation.slides[presentation.slideIndex]!
  const selectedIds = new Set(activeElementIds)
  const { canCombine, displayItemCount } = getMultiSelectionState(slide.elements, selectedIds)
  const commitElements = (label: string, elements: typeof slide.elements) => runtime.commit(label, [{
    type: 'slide.update',
    props: { elements },
  }])

  const align = (command: MultiAlignmentCommand) => {
    const elements = canCombine
      ? alignActiveElements({ command, elements: slide.elements, selectedIds })
      : alignElementsToCanvas({
        command,
        elements: slide.elements,
        selectedIds,
        viewportHeight: presentation.viewportSize * presentation.viewportRatio,
        viewportWidth: presentation.viewportSize,
      })
    commitElements(canCombine ? 'Align selected elements' : 'Align group to slide', elements)
  }

  const distribute = (axis: UniformDisplayAxis) => {
    commitElements('Distribute selected elements', distributeElements({
      axis,
      elements: slide.elements,
      selectedIds,
    }))
  }

  const group = () => {
    if (!canCombine) return
    commitElements('Group elements', groupElements(
      slide.elements,
      selectedIds,
      createPresentationId(10),
    ))
  }

  const ungroup = () => {
    if (canCombine) return
    const elements = ungroupElements(slide.elements, selectedIds)
    if (!elements) return
    if (!commitElements('Ungroup elements', elements)) return
    runtime.store.dispatch(editorActions.selectionChanged(handleElementId ? [handleElementId] : []))
  }

  return (
    <div className="mona-multi-position-panel">
      <InspectorButtonGroup className="mona-multi-panel-row">
        <InspectorButton ariaLabel={t('foundation.editor.multi.alignLeft')} onClick={() => align('left')} style={{ flex: 1 }}><AlignLeftIcon /></InspectorButton>
        <InspectorButton ariaLabel={t('foundation.editor.multi.horizontalCenter')} onClick={() => align('horizontal')} style={{ flex: 1 }}><AlignHorizontallyIcon /></InspectorButton>
        <InspectorButton ariaLabel={t('foundation.editor.multi.alignRight')} onClick={() => align('right')} style={{ flex: 1 }}><AlignRightIcon /></InspectorButton>
      </InspectorButtonGroup>
      <InspectorButtonGroup className="mona-multi-panel-row">
        <InspectorButton ariaLabel={t('foundation.editor.multi.alignTop')} onClick={() => align('top')} style={{ flex: 1 }}><AlignTopIcon /></InspectorButton>
        <InspectorButton ariaLabel={t('foundation.editor.multi.verticalCenter')} onClick={() => align('vertical')} style={{ flex: 1 }}><AlignVerticallyIcon /></InspectorButton>
        <InspectorButton ariaLabel={t('foundation.editor.multi.alignBottom')} onClick={() => align('bottom')} style={{ flex: 1 }}><AlignBottomIcon /></InspectorButton>
      </InspectorButtonGroup>
      {displayItemCount > 2 ? (
        <InspectorButtonGroup className="mona-multi-panel-row">
          <InspectorButton ariaLabel={t('foundation.editor.multi.distributeHorizontally')} onClick={() => distribute('horizontal')} style={{ flex: 1 }}>{t('foundation.editor.multi.distributeHorizontally')}</InspectorButton>
          <InspectorButton ariaLabel={t('foundation.editor.multi.distributeVertically')} onClick={() => distribute('vertical')} style={{ flex: 1 }}>{t('foundation.editor.multi.distributeVertically')}</InspectorButton>
        </InspectorButtonGroup>
      ) : null}

      <div className="mona-panel-divider" />

      <InspectorButtonGroup className="mona-multi-panel-row">
        <InspectorButton ariaLabel={t('foundation.editor.multi.group')} disabled={!canCombine} onClick={group} style={{ flex: 1 }}><GroupIcon className="mona-multi-button-icon" />{t('foundation.editor.multi.group')}</InspectorButton>
        <InspectorButton ariaLabel={t('foundation.editor.multi.ungroup')} disabled={canCombine} onClick={ungroup} style={{ flex: 1 }}><UngroupIcon className="mona-multi-button-icon" />{t('foundation.editor.multi.ungroup')}</InspectorButton>
      </InspectorButtonGroup>
    </div>
  )
}
