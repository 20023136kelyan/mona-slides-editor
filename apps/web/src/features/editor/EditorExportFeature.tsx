import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { PopoverContent } from '@/components/ui/popover'
import { EditorExportPanel } from '@/features/editor/EditorExportPopover'
import { useEditorExportActions } from '@/features/editor/editor-export'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { useEditorApplication } from '@/features/editor/services/editor-application'

/**
 * Content of the header Share dropdown. Rendered lazily inside the header's
 * Share `Popover` so the export stack (pptxgenjs, html-to-image) stays out
 * of the editor's critical path. Open/close state lives in the editor
 * application (`exportType`); the header's Popover root maps dismissal to
 * `closeExport`.
 */
export function EditorExportFeature({ runtime }: { runtime: EditorRuntime }) {
  const { t } = useTranslation()
  const { closeExport, exportType, openExport } = useEditorApplication()
  const actions = useEditorExportActions(runtime, t)
  const [exporting, setExporting] = useState(false)
  if (!exportType) return null
  // While an export settles the offscreen capture surfaces must stay mounted,
  // so outside clicks and Escape may not dismiss the popover.
  const blockWhileExporting = (event: { preventDefault: () => void }) => {
    if (exporting) event.preventDefault()
  }
  return (
    <PopoverContent
      align="end"
      aria-label={t('share.title')}
      className="w-110 gap-0 p-0 text-control shadow-[0_10px_30px_rgb(15_23_42_/_13%),0_2px_8px_rgb(15_23_42_/_8%)]"
      onEscapeKeyDown={blockWhileExporting}
      onInteractOutside={blockWhileExporting}
      sideOffset={8}
    >
      <EditorExportPanel
        actions={actions}
        onClose={closeExport}
        onExportingChange={setExporting}
        onTypeChange={openExport}
        runtime={runtime}
        type={exportType}
      />
    </PopoverContent>
  )
}
