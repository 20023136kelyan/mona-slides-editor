import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { EditorExportPanel } from '@/features/editor/EditorExportPopover'
import { useEditorExportActions } from '@/features/editor/editor-export'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { useEditorApplication } from '@/features/editor/services/editor-application'

/**
 * The export surface, opened from File.
 *
 * A dialog rather than the popover it used to be, because a popover needs
 * something to hang off and there is nothing left to hang it on. It anchored to
 * the header's Share button — which is what made exporting and sharing the same
 * control — and on macOS the File menu is in the system menu bar, so once that
 * button stops opening it there is no anchor in the window at all.
 *
 * Mounted lazily, so the export stack (pptxgenjs, html-to-image) stays out of
 * the editor's critical path. Open state lives in the editor application as
 * `exportType`, which also carries which format was asked for.
 */
export function EditorExportFeature({ runtime }: { runtime: EditorRuntime }) {
  const { t } = useTranslation()
  const { closeExport, exportType, openExport } = useEditorApplication()
  const actions = useEditorExportActions(runtime, t)
  const [exporting, setExporting] = useState(false)
  if (!exportType) return null
  return (
    <Dialog
      onOpenChange={open => {
        // While an export settles, the offscreen capture surfaces have to stay
        // mounted; dismissing here would unmount them mid-capture.
        if (!open && !exporting) closeExport()
      }}
      open
    >
      <DialogContent className="w-110 gap-0 p-0 text-control" showCloseButton={false}>
        {/* The panel draws its own heading; this keeps the accessible name on
            the dialog, which Radix requires and screen readers announce. */}
        <DialogTitle className="sr-only">{t('header.exportFile')}</DialogTitle>
        <EditorExportPanel
          actions={actions}
          onClose={closeExport}
          onExportingChange={setExporting}
          onTypeChange={openExport}
          runtime={runtime}
          type={exportType}
        />
      </DialogContent>
    </Dialog>
  )
}
