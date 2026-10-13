import { _electron as electron, expect, test } from '@playwright/test'

test('app window opens with the shell regions', async () => {
  const app = await electron.launch({ args: ['.'] })
  const page = await app.firstWindow()
  await expect(page).toHaveTitle('Terminal Reborn')
  for (const region of ['sidebar', 'main', 'terminal']) {
    await expect(page.locator(`[data-region="${region}"]`)).toBeVisible()
  }
  const spawnType = await page.evaluate(
    () => typeof (globalThis as unknown as { tr?: { pty?: { spawn?: unknown } } }).tr?.pty?.spawn
  )
  expect(spawnType).toBe('function')
  await app.close()
})
