import { useTranslation } from 'react-i18next'

import ChartIcon from '~icons/icon-park-outline/chart-histogram'
import EditIcon from '~icons/icon-park-outline/edit'
import type { PPTChartElement } from '@mona/presentation-core/model'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { CHART_TYPES } from '@/features/editor/editor-chart'
import type { EditorRuntime } from '@/features/editor/editor-runtime'

export function EditorChartContextControls({
  element,
  onEditData,
  runtime,
}: {
  element: PPTChartElement
  onEditData: () => void
  runtime: EditorRuntime
}) {
  const { t } = useTranslation()
  const changeType = (chartType: PPTChartElement['chartType']) => {
    if (element.chartType === chartType) return
    runtime.commit('Change chart type', [{ type: 'element.update', payload: { id: element.id, props: { chartType } } }])
  }

  return (
    <div className="mona-contextual-controls mona-contextual-chart-controls">
      <div className="mona-contextual-control-row">
        <Button className="mona-contextual-control is-labeled" onClick={onEditData} variant="ghost"><EditIcon /><span>{t('foundation.editor.chartStyle.editData')}</span></Button>
        <Popover>
          <PopoverTrigger asChild><Button className="mona-contextual-control is-labeled" variant="ghost"><ChartIcon /><span>{t('foundation.editor.chartStyle.type')}</span></Button></PopoverTrigger>
          <PopoverContent align="center" className="mona-chart-type-menu is-contextual" sideOffset={8}>
            {CHART_TYPES.map(type => <Button key={type} onClick={() => changeType(type)} size="sm" variant="ghost">{t(`foundation.editor.chartTypes.${type}`)}</Button>)}
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}
