import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer')
    }
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
    // Many suites start real git and shell processes in every test. In a full run on a busy machine those need far more
    // than the default 5 s, and which file runs out depends on the load, so the limit is set once here.
    testTimeout: 60_000
  }
})
