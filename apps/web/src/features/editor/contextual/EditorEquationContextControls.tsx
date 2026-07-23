import { useTranslation } from 'react-i18next'

import EditIcon from '~icons/icon-park-outline/edit'
import PaletteIcon from '~icons/icon-park-outline/platte'
import type { PPTLatexElement } from '@mona/presentation-core/model'

import { Button } from '@/components/ui/button'
import { EditorColorPicker } from '@/features/editor/EditorColorPicker'
import { InspectorPopoverButton } from '@/features/editor/EditorInspectorPrimitives'
import type { EditorRuntime } from '@/features/editor/editor-runtime'

export function EditorEquationContextControls({
  element,
  onEdit,
  runtime,
}: {
  element: PPTLatexElement
  onEdit: () => void
  runtime: EditorRuntime
}) {
  const { t } = useTranslation()
  const updateColor = (color: string) => runtime.commit('Update equation color', [{
    type: 'element.update',
    payload: { id: element.id, props: { color } },
  }])

  return (
    <div className="mona-contextual-controls mona-contextual-latex-controls">
      <div className="mona-contextual-control-row">
        <Button className="mona-contextual-control is-labeled" onClick={onEdit} size="editor" type="button" variant="ghost"><EditIcon /><span>{t('foundation.editor.latex.edit')}</span></Button>
        <InspectorPopoverButton ariaLabel={t('foundation.editor.latex.colorName')} className="mona-contextual-control is-labeled" content={<EditorColorPicker onChange={updateColor} value={element.color} />}><PaletteIcon /><span>{t('foundation.editor.latex.colorName')}</span></InspectorPopoverButton>
      </div>
    </div>
  )
}
