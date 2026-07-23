import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import 'prosemirror-view/style/prosemirror.css'
import 'animate.css'

import { router } from '@/app/router'
import { initializeI18n } from '@/i18n'

import './index.css'

// The leave-confirmation prompt is owned by editor-persistence: it fires only
// while an edit is still in flight to IndexedDB, instead of the established editor's
// unconditional nag (the working copy makes reloads lossless).

// the source editor suppresses the native context menu globally (index.html); surfaces
// with custom menus attach their own handlers on top. Native form fields are
// exempt so title rename, link inputs, and the notes editor keep the
// browser's paste/spellcheck menu (rich-text stays suppressed: the canvas
// provides its own menu there).
document.oncontextmenu = event => {
  const target = event.target as Element | null
  if (target?.closest('input, textarea')) return
  event.preventDefault()
}

const bootstrap = async () => {
  await initializeI18n()

  const rootElement = document.getElementById('root')
  if (!rootElement) throw new Error('React root element is missing')

  createRoot(rootElement).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  )
}

void bootstrap()
