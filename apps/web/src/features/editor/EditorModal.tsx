import type { ReactNode } from 'react'

import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog'
import { EditorModalCloseContext } from '@/features/editor/editor-modal-context'

export function EditorModal({
  children,
  closeOnClickMask = true,
  closeOnEsc = true,
  onClose,
  open,
  title,
  width = 480,
}: {
  children: ReactNode
  closeOnClickMask?: boolean
  closeOnEsc?: boolean
  onClose: () => void
  open: boolean
  title: string
  width?: number
}) {
  return (
    <Dialog onOpenChange={next => {
      if (!next) onClose()
    }} open={open}>
      <DialogContent
        aria-describedby={undefined}
        className="gap-0 overflow-hidden p-5 sm:max-w-none"
        onEscapeKeyDown={event => {
          if (!closeOnEsc) event.preventDefault()
        }}
        onPointerDownOutside={event => {
          if (!closeOnClickMask) event.preventDefault()
        }}
        showCloseButton={false}
        style={{ width }}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <EditorModalCloseContext.Provider value={onClose}>
          {children}
        </EditorModalCloseContext.Provider>
      </DialogContent>
    </Dialog>
  )
}
