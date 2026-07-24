import { createContext, useContext } from 'react'

import type { ExportType } from '@/features/editor/EditorExportPopover'
import type { DeckPersistence } from '@/features/editor/editor-persistence'
import type { ImportRequestDetail } from '@/features/editor/editor-import'
import type { EditorNotificationService } from '@/features/editor/services/editor-notifications'

export interface StartPresentationOptions {
  autoPlay?: boolean
  fromStart: boolean
  viewMode?: 'base' | 'presenter'
}

export interface EditorApplication {
  agentOpen: boolean
  closeAgent: () => void
  closeExport: () => void
  exitPresentation: () => void
  /** Selected file type in the header export dropdown, or null while closed. */
  exportType: ExportType | null
  importFiles: (request: ImportRequestDetail) => Promise<void>
  importing: boolean
  notifications: EditorNotificationService
  openAgent: () => void
  openExport: (type?: ExportType) => void
  persistence: DeckPersistence | null
  presenting: boolean
  startPresentation: (options: StartPresentationOptions) => void
  subscribeToPresentationStart: (listener: () => void) => () => void
}

export const EditorApplicationContext = createContext<EditorApplication | null>(null)

export const useEditorApplication = (): EditorApplication => {
  const application = useContext(EditorApplicationContext)
  if (!application) {
    throw new Error('Editor application actions require an EditorApplicationProvider')
  }
  return application
}

export const useOptionalEditorApplication = (): EditorApplication | null => (
  useContext(EditorApplicationContext)
)
