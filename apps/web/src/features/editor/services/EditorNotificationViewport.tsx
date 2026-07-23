import { useSyncExternalStore } from 'react'

import { EditorNoticeStack } from '@/features/editor/EditorContextMenu'
import { useEditorApplication } from '@/features/editor/services/editor-application'

export function EditorNotificationViewport() {
  const { notifications } = useEditorApplication()
  const notices = useSyncExternalStore(
    notifications.subscribe,
    notifications.getSnapshot,
    notifications.getSnapshot,
  )
  return <EditorNoticeStack notices={notices} onClose={notifications.dismiss} />
}
