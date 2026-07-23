export type EditorNotificationType = 'error' | 'success' | 'warning'

export interface EditorNotificationInput {
  readonly duration?: number
  readonly text: string
  readonly type: EditorNotificationType
}

export interface EditorNotification extends EditorNotificationInput {
  readonly id: number
}

export interface EditorNotificationService {
  clear: () => void
  dismiss: (id: number) => void
  getSnapshot: () => readonly EditorNotification[]
  notify: (notification: EditorNotificationInput) => number
  subscribe: (listener: () => void) => () => void
}

export const createEditorNotificationService = (): EditorNotificationService => {
  let nextId = 0
  let notifications: readonly EditorNotification[] = []
  const listeners = new Set<() => void>()
  const publish = () => {
    for (const listener of listeners) listener()
  }
  return {
    clear: () => {
      if (!notifications.length) return
      notifications = []
      publish()
    },
    dismiss: id => {
      const next = notifications.filter(notification => notification.id !== id)
      if (next.length === notifications.length) return
      notifications = next
      publish()
    },
    getSnapshot: () => notifications,
    notify: notification => {
      const id = ++nextId
      notifications = [...notifications, { ...notification, id }]
      publish()
      return id
    },
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
