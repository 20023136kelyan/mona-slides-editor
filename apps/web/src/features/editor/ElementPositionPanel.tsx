import { useTranslation } from 'react-i18next'

import AlignBottomIcon from '~icons/icon-park-outline/align-bottom'
import AlignHorizontallyIcon from '~icons/icon-park-outline/align-horizontally'
import AlignLeftIcon from '~icons/icon-park-outline/align-left'
import AlignRightIcon from '~icons/icon-park-outline/align-right'
import AlignTopIcon from '~icons/icon-park-outline/align-top'
import AlignVerticallyIcon from '~icons/icon-park-outline/align-vertically'
import BringToFrontIcon from '~icons/icon-park-outline/bring-to-front'
import BringToFrontOneIcon from '~icons/icon-park-outline/bring-to-front-one'
import LockIcon from '~icons/icon-park-outline/lock'
import RotateIcon from '~icons/icon-park-outline/rotate'
import SendToBackIcon from '~icons/icon-park-outline/send-to-back'
import SentToBackIcon from '~icons/icon-park-outline/sent-to-back'
import UnlockIcon from '~icons/icon-park-outline/unlock'
import { SHAPE_PATH_FORMULAS } from '@mona/presentation-core/shape-path-formulas'
import type { PresentationState } from '@mona/presentation-core'
import type { PPTElement } from '@mona/presentation-core/model'
import round from 'lodash/round'

import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Toggle } from '@/components/ui/toggle'
import { EditorLayersPanel } from '@/features/editor/EditorLayersPanel'
import { InspectorButton, InspectorButtonGroup, InspectorNumberInput, inspectorDividerClass } from '@/features/editor/EditorInspectorPrimitives'
import {
  alignElementsToCanvas,
  orderElement,
  type ElementOrderCommand,
  type MultiAlignmentCommand,
} from '@/features/editor/editor-geometry'
import type { EditorRuntime } from '@/features/editor/editor-runtime'

const minSizeByType: Record<string, number> = {
  audio: 20,
  chart: 200,
  image: 20,
  latex: 20,
  shape: 20,
  table: 30,
  text: 40,
  video: 250,
}

export function ElementPositionPanel({
  activeElementIds,
  element,
  presentation,
  runtime,
}: {
  activeElementIds: string[]
  element: PPTElement
  presentation: PresentationState
  runtime: EditorRuntime
}) {
  const { t } = useTranslation()
  const slide = presentation.slides[presentation.slideIndex]!
  const historyKey = 'element-position-panel'
  const left = round(element.left, 1)
  const top = round(element.top, 1)
  const width = element.type === 'line' ? 0 : round(element.width, 1)
  const height = element.type === 'line' ? 0 : round(element.height, 1)
  const rotate = 'rotate' in element && element.rotate !== undefined ? round(element.rotate, 1) : 0
  const fixedRatio = 'fixedRatio' in element && Boolean(element.fixedRatio)
  const minSize = minSizeByType[element.type] || 20
  const isAutoHeightText = element.type === 'text' && !element.vertical && !element.fixedHeight
  const isAutoWidthText = element.type === 'text' && Boolean(element.vertical) && !element.fixedHeight
  const update = (props: Partial<PPTElement>) => runtime.commit('Update element position', [{
    type: 'element.update',
    payload: { id: element.id, props },
  }], { historyKey })

  const order = (command: ElementOrderCommand) => {
    const elements = orderElement(slide.elements, element.id, command)
    if (!elements) return
    runtime.commit('Reorder element', [{ type: 'slide.update', props: { elements } }], { historyKey })
  }
  const align = (command: MultiAlignmentCommand) => {
    const elements = alignElementsToCanvas({
      command,
      elements: slide.elements,
      selectedIds: new Set(activeElementIds),
      viewportHeight: presentation.viewportSize * presentation.viewportRatio,
      viewportWidth: presentation.viewportSize,
    })
    // Quirk retired: Vue's NumberInput watcher wrote the handle element's
    // coordinates back rounded to one decimal while other members kept full
    // precision. All aligned members now keep the calculation's precision.
    runtime.commit('Align element to canvas', [{ type: 'slide.update', props: { elements } }], { historyKey })
  }
  const resize = (nextWidth: number, nextHeight: number) => {
    let props: Partial<PPTElement> = { height: nextHeight, width: nextWidth }
    if (element.type === 'shape' && element.pathFormula) {
      const formula = SHAPE_PATH_FORMULAS[element.pathFormula]
      if (formula) {
        props = {
          ...props,
          path: formula.editable
            ? formula.formula(nextWidth, nextHeight, element.keypoints)
            : formula.formula(nextWidth, nextHeight),
          viewBox: [nextWidth, nextHeight],
        }
      }
    }
    update(props)
  }

  return (
    <Tabs className="mona-position-tabs" defaultValue="arrange">
      <TabsList className="mona-position-tabs-list" variant="line">
        <TabsTrigger value="arrange">{t('foundation.editor.position.arrange')}</TabsTrigger>
        <TabsTrigger value="layers">{t('foundation.editor.position.layers')}</TabsTrigger>
      </TabsList>
      <TabsContent value="arrange">
      <div className="mona-element-position-panel">
      <div className="mona-position-title">{t('foundation.editor.position.layer')}</div>
      <InspectorButtonGroup className="mona-position-row">
        <InspectorButton ariaLabel={t('foundation.editor.position.bringFront')} onClick={() => order('top')} style={{ flex: 1 }}><SendToBackIcon /> {t('foundation.editor.position.bringFront')}</InspectorButton>
        <InspectorButton ariaLabel={t('foundation.editor.position.sendBack')} onClick={() => order('bottom')} style={{ flex: 1 }}><BringToFrontOneIcon /> {t('foundation.editor.position.sendBack')}</InspectorButton>
      </InspectorButtonGroup>
      <InspectorButtonGroup className="mona-position-row">
        <InspectorButton ariaLabel={t('foundation.editor.position.moveForward')} onClick={() => order('up')} style={{ flex: 1 }}><BringToFrontIcon /> {t('foundation.editor.position.moveForward')}</InspectorButton>
        <InspectorButton ariaLabel={t('foundation.editor.position.moveBackward')} onClick={() => order('down')} style={{ flex: 1 }}><SentToBackIcon /> {t('foundation.editor.position.moveBackward')}</InspectorButton>
      </InspectorButtonGroup>

      <div className={inspectorDividerClass} />

      <div className="mona-position-title">{t('foundation.editor.position.alignment')}</div>
      <InspectorButtonGroup className="mona-position-row">
        <InspectorButton ariaLabel={t('foundation.editor.position.alignLeft')} onClick={() => align('left')} style={{ flex: 1 }}><AlignLeftIcon /></InspectorButton>
        <InspectorButton ariaLabel={t('foundation.editor.position.horizontalCenter')} onClick={() => align('horizontal')} style={{ flex: 1 }}><AlignVerticallyIcon /></InspectorButton>
        <InspectorButton ariaLabel={t('foundation.editor.position.alignRight')} onClick={() => align('right')} style={{ flex: 1 }}><AlignRightIcon /></InspectorButton>
      </InspectorButtonGroup>
      <InspectorButtonGroup className="mona-position-row">
        <InspectorButton ariaLabel={t('foundation.editor.position.alignTop')} onClick={() => align('top')} style={{ flex: 1 }}><AlignTopIcon /></InspectorButton>
        <InspectorButton ariaLabel={t('foundation.editor.position.verticalCenter')} onClick={() => align('vertical')} style={{ flex: 1 }}><AlignHorizontallyIcon /></InspectorButton>
        <InspectorButton ariaLabel={t('foundation.editor.position.alignBottom')} onClick={() => align('bottom')} style={{ flex: 1 }}><AlignBottomIcon /></InspectorButton>
      </InspectorButtonGroup>

      <div className={inspectorDividerClass} />

      <div className="mona-position-row">
        <InspectorNumberInput ariaLabel={t('foundation.editor.position.x')} label={t('foundation.editor.position.x')} min={-1000} onChange={value => update({ left: value })} step={5} style={{ width: '45%' }} value={left} />
        <div style={{ width: '10%' }} />
        <InspectorNumberInput ariaLabel={t('foundation.editor.position.y')} label={t('foundation.editor.position.y')} min={-1000} onChange={value => update({ top: value })} step={5} style={{ width: '45%' }} value={top} />
      </div>

      {element.type !== 'line' ? (
        <div className="mona-position-row">
          <InspectorNumberInput
            ariaLabel={t('foundation.editor.position.width')}
            disabled={isAutoWidthText}
            label={t('foundation.editor.position.width')}
            max={1500}
            min={minSize}
            onChange={value => {
              if (isAutoWidthText) return
              let nextHeight = height
              if (fixedRatio) {
                const ratio = width / height
                nextHeight = value / ratio < minSize ? minSize : value / ratio
              }
              resize(value, nextHeight)
            }}
            step={5}
            style={{ width: '45%' }}
            value={width}
          />
          {['audio', 'image', 'shape'].includes(element.type) ? (
            <Toggle
              aria-label={fixedRatio ? t('foundation.editor.position.unlockRatio') : t('foundation.editor.position.lockRatio')}
              className={`mona-position-icon-button${fixedRatio ? ' is-active' : ''}`}
              onPressedChange={pressed => update({ fixedRatio: pressed } as Partial<PPTElement>)}
              pressed={fixedRatio}
              style={{ width: '10%' }}
            >{fixedRatio ? <LockIcon /> : <UnlockIcon />}</Toggle>
          ) : <div style={{ width: '10%' }} />}
          <InspectorNumberInput
            ariaLabel={t('foundation.editor.position.height')}
            disabled={isAutoHeightText || element.type === 'table'}
            label={t('foundation.editor.position.height')}
            max={800}
            min={minSize}
            onChange={value => {
              if (isAutoHeightText || element.type === 'table') return
              let nextWidth = width
              if (fixedRatio) {
                const ratio = width / height
                nextWidth = value * ratio < minSize ? minSize : value * ratio
              }
              resize(nextWidth, value)
            }}
            step={5}
            style={{ width: '45%' }}
            value={height}
          />
        </div>
      ) : null}

      {!['audio', 'line', 'video'].includes(element.type) ? (
        <>
          <div className={inspectorDividerClass} />
          <div className="mona-position-row">
            <InspectorNumberInput ariaLabel={t('foundation.editor.position.rotation')} label={t('foundation.editor.position.rotation')} max={180} min={-180} onChange={value => update({ rotate: value } as Partial<PPTElement>)} step={5} style={{ width: '45%' }} value={rotate} />
            <div style={{ width: '7%' }} />
            <Button aria-label={t('foundation.editor.position.rotateMinus')} className="block h-7.5 rounded-none border-0 bg-transparent p-0 leading-[30px] text-foreground hover:rounded-control hover:bg-[#efefef]" onClick={() => update({ rotate: Math.max(-180, Math.floor(rotate / 45) * 45 - 45) } as Partial<PPTElement>)} size="editor" style={{ width: '24%' }} type="button" variant="outline"><RotateIcon /> -45°</Button>
            <Button aria-label={t('foundation.editor.position.rotatePlus')} className="block h-7.5 rounded-none border-0 bg-transparent p-0 leading-[30px] text-foreground hover:rounded-control hover:bg-[#efefef]" onClick={() => update({ rotate: Math.min(180, Math.floor(rotate / 45) * 45 + 45) } as Partial<PPTElement>)} size="editor" style={{ width: '24%' }} type="button" variant="outline"><RotateIcon style={{ transform: 'rotateY(180deg)' }} /> +45°</Button>
          </div>
        </>
      ) : null}
      </div>
      </TabsContent>
      <TabsContent className="mona-position-layers" value="layers">
        <EditorLayersPanel runtime={runtime} />
      </TabsContent>
    </Tabs>
  )
}
