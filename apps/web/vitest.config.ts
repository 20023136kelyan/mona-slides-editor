import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import Icons from 'unplugin-icons/vite'
import { FileSystemIconLoader } from 'unplugin-icons/loaders'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        resolve: {
          alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
            '@excalidraw/mermaid-to-excalidraw': fileURLToPath(new URL(
              './src/features/editor/drawing/excalidraw-mermaid-disabled.ts',
              import.meta.url,
            )),
          },
        },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.unit.test.ts'],
        },
      },
      {
        plugins: [
          react(),
          Icons({
            compiler: 'jsx',
            jsx: 'react',
            defaultClass: 'i-icon',
            scale: 1,
            customCollections: {
              custom: FileSystemIconLoader(fileURLToPath(new URL('./src/assets/icons', import.meta.url))),
            },
          }),
          tailwindcss(),
        ],
        optimizeDeps: {
          include: ['lodash/throttle', 'react-dom/client', 'react-router', 'tinycolor2'],
        },
        resolve: {
          alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
            '@excalidraw/mermaid-to-excalidraw': fileURLToPath(new URL(
              './src/features/editor/drawing/excalidraw-mermaid-disabled.ts',
              import.meta.url,
            )),
          },
        },
        test: {
          name: 'browser',
          include: ['src/**/*.browser.test.tsx'],
          setupFiles: ['./src/test/browser-setup.ts'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
})
