import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import 'prosemirror-view/style/prosemirror.css'
import 'animate.css'

import { router } from '@/app/router'
import { ApplicationSidebarStateProvider } from '@/features/application-shell/application-sidebar-state'
import { initializeI18n } from '@/i18n'

import './index.css'

// Set before the lazy drawing bundle can load. Keeping this in the application
// module rather than an inline <script> lets the packaged renderer enforce a
// script-src 'self' Content Security Policy.
Object.assign(window, { EXCALIDRAW_ASSET_PATH: '/excalidraw-assets/' })

// The shell owns close coordination: it asks every mounted document store to
// flush before destroying the window, so no web-style leave prompt is needed.

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
      <ApplicationSidebarStateProvider>
        <RouterProvider router={router} />
      </ApplicationSidebarStateProvider>
    </StrictMode>,
  )
}

void bootstrap()
