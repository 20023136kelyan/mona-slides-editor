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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ElementOutlineControls, PropertyRow } from '@/features/editor/ElementStyleCommons'
import { InspectorCheckbox, InspectorColorButton, inspectorDividerClass, inspectorRowClass } from '@/features/editor/EditorInspectorPrimitives'
import { EditorModal } from '@/features/editor/EditorModal'
import { CHART_PRESET_THEMES } from '@/features/editor/editor-chart'
import type { EditorRuntime } from '@/features/editor/editor-runtime'

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
    <EditorModal onClose={onClose} open title={t('foundation.editor.chartStyle.chartThemeColors')} width={310}>
      <div className="flex flex-col">
        <div className="mb-3.75 text-[17px] font-bold">{t('foundation.editor.chartStyle.chartThemeColors')}</div>
        <div>
          {themeColors.map((color, index) => (
            <div className={inspectorRowClass} key={index}>
              <div className="w-2/5 text-control">{t('foundation.editor.chartStyle.themeColorNumber', { number: index + 1 })}</div>
              <div className="flex w-3/5 items-center gap-1 [&>:first-child]:min-w-0 [&>:first-child]:flex-1">
                <InspectorColorButton ariaLabel={t('foundation.editor.chartStyle.themeColorNumber', { number: index + 1 })} color={color} onChange={value => setThemeColors(current => current.map((candidate, colorIndex) => colorIndex === index ? value : candidate))} />
                {index ? <Button aria-label={t('foundation.editor.chartStyle.deleteColor')} onClick={() => setThemeColors(current => current.filter((_, colorIndex) => colorIndex !== index))} size="editor-icon" variant="outline"><CloseSmallIcon /></Button> : null}
              </div>
            </div>
          ))}
          <Button className="w-full" disabled={!canAddThemeColor} onClick={() => setThemeColors(current => [...current, '#00000000'])} size="editor" variant="outline"><PlusIcon /> {t('foundation.editor.chartStyle.addThemeColor')}</Button>
        </div>
        <Button className="mt-3 w-full" onClick={() => onSave(themeColors)} size="editor">{t('foundation.editor.chartData.confirm')}</Button>
      </div>
    </EditorModal>
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
    <div className="text-control text-foreground select-none">
      <Button className="w-full" onClick={onEditData} size="editor" variant="outline"><EditIcon /> {t('foundation.editor.chartStyle.editChart')}</Button>
      <div className={inspectorDividerClass} />
      {hasStackOptions ? (
        <>
          <div className={inspectorRowClass}>
            <InspectorCheckbox checked={!!element.options?.stack} onChange={stack => updateOptions({ stack })} style={{ flex: 2 }}>{t('foundation.editor.chartStyle.stacked')}</InspectorCheckbox>
            {element.chartType === 'line' ? <InspectorCheckbox checked={!!element.options?.lineSmooth} onChange={lineSmooth => updateOptions({ lineSmooth })} style={{ flex: 3 }}>{t('foundation.editor.chartStyle.smooth')}</InspectorCheckbox> : null}
          </div>
          <div className={inspectorDividerClass} />
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
          <PopoverContent aria-label={t('foundation.editor.chartStyle.chartTheme')} align="center" className="mona-panel-popover-content mona-chart-themes-popover" collisionPadding={5} sideOffset={8}>
              <div className="mb-1 text-xs">{t('foundation.editor.chartStyle.presetChartThemes')}</div>
              <div className="mona-chart-preset-themes">
                {CHART_PRESET_THEMES.map((colors, index) => <Button className="mona-chart-preset-theme" key={index} onClick={() => setThemeColors(colors)} variant="outline">{colors.map(color => <span key={color} style={{ backgroundColor: color }} />)}</Button>)}
              </div>
              <div className="mb-1 text-xs">{t('foundation.editor.chartStyle.slideTheme')}</div>
              <div className="mona-chart-preset-themes is-slide-theme">
                <Button className="mona-chart-preset-theme" onClick={() => setThemeColors(presentation.theme.themeColors)} variant="outline">{presentation.theme.themeColors.map(color => <span key={color} style={{ backgroundColor: color }} />)}</Button>
              </div>
              <div className="my-2.5 w-full border-t border-black/[0.06]" />
              <Button className="w-full" onClick={() => {
                setThemesOpen(false); setCustomThemeOpen(true) 
              }} size="editor" variant="outline">{t('foundation.editor.chartStyle.customColors')}</Button>
          </PopoverContent>
        </Popover>
      </PropertyRow>
      <div className={inspectorDividerClass} />
      <ElementOutlineControls element={element} presentation={presentation} runtime={runtime} />
      {customThemeOpen ? <CustomThemeModal colors={element.themeColors} onClose={() => setCustomThemeOpen(false)} onSave={setThemeColors} /> : null}
    </div>
  )
}
