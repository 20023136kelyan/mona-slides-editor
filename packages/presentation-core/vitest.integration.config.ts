import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('../../src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: [
      'packages/presentation-core/src/**/*.test.ts',
      'packages/editor-state/src/**/*.test.ts',
      'packages/editor-interactions/src/**/*.test.ts',
      'tests/core/**/*.test.ts',
      'tests/performance/**/*.test.ts',
    ],
  },
})
