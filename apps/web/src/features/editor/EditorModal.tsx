import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { EditorModalCloseContext } from '@/features/editor/editor-modal-context'

export function EditorModal({
  children,
  onClose,
  open,
  width = 480,
}: {
  children: ReactNode
  onClose: () => void
  open: boolean
  width?: number
}) {
  const modalRef = useRef<HTMLDialogElement>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    if (!open) return undefined
    modalRef.current?.focus()
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [open])

  const close = useCallback(() => {
    if (closing) return
    setClosing(true)
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null
      onClose()
    }, 250)
  }, [closing, onClose])

  if (!open) return null
  return createPortal((
    <dialog
      aria-modal="true"
      className={`mona-source-modal${closing ? ' is-closing' : ''}`}
      onKeyDown={event => {
        if (event.key === 'Escape') close()
      }}
      ref={modalRef}
      open
      tabIndex={-1}
    >
      <button aria-label="Close" className="mona-source-modal-mask" onClick={close} type="button" />
      <EditorModalCloseContext.Provider value={close}>
        <div className="mona-source-modal-content" style={{ width }}>
          {children}
        </div>
      </EditorModalCloseContext.Provider>
    </dialog>
  ), document.body)
}
