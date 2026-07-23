/* oxlint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions, jsx-a11y/prefer-tag-over-role -- theme swatches contain nested editing affordances and expose their actions explicitly. */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import EditIcon from '~icons/icon-park-outline/edit'
import PaletteIcon from '~icons/icon-park-outline/platte'
import PlusIcon from '~icons/icon-park-outline/plus'
import CloseSmallIcon from '~icons/icon-park-outline/close-small'
import type { PresentationState } from '@mona/presentation-core'
import type { ChartOptions, PPTChartElement } from '@mona/presentation-core/model'

import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ElementOutlineControls, PropertyRow } from '@/features/editor/ElementStyleCommons'
import { EditorColorPicker } from '@/features/editor/EditorColorPicker'
import { InspectorCheckbox, InspectorColorButton } from '@/features/editor/EditorInspectorPrimitives'
import { CHART_PRESET_THEMES } from '@/features/editor/editor-chart'
import type { EditorRuntime } from '@/features/editor/editor-runtime'

function ChartCheckbox({ checked, children, onChange, style }: {
  checked: boolean
  children: React.ReactNode
  onChange: (value: boolean) => void
  style?: React.CSSProperties
}) {
  return <InspectorCheckbox checked={checked} className="mona-chart-checkbox" onChange={onChange} style={style}>{children}</InspectorCheckbox>
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
  const [themeColors, setThemeColors] = useState([...colors])
  const canAddThemeColor = themeColors.length < 10
  return (
    <Dialog onOpenChange={open => {
      if (!open) onClose()
    }} open>
      <DialogContent className="mona-chart-theme-modal-content" overlayClassName="mona-chart-theme-mask" showCloseButton={false}>
        <div className="mona-chart-theme-setting">
          <DialogHeader><DialogTitle className="mona-chart-theme-setting-title">{t('foundation.editor.chartStyle.chartThemeColors')}</DialogTitle></DialogHeader>
          <div className="mona-chart-theme-setting-list">
            {themeColors.map((color, index) => (
              <div className="mona-chart-theme-setting-row" key={index}>
                <div className="mona-chart-theme-setting-label">{t('foundation.editor.chartStyle.themeColorNumber', { number: index + 1 })}</div>
                <ButtonGroup className="mona-chart-custom-color-group">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button aria-label={t('foundation.editor.chartStyle.themeColorNumber', { number: index + 1 })} className="mona-chart-custom-color-button" variant="outline">
                        <span><i style={{ backgroundColor: color }} /></span><PaletteIcon />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="mona-panel-popover-content" sideOffset={8}>
                      <EditorColorPicker onChange={value => setThemeColors(current => current.map((candidate, colorIndex) => colorIndex === index ? value : candidate))} value={color} />
                    </PopoverContent>
                  </Popover>
                  {index ? <Button aria-label={t('foundation.editor.chartStyle.deleteColor')} onClick={() => setThemeColors(current => current.filter((_, colorIndex) => colorIndex !== index))} size="editor-icon" variant="outline"><CloseSmallIcon /></Button> : null}
                </ButtonGroup>
              </div>
            ))}
            <Button className="mona-chart-editor-button mona-chart-theme-add" disabled={!canAddThemeColor} onClick={() => setThemeColors(current => [...current, '#00000000'])} size="editor" variant="outline"><PlusIcon /> {t('foundation.editor.chartStyle.addThemeColor')}</Button>
          </div>
          <Button className="mona-chart-editor-button mona-chart-theme-confirm" onClick={() => onSave(themeColors)} size="editor">{t('foundation.editor.chartData.confirm')}</Button>
        </div>
      </DialogContent>
    </Dialog>
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
      <Button className="mona-inspector-button mona-chart-edit-button" onClick={onEditData} size="editor" variant="outline"><EditIcon /> {t('foundation.editor.chartStyle.editChart')}</Button>
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
        <Popover onOpenChange={setThemesOpen} open={themesOpen}>
          <PopoverTrigger asChild>
            <Button aria-label={t('foundation.editor.chartStyle.chartTheme')} className="mona-chart-theme-button" variant="outline"><ChartThemeBlocks colors={element.themeColors} /><PaletteIcon /></Button>
          </PopoverTrigger>
          <PopoverContent align="center" className="mona-panel-popover-content mona-chart-themes-popover" collisionPadding={5} sideOffset={8}>
              <div className="mona-chart-theme-label">{t('foundation.editor.chartStyle.presetChartThemes')}</div>
              <div className="mona-chart-preset-themes">
                {CHART_PRESET_THEMES.map((colors, index) => <Button className="mona-chart-preset-theme" key={index} onClick={() => setThemeColors(colors)} variant="outline">{colors.map(color => <span key={color} style={{ backgroundColor: color }} />)}</Button>)}
              </div>
              <div className="mona-chart-theme-label">{t('foundation.editor.chartStyle.slideTheme')}</div>
              <div className="mona-chart-preset-themes is-slide-theme">
                <Button className="mona-chart-preset-theme" onClick={() => setThemeColors(presentation.theme.themeColors)} variant="outline">{presentation.theme.themeColors.map(color => <span key={color} style={{ backgroundColor: color }} />)}</Button>
              </div>
              <div className="mona-chart-theme-divider" />
              <Button className="mona-chart-editor-button mona-chart-custom-theme-button" onClick={() => {
                setThemesOpen(false); setCustomThemeOpen(true) 
              }} size="editor" variant="outline">{t('foundation.editor.chartStyle.customColors')}</Button>
          </PopoverContent>
        </Popover>
      </PropertyRow>
      <div className="mona-inspector-divider" />
      <ElementOutlineControls element={element} presentation={presentation} runtime={runtime} />
      {customThemeOpen ? <CustomThemeModal colors={element.themeColors} onClose={() => setCustomThemeOpen(false)} onSave={setThemeColors} /> : null}
    </div>
  )
}
