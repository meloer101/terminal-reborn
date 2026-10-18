import { expect, test } from '@playwright/test'
import { launchApp } from './launch'

test('app window opens with the shell regions', async () => {
  const app = await launchApp()
  const page = await app.firstWindow()
  await expect(page).toHaveTitle('Wavi')
  for (const region of ['sidebar', 'main', 'terminal']) {
    await expect(page.locator(`[data-region="${region}"]`)).toBeVisible()
  }
  const spawnType = await page.evaluate(
    () => typeof (globalThis as unknown as { tr?: { pty?: { spawn?: unknown } } }).tr?.pty?.spawn
  )
  expect(spawnType).toBe('function')
  // A fresh profile has no projects yet: the sidebar explains that and offers to open one (Figma 09 · A).
  const sidebar = page.locator('[data-region="sidebar"]')
  await expect(sidebar.getByText('还没有项目', { exact: true })).toBeVisible()
  // F18: the sidebar keeps one quiet line; the one open-project button lives on the welcome page.
  await expect(page.getByTestId('empty-main').getByRole('button', { name: /^打开项目… ⌘O$/ })).toBeVisible()
  await expect(sidebar.getByRole('button', { name: /^打开项目… ⌘O$/ })).toBeVisible()
  await app.close()
})
