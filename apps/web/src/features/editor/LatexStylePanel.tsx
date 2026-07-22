import { useTranslation } from 'react-i18next'

import EditIcon from '~icons/icon-park-outline/edit'
import type { PPTLatexElement } from '@mona/presentation-core/model'

import { PropertyRow } from '@/features/editor/ElementStyleCommons'
import { InspectorColorButton, InspectorNumberInput } from '@/features/editor/EditorInspectorPrimitives'
import type { EditorRuntime } from '@/features/editor/editor-runtime'

export function LatexStylePanel({ element, onEdit, runtime }: {
  element: PPTLatexElement
  onEdit: () => void
  runtime: EditorRuntime
}) {
  const { t } = useTranslation()
  const commit = (props: Partial<PPTLatexElement>, label: string) => runtime.commit(label, [{
    type: 'element.update',
    payload: { id: element.id, props },
  }])
  return (
    <div className="mona-latex-style-panel">
      <div className="mona-panel-row"><button className="mona-inspector-button mona-latex-edit-button" onClick={onEdit} type="button"><EditIcon /> {t('foundation.editor.latex.edit')}</button></div>
      <div className="mona-inspector-divider" />
      <PropertyRow label={t('foundation.editor.latex.color')}>
        <InspectorColorButton ariaLabel={t('foundation.editor.latex.color')} color={element.color} onChange={color => commit({ color }, 'Update equation color')} />
      </PropertyRow>
      <PropertyRow label={t('foundation.editor.latex.weight')}>
        <InspectorNumberInput ariaLabel={t('foundation.editor.latex.weight')} max={3} min={1} onChange={strokeWidth => commit({ strokeWidth }, 'Update equation weight')} value={element.strokeWidth} />
      </PropertyRow>
    </div>
  )
}
