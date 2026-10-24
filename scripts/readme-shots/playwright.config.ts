import { defineConfig } from '@playwright/test'

// README screenshots only; not part of `npm run test:e2e`. Run through scripts/readme-shots/run.sh.
export default defineConfig({
  testDir: '.',
  testMatch: /app\.spec\.ts$/,
  timeout: 300_000,
  reporter: 'list'
})
