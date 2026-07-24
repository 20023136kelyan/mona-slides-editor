import { useEffect, useRef, useSyncExternalStore } from 'react'
import { toast } from 'sonner'

import { Toaster } from '@/components/ui/sonner'
import { useEditorApplication } from '@/features/editor/services/editor-application'

// The notification service stays the source of truth (its notify()/dismiss() API
// is threaded through import, export, and playback). This viewport just renders
// that queue through sonner instead of the former hand-rolled notice stack.
export function EditorNotificationViewport() {
  const { notifications } = useEditorApplication()
  const notices = useSyncExternalStore(
    notifications.subscribe,
    notifications.getSnapshot,
    notifications.getSnapshot,
  )
  const shown = useRef<Set<number>>(new Set())
  useEffect(() => {
    const live = new Set(notices.map(notice => notice.id))
    for (const notice of notices) {
      if (shown.current.has(notice.id)) continue
      shown.current.add(notice.id)
      const emit = notice.type === 'success' ? toast.success : notice.type === 'warning' ? toast.warning : toast.error
      emit(notice.text, {
        duration: notice.duration === 0 ? Infinity : notice.duration ?? 3000,
        id: notice.id,
        onAutoClose: () => notifications.dismiss(notice.id),
        onDismiss: () => notifications.dismiss(notice.id),
      })
    }
    for (const id of [...shown.current]) {
      if (live.has(id)) continue
      toast.dismiss(id)
      shown.current.delete(id)
    }
  }, [notices, notifications])
  return <Toaster position="top-center" richColors />
}
