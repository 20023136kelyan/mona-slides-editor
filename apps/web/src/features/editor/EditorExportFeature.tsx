import { useTranslation } from 'react-i18next'

import { EditorExportDialog, type ExportDialogType } from '@/features/editor/EditorExportDialog'
import { useEditorExportActions } from '@/features/editor/editor-export'
import type { EditorRuntime } from '@/features/editor/editor-runtime'

export function EditorExportFeature({
  onClose,
  openType,
  runtime,
}: {
  onClose: () => void
  openType: ExportDialogType
  runtime: EditorRuntime
}) {
  const { t } = useTranslation()
  const actions = useEditorExportActions(runtime, t)
  return <EditorExportDialog actions={actions} onClose={onClose} openType={openType} runtime={runtime} />
}
