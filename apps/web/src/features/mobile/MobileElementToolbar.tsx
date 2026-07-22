import { useSyncExternalStore, useState } from 'react'
import { useTranslation } from 'react-i18next'

import AlignBottomIcon from '~icons/icon-park-outline/align-bottom'
import AlignHorizontalIcon from '~icons/icon-park-outline/align-horizontally'
import AlignLeftIcon from '~icons/icon-park-outline/align-left'
import AlignRightIcon from '~icons/icon-park-outline/align-right'
import AlignTextCenterIcon from '~icons/icon-park-outline/align-text-center'
import AlignTextLeftIcon from '~icons/icon-park-outline/align-text-left'
import AlignTextRightIcon from '~icons/icon-park-outline/align-text-right'
import AlignTopIcon from '~icons/icon-park-outline/align-top'
import AlignVerticalIcon from '~icons/icon-park-outline/align-vertically'
import BringForwardIcon from '~icons/icon-park-outline/bring-to-front'
import SendBackIcon from '~icons/icon-park-outline/bring-to-front-one'
import CopyIcon from '~icons/icon-park-outline/copy'
import DeleteIcon from '~icons/icon-park-outline/delete'
import FontSizeIcon from '~icons/icon-park-outline/font-size'
import SendBackwardIcon from '~icons/icon-park-outline/sent-to-back'
import BringFrontIcon from '~icons/icon-park-outline/send-to-back'
import StrikeIcon from '~icons/icon-park-outline/strikethrough'
import BoldIcon from '~icons/icon-park-outline/text-bold'
import ItalicIcon from '~icons/icon-park-outline/text-italic'
import UnderlineIcon from '~icons/icon-park-outline/text-underline'
import { selectHandleElement, selectPresentation } from '@mona/editor-state'
import type { PPTElement, TableCell } from '@mona/presentation-core/model'
import { Popover as PopoverPrimitive } from 'radix-ui'

import { EditorColorPicker } from '@/features/editor/EditorColorPicker'
import { alignElementsToCanvasLikePptist, orderElementLikePptist } from '@/features/editor/editor-geometry'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { useEditorSelector } from '@/features/editor/use-editor-selector'
import { MobileButton, MobileButtonGroup, MobileDivider } from '@/features/mobile/MobilePrimitives'

const COLORS = ['#000000', '#ffffff', '#eeece1', '#1e497b', '#4e81bb', '#e2534d', '#9aba60', '#8165a0', '#47acc5', '#c21401', '#ff1e02', '#ffc12a', '#ffff3a', '#90cf5b', '#00af57']

function ColorRows({ color, label, onChange }: { color: string; label: string; onChange: (color: string) => void }) {
  return (
    <div className="mona-mobile-row-block">
      <div className="mona-mobile-row-label">{label}:</div>
      <div className="mona-mobile-colors">
        {COLORS.map(value => (
          <button aria-label={`${label} ${value}`} className="mona-mobile-color" key={value} onClick={() => onChange(value)} type="button"><i style={{ backgroundColor: value }} /></button>
        ))}
        <PopoverPrimitive.Root>
          <PopoverPrimitive.Trigger asChild>
            <button aria-label={`${label} custom`} className="mona-mobile-color is-custom" type="button"><i /></button>
          </PopoverPrimitive.Trigger>
          <PopoverPrimitive.Portal>
            <PopoverPrimitive.Content className="mona-mobile-color-popover" collisionPadding={5} side="top" sideOffset={8}>
              <EditorColorPicker onChange={onChange} value={color || '#ffffff'} />
            </PopoverPrimitive.Content>
          </PopoverPrimitive.Portal>
        </PopoverPrimitive.Root>
      </div>
    </div>
  )
}

const colorForElement = (element: PPTElement, richTextColor: string) => {
  if (element.type === 'text' || (element.type === 'shape' && element.text?.content)) return richTextColor
  if (element.type === 'table') return element.data[0]?.[0]?.style?.color || '#fff'
  if (element.type === 'latex') return element.color
  return '#fff'
}

const fillForElement = (element: PPTElement) => {
  if (element.type === 'text' || element.type === 'shape' || element.type === 'chart') return element.fill || '#fff'
  if (element.type === 'table') return element.data[0]?.[0]?.style?.backcolor || '#fff'
  if (element.type === 'audio' || element.type === 'line') return element.color
  return '#fff'
}

export function MobileElementToolbar({ runtime }: { runtime: EditorRuntime }) {
  const { t } = useTranslation()
  const presentation = useEditorSelector(runtime.store, selectPresentation)
  const handleElement = useEditorSelector(runtime.store, selectHandleElement)
  const richText = useSyncExternalStore(runtime.richText.subscribe, runtime.richText.getSnapshot, runtime.richText.getSnapshot)
  const [activeTab, setActiveTab] = useState<'common' | 'style'>('common')
  if (!handleElement) return null

  const textPropsEnable = handleElement.type === 'text' || (handleElement.type === 'shape' && Boolean(handleElement.text?.content))
  const textColorPropsEnable = textPropsEnable || handleElement.type === 'table' || handleElement.type === 'latex'
  const fillPropsEnable = ['text', 'shape', 'chart', 'table', 'line', 'audio'].includes(handleElement.type)

  const commitElements = (elements: PPTElement[], label: string) => runtime.commit(label, [{ type: 'slide.update', props: { elements } }])
  const order = (command: 'bottom' | 'down' | 'top' | 'up') => {
    const slide = presentation.slides[presentation.slideIndex]
    if (!slide) return
    const elements = orderElementLikePptist(slide.elements, handleElement.id, command)
    if (elements) commitElements(elements, `Order element ${command}`)
  }
  const align = (command: 'bottom' | 'horizontal' | 'left' | 'right' | 'top' | 'vertical') => {
    const slide = presentation.slides[presentation.slideIndex]
    if (!slide) return
    const elements = alignElementsToCanvasLikePptist({
      command,
      elements: slide.elements,
      selectedIds: new Set([handleElement.id]),
      viewportHeight: presentation.viewportSize * presentation.viewportRatio,
      viewportWidth: presentation.viewportSize,
    })
    commitElements(elements, `Align element ${command}`)
  }
  const executeText = (command: 'align' | 'bold' | 'color' | 'em' | 'fontsize-add' | 'fontsize-reduce' | 'strikethrough' | 'underline', value?: string) => {
    runtime.richText.execute(handleElement.id, value ? { command, value } : { command })
  }
  const update = (props: Partial<PPTElement>, label: string) => runtime.commit(label, [{ type: 'element.update', payload: { id: handleElement.id, props } }])
  const updateFontColor = (color: string) => {
    if (textPropsEnable) executeText('color', color)
    else if (handleElement.type === 'table') {
      const data = structuredClone(handleElement.data) as TableCell[][]
      for (const row of data) for (const cell of row) cell.style = { ...cell.style, color }
      update({ data } as Partial<PPTElement>, 'Set table text color')
    }
    else if (handleElement.type === 'latex') update({ color }, 'Set equation color')
  }
  const updateFill = (color: string) => {
    if (handleElement.type === 'text' || handleElement.type === 'shape' || handleElement.type === 'chart') update({ fill: color }, 'Set element fill')
    else if (handleElement.type === 'table') {
      const data = structuredClone(handleElement.data) as TableCell[][]
      for (const row of data) for (const cell of row) cell.style = { ...cell.style, backcolor: color }
      update({ data } as Partial<PPTElement>, 'Set table fill')
    }
    else if (handleElement.type === 'audio' || handleElement.type === 'line') update({ color }, 'Set element color')
  }

  return (
    <div className="mona-mobile-element-toolbar">
      <div className="mona-mobile-tabs" role="tablist">
        <button aria-selected={activeTab === 'style'} onClick={() => setActiveTab('style')} role="tab" type="button">{t('common.style')}</button>
        <button aria-selected={activeTab === 'common'} onClick={() => setActiveTab('common')} role="tab" type="button">{t('mobile.layout')}</button>
      </div>
      <div className="mona-mobile-element-content">
        {activeTab === 'style' ? (
          <div className="mona-mobile-element-style">
            {textPropsEnable ? (
              <>
                <MobileButtonGroup className="mona-mobile-row">
                  <MobileButton active={richText.attrs.bold} aria-label="Bold" onClick={() => executeText('bold')}><BoldIcon /></MobileButton>
                  <MobileButton active={richText.attrs.em} aria-label="Italic" onClick={() => executeText('em')}><ItalicIcon /></MobileButton>
                  <MobileButton active={richText.attrs.underline} aria-label="Underline" onClick={() => executeText('underline')}><UnderlineIcon /></MobileButton>
                  <MobileButton active={richText.attrs.strikethrough} aria-label="Strikethrough" onClick={() => executeText('strikethrough')}><StrikeIcon /></MobileButton>
                </MobileButtonGroup>
                <MobileButtonGroup className="mona-mobile-row">
                  <MobileButton aria-label="Increase font size" onClick={() => executeText('fontsize-add')}><FontSizeIcon />+</MobileButton>
                  <MobileButton aria-label="Decrease font size" onClick={() => executeText('fontsize-reduce')}><FontSizeIcon />-</MobileButton>
                </MobileButtonGroup>
                <MobileButtonGroup className="mona-mobile-row">
                  <MobileButton active={richText.attrs.align === 'left'} aria-label="Align text left" onClick={() => executeText('align', 'left')}><AlignTextLeftIcon /></MobileButton>
                  <MobileButton active={richText.attrs.align === 'center'} aria-label="Align text center" onClick={() => executeText('align', 'center')}><AlignTextCenterIcon /></MobileButton>
                  <MobileButton active={richText.attrs.align === 'right'} aria-label="Align text right" onClick={() => executeText('align', 'right')}><AlignTextRightIcon /></MobileButton>
                </MobileButtonGroup>
              </>
            ) : null}
            {textColorPropsEnable ? <ColorRows color={colorForElement(handleElement, richText.attrs.color)} label={t('toolbar.textColor')} onChange={updateFontColor} /> : null}
            {fillPropsEnable ? <ColorRows color={fillForElement(handleElement)} label={t('common.fill')} onChange={updateFill} /> : null}
            {!textPropsEnable && !textColorPropsEnable && !fillPropsEnable ? <div className="mona-mobile-no-properties">{t('mobile.noProperties')}</div> : null}
          </div>
        ) : (
          <div className="mona-mobile-element-common">
            <MobileButtonGroup className="mona-mobile-row">
              <MobileButton onClick={() => {
                runtime.copySelection(); runtime.paste() 
              }}><CopyIcon className="mona-mobile-button-icon" /> {t('common.copy')}</MobileButton>
              <MobileButton onClick={() => runtime.deleteSelection()}><DeleteIcon className="mona-mobile-button-icon" /> {t('common.delete')}</MobileButton>
            </MobileButtonGroup>
            <MobileDivider />
            <MobileButtonGroup className="mona-mobile-row">
              <MobileButton onClick={() => order('top')}><BringFrontIcon className="mona-mobile-button-icon" /> {t('toolbar.bringFront')}</MobileButton>
              <MobileButton onClick={() => order('bottom')}><SendBackIcon className="mona-mobile-button-icon" /> {t('toolbar.sendBack')}</MobileButton>
              <MobileButton onClick={() => order('up')}><BringForwardIcon className="mona-mobile-button-icon" /> {t('toolbar.moveForward')}</MobileButton>
              <MobileButton onClick={() => order('down')}><SendBackwardIcon className="mona-mobile-button-icon" /> {t('toolbar.moveBackward')}</MobileButton>
            </MobileButtonGroup>
            <MobileDivider />
            <MobileButtonGroup className="mona-mobile-row">
              <MobileButton onClick={() => align('left')}><AlignLeftIcon className="mona-mobile-button-icon" /> {t('common.leftAlign')}</MobileButton>
              <MobileButton onClick={() => align('horizontal')}><AlignVerticalIcon className="mona-mobile-button-icon" /> {t('common.horizontalCenter')}</MobileButton>
              <MobileButton onClick={() => align('right')}><AlignRightIcon className="mona-mobile-button-icon" /> {t('common.rightAlign')}</MobileButton>
            </MobileButtonGroup>
            <MobileButtonGroup className="mona-mobile-row">
              <MobileButton onClick={() => align('top')}><AlignTopIcon className="mona-mobile-button-icon" /> {t('common.topAlign')}</MobileButton>
              <MobileButton onClick={() => align('vertical')}><AlignHorizontalIcon className="mona-mobile-button-icon" /> {t('common.verticalCenter')}</MobileButton>
              <MobileButton onClick={() => align('bottom')}><AlignBottomIcon className="mona-mobile-button-icon" /> {t('common.bottomAlign')}</MobileButton>
            </MobileButtonGroup>
          </div>
        )}
      </div>
    </div>
  )
}
