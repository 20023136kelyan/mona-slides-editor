import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import Icons from 'unplugin-icons/vite'
import { FileSystemIconLoader } from 'unplugin-icons/loaders'
import { rm } from 'node:fs/promises'
import { fileURLToPath, URL } from 'node:url'

const excludeDevelopmentFixtures = () => ({
  name: 'exclude-development-fixtures',
  apply: 'build' as const,
  async closeBundle() {
    await rm(fileURLToPath(new URL('./dist/mocks/editor-fixture.json', import.meta.url)), { force: true })
  },
})

import { monaImageSearchApi } from './src/features/editor/mona-image-search-api.js'

// https://vite.dev/config/
export default defineConfig({
  publicDir: fileURLToPath(new URL('../../public', import.meta.url)),
  plugins: [
    react(),
    Icons({
      compiler: 'jsx',
      jsx: 'react',
      customCollections: {
        custom: FileSystemIconLoader(fileURLToPath(new URL('./src/assets/icons', import.meta.url))),
      },
      defaultClass: 'i-icon',
      scale: 1,
    }),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
    excludeDevelopmentFixtures(),
    monaImageSearchApi(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@excalidraw/mermaid-to-excalidraw': fileURLToPath(new URL(
        './src/features/editor/drawing/excalidraw-mermaid-disabled.ts',
        import.meta.url,
      )),
    },
  },
  server: {
    forwardConsole: true,
    proxy: {
      '/api/agent': {
        target: process.env.MONA_AGENT_SERVER_URL ?? 'http://127.0.0.1:8788',
      },
    },
  },
  build: {
    sourcemap: false,
  },
})
