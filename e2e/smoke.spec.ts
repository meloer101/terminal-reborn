import { expect, test } from '@playwright/test'
import { launchApp } from './launch'

test('app window opens with the shell regions', async () => {
  const app = await launchApp()
  const page = await app.firstWindow()
  await expect(page).toHaveTitle('Terminal Reborn')
  for (const region of ['sidebar', 'main', 'terminal']) {
    await expect(page.locator(`[data-region="${region}"]`)).toBeVisible()
  }
  const spawnType = await page.evaluate(
    () => typeof (globalThis as unknown as { tr?: { pty?: { spawn?: unknown } } }).tr?.pty?.spawn
  )
  expect(spawnType).toBe('function')
  // A fresh profile has no sessions yet and offers to add a project.
  await expect(page.getByRole('button', { name: '添加项目…' })).toBeVisible()
  await app.close()
})
