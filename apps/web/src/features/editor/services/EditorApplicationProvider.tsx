import type { ReactNode } from 'react'

import {
  EditorApplicationContext,
  type EditorApplication,
} from '@/features/editor/services/editor-application'

export function EditorApplicationProvider({
  children,
  value,
}: {
  children: ReactNode
  value: EditorApplication
}) {
  return (
    <EditorApplicationContext value={value}>
      {children}
    </EditorApplicationContext>
  )
}
