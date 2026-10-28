import { defineConfig } from '@playwright/test'

// Launch-film captures only (launch-videos/e-huashu); run from the repo root:
//   DEMO_DIR=<make-demo.sh output> SHOTS_DIR=<dir> npx playwright test -c launch-videos/e-huashu/tools/playwright.config.ts
export default defineConfig({ testDir: '.', testMatch: /capture\.spec\.ts$/, timeout: 300_000, reporter: 'list' })
