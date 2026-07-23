import { describe, expect, it, vi } from 'vitest'

import { createEditorNotificationService } from '@/features/editor/services/editor-notifications'

describe('editor notification service', () => {
  it('publishes immutable snapshots and dismisses one notification by id', () => {
    const notifications = createEditorNotificationService()
    const listener = vi.fn<() => void>()
    const unsubscribe = notifications.subscribe(listener)
    const initialSnapshot = notifications.getSnapshot()

    const firstId = notifications.notify({ text: 'Saved', type: 'success' })
    const firstSnapshot = notifications.getSnapshot()
    const secondId = notifications.notify({ duration: 5000, text: 'Check the size', type: 'warning' })

    expect(initialSnapshot).toEqual([])
    expect(firstSnapshot).toEqual([{ id: firstId, text: 'Saved', type: 'success' }])
    expect(notifications.getSnapshot()).toEqual([
      { id: firstId, text: 'Saved', type: 'success' },
      { duration: 5000, id: secondId, text: 'Check the size', type: 'warning' },
    ])
    expect(firstSnapshot).not.toBe(notifications.getSnapshot())
    expect(listener).toHaveBeenCalledTimes(2)

    notifications.dismiss(firstId)
    expect(notifications.getSnapshot()).toEqual([
      { duration: 5000, id: secondId, text: 'Check the size', type: 'warning' },
    ])
    expect(listener).toHaveBeenCalledTimes(3)

    unsubscribe()
    notifications.clear()
    expect(notifications.getSnapshot()).toEqual([])
    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('does not publish for no-op dismiss or clear operations', () => {
    const notifications = createEditorNotificationService()
    const listener = vi.fn<() => void>()
    notifications.subscribe(listener)

    notifications.dismiss(999)
    notifications.clear()

    expect(listener).not.toHaveBeenCalled()
  })
})
