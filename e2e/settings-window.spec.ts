// The settings window belongs to the window that opened it, so a full-screen main window doesn't push
// settings into a full-screen Space of its own.
import { expect, test } from '@playwright/test'
import { launchApp } from './launch'

test('settings opens as a non-full-screen child of a full-screen main window', async () => {
  test.setTimeout(30_000)
  const app = await launchApp()
  const main = await app.firstWindow()
  await main.waitForSelector('[data-region="sidebar"]')

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setFullScreen(true))
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isFullScreen()), { timeout: 10_000 }).toBe(true)

  const opened = app.waitForEvent('window')
  await main.evaluate(() => (globalThis as unknown as { tr: { ui: { openSettings(): void } } }).tr.ui.openSettings())
  await opened

  const state = await app.evaluate(({ BrowserWindow }) => {
    const settings = BrowserWindow.getAllWindows().find((w) => w.getTitle() === '设置')
    return settings
      ? {
          fullScreen: settings.isFullScreen(),
          fullScreenable: settings.isFullScreenable(),
          hasParent: settings.getParentWindow() !== null
        }
      : null
  })
  expect(state).toEqual({ fullScreen: false, fullScreenable: false, hasParent: true })
  await app.close()
})
