/* oxlint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions, jsx-a11y/prefer-tag-over-role -- the source modal mask and nested delete affordance DOM are preserved for parity. */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import EditIcon from '~icons/icon-park-outline/edit'
import PaletteIcon from '~icons/icon-park-outline/platte'
import PlusIcon from '~icons/icon-park-outline/plus'
import CloseSmallIcon from '~icons/icon-park-outline/close-small'
import type { PresentationState } from '@mona/presentation-core'
import type { ChartOptions, PPTChartElement } from '@mona/presentation-core/model'
import { Popover as PopoverPrimitive } from 'radix-ui'

import { ElementOutlineControls, PropertyRow } from '@/features/editor/ElementStyleCommons'
import { EditorColorPicker } from '@/features/editor/EditorColorPicker'
import { InspectorColorButton } from '@/features/editor/EditorInspectorPrimitives'
import { CHART_PRESET_THEMES } from '@/features/editor/editor-chart'
import type { EditorRuntime } from '@/features/editor/editor-runtime'

function ChartCheckbox({ checked, children, onChange, style }: {
  checked: boolean
  children: React.ReactNode
  onChange: (value: boolean) => void
  style?: React.CSSProperties
}) {
  return (
    <label className="mona-chart-checkbox" style={style}>
      <input checked={checked} onChange={event => onChange(event.target.checked)} type="checkbox" />
      <span className="mona-chart-checkbox-control" />
      <span>{children}</span>
    </label>
  )
}

function ChartThemeBlocks({ colors }: { colors: readonly string[] }) {
  return <div className="mona-chart-theme-blocks">{colors.slice(0, 12).map((color, index) => <span key={`${color}-${index}`}><i style={{ backgroundColor: color }} /></span>)}</div>
}

function CustomThemeModal({ colors, onClose, onSave }: {
  colors: readonly string[]
  onClose: () => void
  onSave: (colors: string[]) => void
}) {
  const { t } = useTranslation()
  const modalRef = useRef<HTMLDivElement>(null)
  const [themeColors, setThemeColors] = useState([...colors])
  const canAddThemeColor = themeColors.length < 10
  useEffect(() => {
    modalRef.current?.focus()
  }, [])
  return createPortal(
    <div className="mona-chart-theme-modal" onKeyUp={event => {
      if (event.key === 'Escape') onClose() 
    }} ref={modalRef} tabIndex={-1}>
      <div className="mona-chart-theme-mask" onClick={onClose} />
      <div className="mona-chart-theme-modal-content">
        <div className="mona-chart-theme-setting">
          <div className="mona-chart-theme-setting-title">{t('foundation.editor.chartStyle.chartThemeColors')}</div>
          <div className="mona-chart-theme-setting-list">
            {themeColors.map((color, index) => (
              <div className="mona-chart-theme-setting-row" key={index}>
                <div className="mona-chart-theme-setting-label">{t('foundation.editor.chartStyle.themeColorNumber', { number: index + 1 })}</div>
                <PopoverPrimitive.Root>
                  <PopoverPrimitive.Trigger asChild>
                    <button aria-label={t('foundation.editor.chartStyle.themeColorNumber', { number: index + 1 })} className="mona-chart-custom-color-button" type="button">
                      <span><i style={{ backgroundColor: color }} /></span><PaletteIcon />
                      {index ? <b aria-label={t('foundation.editor.chartStyle.deleteColor')} onClick={event => {
                        event.stopPropagation(); setThemeColors(current => current.filter((_, colorIndex) => colorIndex !== index)) 
                      }} role="button" tabIndex={0}><CloseSmallIcon /></b> : null}
                    </button>
                  </PopoverPrimitive.Trigger>
                  <PopoverPrimitive.Portal>
                    <PopoverPrimitive.Content className="mona-panel-popover-content" sideOffset={8}>
                      <EditorColorPicker onChange={value => setThemeColors(current => current.map((candidate, colorIndex) => colorIndex === index ? value : candidate))} value={color} />
                    </PopoverPrimitive.Content>
                  </PopoverPrimitive.Portal>
                </PopoverPrimitive.Root>
              </div>
            ))}
            <button className={`mona-chart-editor-button mona-chart-theme-add${canAddThemeColor ? ' is-default' : ' is-disabled'}`} onClick={() => {
              if (canAddThemeColor) setThemeColors(current => [...current, '#00000000']) 
            }} type="button"><PlusIcon /> {t('foundation.editor.chartStyle.addThemeColor')}</button>
          </div>
          <button className="mona-chart-editor-button is-primary mona-chart-theme-confirm" onClick={() => onSave(themeColors)} type="button">{t('foundation.editor.chartData.confirm')}</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export function ChartStylePanel({ element, onEditData, presentation, runtime }: {
  element: PPTChartElement
  onEditData: () => void
  presentation: PresentationState
  runtime: EditorRuntime
}) {
  const { t } = useTranslation()
  const [themesOpen, setThemesOpen] = useState(false)
  const [customThemeOpen, setCustomThemeOpen] = useState(false)
  const commit = (props: Partial<PPTChartElement>, label = 'Update chart style') => runtime.commit(label, [{
    type: 'element.update',
    payload: { id: element.id, props },
  }], { historyKey: `chart-style-${element.id}` })
  const updateOptions = (props: ChartOptions) => commit({ options: { ...element.options, ...props } }, 'Update chart options')
  const setThemeColors = (colors: readonly string[]) => {
    commit({ themeColors: [...colors] }, 'Update chart theme')
    setThemesOpen(false)
    setCustomThemeOpen(false)
  }
  const hasStackOptions = ['bar', 'column', 'area', 'line'].includes(element.chartType)

  return (
    <div className="mona-chart-style-panel">
      <button className="mona-inspector-button mona-chart-edit-button" onClick={onEditData} type="button"><EditIcon /> {t('foundation.editor.chartStyle.editChart')}</button>
      <div className="mona-inspector-divider" />
      {hasStackOptions ? (
        <>
          <div className="mona-chart-style-checkbox-row">
            <ChartCheckbox checked={!!element.options?.stack} onChange={stack => updateOptions({ stack })} style={{ flex: 2 }}>{t('foundation.editor.chartStyle.stacked')}</ChartCheckbox>
            {element.chartType === 'line' ? <ChartCheckbox checked={!!element.options?.lineSmooth} onChange={lineSmooth => updateOptions({ lineSmooth })} style={{ flex: 3 }}>{t('foundation.editor.chartStyle.smooth')}</ChartCheckbox> : null}
          </div>
          <div className="mona-inspector-divider" />
        </>
      ) : null}
      <PropertyRow label={t('foundation.editor.chartStyle.chartBackground')}><InspectorColorButton ariaLabel={t('foundation.editor.chartStyle.chartBackground')} color={element.fill || '#fff'} onChange={fill => commit({ fill })} /></PropertyRow>
      <PropertyRow label={t('foundation.editor.chartStyle.axisAndText')}><InspectorColorButton ariaLabel={t('foundation.editor.chartStyle.axisAndText')} color={element.textColor || '#333'} onChange={textColor => commit({ textColor })} /></PropertyRow>
      <PropertyRow label={t('foundation.editor.chartStyle.gridColor')}><InspectorColorButton ariaLabel={t('foundation.editor.chartStyle.gridColor')} color={element.lineColor || '#e8ecf4'} onChange={lineColor => commit({ lineColor })} /></PropertyRow>
      <PropertyRow label={t('foundation.editor.chartStyle.chartTheme')}>
        <PopoverPrimitive.Root onOpenChange={setThemesOpen} open={themesOpen}>
          <PopoverPrimitive.Trigger asChild>
            <button aria-label={t('foundation.editor.chartStyle.chartTheme')} className="mona-chart-theme-button" type="button"><ChartThemeBlocks colors={element.themeColors} /><PaletteIcon /></button>
          </PopoverPrimitive.Trigger>
          <PopoverPrimitive.Portal>
            <PopoverPrimitive.Content align="center" className="mona-panel-popover-content mona-chart-themes-popover" collisionPadding={5} sideOffset={8}>
              <div className="mona-chart-theme-label">{t('foundation.editor.chartStyle.presetChartThemes')}</div>
              <div className="mona-chart-preset-themes">
                {CHART_PRESET_THEMES.map((colors, index) => <button className="mona-chart-preset-theme" key={index} onClick={() => setThemeColors(colors)} type="button">{colors.map(color => <span key={color} style={{ backgroundColor: color }} />)}</button>)}
              </div>
              <div className="mona-chart-theme-label">{t('foundation.editor.chartStyle.slideTheme')}</div>
              <div className="mona-chart-preset-themes is-slide-theme">
                <button className="mona-chart-preset-theme" onClick={() => setThemeColors(presentation.theme.themeColors)} type="button">{presentation.theme.themeColors.map(color => <span key={color} style={{ backgroundColor: color }} />)}</button>
              </div>
              <div className="mona-chart-theme-divider" />
              <button className="mona-chart-editor-button is-default mona-chart-custom-theme-button" onClick={() => {
                setThemesOpen(false); setCustomThemeOpen(true) 
              }} type="button">{t('foundation.editor.chartStyle.customColors')}</button>
            </PopoverPrimitive.Content>
          </PopoverPrimitive.Portal>
        </PopoverPrimitive.Root>
      </PropertyRow>
      <div className="mona-inspector-divider" />
      <ElementOutlineControls element={element} presentation={presentation} runtime={runtime} />
      {customThemeOpen ? <CustomThemeModal colors={element.themeColors} onClose={() => setCustomThemeOpen(false)} onSave={setThemeColors} /> : null}
    </div>
  )
}
