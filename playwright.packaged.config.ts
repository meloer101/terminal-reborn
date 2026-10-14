import { defineConfig } from '@playwright/test'

// Launch checks against a built .app (npm run test:packaged); separate from the dev-build e2e suite.
export default defineConfig({
  testDir: './e2e-packaged',
  timeout: 120_000,
  reporter: 'list'
})
