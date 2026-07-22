import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import 'prosemirror-view/style/prosemirror.css'
import 'animate.css'

import { router } from '@/app/router'
import { initializeI18n } from '@/i18n'

import './index.css'

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
