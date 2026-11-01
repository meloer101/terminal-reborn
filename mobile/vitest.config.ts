import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Unit tests of the phone's pure code, and its protocol against the Mac's real server (../src/main/remote).
export default defineConfig({
  resolve: { alias: { '@shared': resolve(__dirname, '../src/shared') } },
  test: { include: ['src/**/*.test.ts'], environment: 'node' }
})
