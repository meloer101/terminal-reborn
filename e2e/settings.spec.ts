import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp } from './launch'

interface TrWindow {
  tr: {
    ui: { openSettings(): void }
    settings: { get(): Promise<{ appearance: { fontSize: number; cjkFont: string; theme: string; lineHeight: number; ligatures: boolean } }> }
  }
}

/** Opens the settings dialog in the main window and returns that page. */
async function openSettings(app: ElectronApplication): Promise<Page> {
  const settings = await app.firstWindow()
  await settings.waitForSelector('[data-region="sidebar"]')
  await settings.evaluate(() => (globalThis as unknown as TrWindow).tr.ui.openSettings())
  await expect(settings.getByRole('dialog', { name: '设置' })).toBeVisible()
  await expect(settings.getByRole('tab', { name: '外观' })).toBeVisible()
  await expect(settings.getByTestId('preview-terminal')).toBeVisible()
  return settings
}

const readSettings = (page: Page) => page.evaluate(() => (globalThis as unknown as TrWindow).tr.settings.get())

test('settings window edits appearance live and the preview follows', async () => {
  const app = await launchApp()
  const settings = await openSettings(app)
  const preview = settings.getByTestId('preview-terminal')

  await expect(settings.getByTestId('preview-caption')).toHaveText('JetBrains Mono 13 · PingFang SC · 行高 1.00')

  // 字号: pick 15 from the menu.
  await settings.getByRole('combobox', { name: '字号' }).click()
  await settings.getByRole('option', { name: '15', exact: true }).click()
  await expect.poll(async () => (await readSettings(settings)).appearance.fontSize).toBe(15)
  await expect(preview).toHaveAttribute('data-font-size', '15')
  await expect(settings.getByTestId('preview-caption')).toContainText('15')

  // 中文字体: type a family into the menu's search field and confirm with Enter.
  const before = await preview.getAttribute('data-font-stack')
  await settings.getByRole('combobox', { name: '中文字体' }).click()
  await settings.getByPlaceholder('搜索或输入字体名').fill('Songti SC')
  await settings.keyboard.press('Enter')
  await expect.poll(async () => (await readSettings(settings)).appearance.cjkFont).toBe('Songti SC')
  await expect(preview).not.toHaveAttribute('data-font-stack', before ?? '')
  await expect(preview).toHaveAttribute('data-font-stack', /"Songti SC"/)

  // 行高 slider and 连字 toggle reach the store too.
  const slider = settings.getByRole('slider', { name: '行高' })
  await slider.focus()
  await settings.keyboard.press('End')
  await expect.poll(async () => (await readSettings(settings)).appearance.lineHeight).toBe(2.2)
  await settings.getByRole('switch', { name: '连字' }).click()
  await expect.poll(async () => (await readSettings(settings)).appearance.ligatures).toBe(true)

  // No background picker: the terminal always takes the theme's color (PRD v1.2).
  await expect(settings.getByRole('radio', { name: '渐变' })).toHaveCount(0)

  // Theme: 浅色 flips the settings window itself.
  await settings.getByRole('radio', { name: '浅色' }).click()
  await expect.poll(async () => (await readSettings(settings)).appearance.theme).toBe('light')
  await expect(settings.locator('html')).toHaveAttribute('data-theme', 'light')

  await app.close()
})

// Opt-in: TR_SCREENSHOT_DIR=/some/dir npx playwright test e2e/settings.spec.ts -g screenshots
test('settings screenshots', async () => {
  const shot = process.env.TR_SCREENSHOT_DIR
  test.skip(!shot, 'set TR_SCREENSHOT_DIR to capture screenshots')
  const app = await launchApp()
  const settings = await openSettings(app)
  await settings.getByRole('radio', { name: '深色' }).click()
  await expect(settings.locator('html')).toHaveAttribute('data-theme', 'dark')
  await settings.waitForTimeout(600)
  await settings.screenshot({ path: `${shot}/settings-dark.png` })
  await settings.getByRole('combobox', { name: '中文字体' }).click()
  await settings.waitForTimeout(300)
  await settings.screenshot({ path: `${shot}/settings-dark-cjk-menu.png` })
  await settings.keyboard.press('Escape')
  await settings.getByRole('radio', { name: '浅色' }).click()
  await expect(settings.locator('html')).toHaveAttribute('data-theme', 'light')
  await settings.waitForTimeout(600)
  await settings.screenshot({ path: `${shot}/settings-light.png` })
  await app.close()
})

test('about pane shows the version and checks for updates', async () => {
  const app = await launchApp()
  const settings = await openSettings(app)
  await settings.getByRole('tab', { name: '关于' }).click()
  await expect(settings.getByTestId('app-version')).not.toBeEmpty()
  await expect(settings.getByRole('button', { name: '检查更新' })).toBeVisible()
  // Panes without content yet are not listed (B11): no 即将推出 dead ends.
  await expect(settings.getByRole('tab')).toHaveText(['外观', '关于'])
  await app.close()
})

test('settings is a dialog in the main window: sidebar, Esc, close button, and the scrim close it', async () => {
  const app = await launchApp()
  const page = await openSettings(app)
  const dialog = page.getByRole('dialog', { name: '设置' })
  expect(app.windows()).toHaveLength(1)

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()

  await page.locator('[data-region="sidebar"]').getByRole('button', { name: /^设置/ }).click()
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '关闭设置（Esc）' }).click()
  await expect(dialog).toBeHidden()

  await page.evaluate(() => (globalThis as unknown as TrWindow).tr.ui.openSettings())
  await expect(dialog).toBeVisible()
  await page.mouse.click(8, 400) // the scrim, outside the sheet
  await expect(dialog).toBeHidden()

  // An open font menu takes Esc first; the dialog stays.
  await page.evaluate(() => (globalThis as unknown as TrWindow).tr.ui.openSettings())
  await dialog.getByRole('combobox', { name: '字号' }).click()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  await app.close()
})

test('Chinese fonts are grouped by language; 恢复默认 resets everything but the theme', async () => {
  const app = await launchApp()
  const settings = await openSettings(app)
  await settings.getByRole('radio', { name: '浅色' }).click()
  await settings.getByRole('combobox', { name: '字号' }).click()
  await settings.getByRole('option', { name: '16', exact: true }).click()
  await expect.poll(async () => (await readSettings(settings)).appearance.fontSize).toBe(16)

  await settings.getByRole('combobox', { name: '中文字体' }).click()
  const listbox = settings.getByRole('listbox', { name: '中文字体' })
  // The default family's group always exists; others depend on the fonts installed on this machine.
  await expect(listbox.getByText('简体中文', { exact: true })).toBeVisible()
  await settings.screenshot({ path: 'test-results/settings-cjk-groups.png' })
  await settings.keyboard.press('Escape')

  const reset = settings.getByRole('button', { name: '恢复默认' })
  await reset.scrollIntoViewIfNeeded()
  await reset.click()
  await expect.poll(async () => (await readSettings(settings)).appearance.fontSize).toBe(13)
  expect((await readSettings(settings)).appearance.theme).toBe('light')
  await expect(reset).toBeDisabled()
  await app.close()
})

test('the theme never changes by itself: no stale migration, arrows on the swatches only move focus (B17)', async () => {
  const app = await launchApp()
  const page = await app.firstWindow()
  // An old localStorage-only choice from an earlier build must not be written into settings.
  await page.evaluate(() => (globalThis as unknown as { localStorage: Storage }).localStorage.setItem('tr.theme.v1', 'dark'))
  await page.reload()
  await page.waitForSelector('[data-region="sidebar"]')
  await page.waitForTimeout(300)
  expect((await readSettings(page)).appearance.theme).toBe('system')

  const settings = await openSettings(app)
  await settings.getByRole('radio', { name: '跟随系统' }).click()
  await settings.keyboard.press('ArrowDown')
  await settings.keyboard.press('ArrowRight')
  await settings.waitForTimeout(200)
  expect((await readSettings(settings)).appearance.theme).toBe('system')
  // Space on the focused swatch is a real choice.
  await settings.keyboard.press('Space')
  await expect.poll(async () => (await readSettings(settings)).appearance.theme).toBe('light')
  await app.close()
})
