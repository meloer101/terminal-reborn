import { defineConfig } from '@playwright/test'

// Specs that measure time, record every painted frame, need the macOS keyboard focus (only one window can be key) or
// write the system clipboard (there is one, and a parallel spec overwrites it between copy and paste) fail when other
// Electron windows run beside them, so they run alone, one file at a time, after everything else.
const EXCLUSIVE = [
  /git-panel-perf\.spec\.ts$/,
  /browser-panel\.spec\.ts$/,
  /terminal-flicker\.spec\.ts$/,
  /clipboard\.spec\.ts$/,
  /attachments\.spec\.ts$/,
  /right-panel\.spec\.ts$/
]

export default defineConfig({
  testDir: './e2e',
  // Ends pty daemons a failed test left behind (e2e/global-setup.ts).
  globalSetup: './e2e/global-setup.ts',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  projects: [
    { name: 'parallel', testIgnore: EXCLUSIVE },
    { name: 'exclusive', testMatch: EXCLUSIVE, workers: 1, dependencies: ['parallel'] }
  ]
})
