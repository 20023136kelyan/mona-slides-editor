import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'

import 'prosemirror-view/style/prosemirror.css'
import 'animate.css'
import '@/assets/styles/prosemirror.scss'
import '@/assets/styles/global.scss'
import '@/assets/styles/font.scss'

import Directive from '@/directive'
import { i18n, initializeLocale } from '@/i18n'

const bootstrap = async () => {
  await initializeLocale()

  const app = createApp(App)
  const pinia = createPinia()
  app.use(Directive)
  app.use(pinia)
  app.use(i18n)
  app.mount('#app')

  if (import.meta.env.DEV) {
    const { installTestBridge } = await import('@/utils/testBridge')
    installTestBridge(pinia)
  }
}

bootstrap()
