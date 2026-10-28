import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp } from './launch'

interface TrWindow {
  tr: {
    ui: { openSettings(): void }
    settings: {
      get(): Promise<{
        appearance: { fontSize: number; cjkFont: string; theme: string; lineHeight: number; ligatures: boolean }
        ports: { base: number }
        review: { beforeMerge: boolean; beforePush: boolean; afterTurnWithCommits: boolean; mode: string; rules: string; customRules: string; reviewer: string; model: string; codexModel: string }
      }>
    }
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

test('Worktree pane sets the port block base', async () => {
  const app = await launchApp()
  const settings = await openSettings(app)
  await settings.getByRole('tab', { name: 'Worktree' }).click()
  const field = settings.getByRole('textbox', { name: '起始端口' })
  await expect(field).toHaveValue('41000')
  await expect(settings.getByText('每个目录分到 10 个连续端口。TR_PORT 是其中的第一个。已经分过的目录仍用原来的一段；改起点只影响之后新分的目录。')).toBeVisible()

  await field.fill('42000')
  await field.press('Enter')
  await expect.poll(async () => (await readSettings(settings)).ports.base).toBe(42000)
  await expect(field).toHaveValue('42000')

  await field.fill('80')
  await field.press('Enter')
  await expect.poll(async () => (await readSettings(settings)).ports.base).toBe(1024)
  await expect(field).toHaveValue('1024')

  await settings.getByRole('tab', { name: '外观' }).click()
  await settings.getByRole('radio', { name: '浅色' }).click()
  await expect(settings.locator('html')).toHaveAttribute('data-theme', 'light')
  await settings.getByRole('tab', { name: 'Worktree' }).click()
  await expect(settings.getByRole('textbox', { name: '起始端口' })).toHaveValue('1024')
  await app.close()
})

test('自动化 pane: every automatic review starts off; switches, method, rules and model persist (F13)', async () => {
  const app = await launchApp()
  const settings = await openSettings(app)
  await settings.getByRole('tab', { name: '自动化' }).click()
  const toggles = ['合并前审阅', '推送前审阅', '每轮结束且有新提交时审阅']
  for (const name of toggles) await expect(settings.getByRole('switch', { name })).toHaveAttribute('aria-checked', 'false')
  await settings.getByRole('switch', { name: '合并前审阅' }).click()
  await expect.poll(async () => (await readSettings(settings)).review.beforeMerge).toBe(true)

  await settings.getByRole('radio', { name: '自定义' }).click()
  const rules = settings.getByRole('textbox', { name: '自定义审阅规则' })
  await rules.fill('只看安全问题')
  await rules.blur()
  await expect.poll(async () => (await readSettings(settings)).review.customRules).toBe('只看安全问题')
  const model = settings.getByRole('textbox', { name: 'Claude 审阅模型' })
  await model.fill('bad model!')
  await model.press('Enter')
  await model.fill('haiku')
  await model.press('Enter')
  await expect.poll(async () => (await readSettings(settings)).review.model).toBe('haiku')
  const codexModel = settings.getByRole('textbox', { name: 'Codex 审阅模型' })
  await codexModel.fill('gpt-5.5')
  await codexModel.press('Enter')
  await expect.poll(async () => (await readSettings(settings)).review.codexModel).toBe('gpt-5.5')
  await settings.getByRole('radio', { name: '另一家' }).click()
  await expect.poll(async () => (await readSettings(settings)).review.reviewer).toBe('other')

  const shot = process.env.TR_SCREENSHOT_DIR
  if (shot) {
    for (const theme of ['dark', 'light'] as const) {
      await settings.evaluate((t) => (globalThis as unknown as { tr: { settings: { update(p: unknown): Promise<unknown> } } }).tr.settings.update({ appearance: { theme: t } }), theme)
      await expect(settings.locator('html')).toHaveAttribute('data-theme', theme)
      await settings.waitForTimeout(300)
      await settings.screenshot({ path: `${shot}/settings-automation-${theme}.png` })
    }
  }

  await settings.getByRole('radio', { name: '终端命令' }).click()
  await expect.poll(async () => (await readSettings(settings)).review.mode).toBe('agent-command')
  await expect(settings.getByRole('textbox', { name: 'Claude 审阅模型' })).toHaveCount(0)
  await app.close()
})

test('about pane shows the version and checks for updates', async () => {
  const app = await launchApp()
  const settings = await openSettings(app)
  await settings.getByRole('tab', { name: '关于' }).click()
  await expect(settings.getByTestId('app-version')).not.toBeEmpty()
  await expect(settings.getByRole('button', { name: '检查更新' })).toBeVisible()
  // Panes without content yet are not listed (B11): no 即将推出 dead ends.
  await expect(settings.getByRole('tab')).toHaveText(['外观', '智能体', '额度', 'Worktree', '自动化', '关于'])
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

/** The settings fields of 终端底色 and imported colors, which TrWindow's narrow type does not list. */
async function terminalColors(page: Page) {
  const { appearance } = (await readSettings(page)) as unknown as {
    appearance: { terminalBackground: { mode: string; color: string }; terminalColors: { foreground: string; ansi: string[] } | null }
  }
  return appearance
}

const themeBackground = (page: Page) => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--term-bg').trim())
const previewBackground = (page: Page) =>
  page.evaluate(() => {
    // xterm 6 paints the theme background on its scrollable wrapper.
    const el = document.querySelector('[data-testid="preview-terminal"] .xterm-scrollable-element')
    return el ? getComputedStyle(el).backgroundColor : ''
  })

test('终端底色: 自定义 and an imported Ghostty theme set exactly the colors the terminal shows (F7 v1.71)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wavi-theme-e2e-'))
  const ghostty = join(dir, 'Monokai Pro')
  const palette = ['#262427', '#ff666d', '#b3e03a', '#ffc739', '#00cde8', '#a392e8', '#9deaf6', '#fcfcfa', '#545452', '#ff7e83', '#bee55e', '#ffd05e', '#1bd5eb', '#b0a3eb', '#acedf8', '#fcfcfa']
  writeFileSync(ghostty, `${palette.map((color, i) => `palette = ${i}=${color}`).join('\n')}\nbackground = #262427\nforeground = #fcfcfa\ncursor-color = #fcfcfa\n`)
  const notATheme = join(dir, 'notes.txt')
  writeFileSync(notATheme, 'hello')

  const app = await launchApp()
  const settings = await openSettings(app)
  const hex = settings.getByRole('textbox', { name: '底色值', exact: true })

  // Follows the theme at first: the value shows the theme's color but cannot be edited.
  await expect(hex).toBeDisabled()
  const themeColor = await themeBackground(settings)
  await expect(hex).toHaveValue(themeColor)

  // 自定义: type a color; the terminals (and the preview) show exactly that.
  await settings.getByRole('radio', { name: '自定义' }).click()
  await expect(hex).toBeEnabled()
  await hex.fill('#FDF6E3')
  await hex.press('Enter')
  await expect.poll(async () => (await terminalColors(settings)).terminalBackground).toEqual({ mode: 'custom', color: '#fdf6e3' })
  await expect.poll(() => themeBackground(settings)).toBe('#fdf6e3')
  await expect.poll(() => previewBackground(settings)).toBe('rgb(253, 246, 227)')

  // Back to the theme: the custom color is remembered but no longer in effect.
  await settings.getByRole('radio', { name: '跟随主题' }).click()
  await expect.poll(() => themeBackground(settings)).toBe(themeColor)
  expect((await terminalColors(settings)).terminalBackground).toEqual({ mode: 'theme', color: '#fdf6e3' })

  // 导入主题…: the picker is stubbed to return the file; the background and the colors come from it as they are.
  const stubDialogs = (path: string) =>
    app.evaluate(({ dialog }, file) => {
      const target = globalThis as unknown as { boxes: unknown[] }
      target.boxes = []
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as typeof dialog.showOpenDialog
      dialog.showMessageBox = (async (...args: unknown[]) => {
        target.boxes.push(args)
        return { response: 0, checkboxChecked: false }
      }) as typeof dialog.showMessageBox
    }, path)

  await stubDialogs(notATheme)
  await settings.getByRole('button', { name: '导入主题…' }).click()
  await expect.poll(() => app.evaluate(() => (globalThis as unknown as { boxes: unknown[] }).boxes.length)).toBe(1)
  expect((await terminalColors(settings)).terminalBackground.mode).toBe('theme')

  await stubDialogs(ghostty)
  await settings.getByRole('button', { name: '导入主题…' }).click()
  await expect.poll(async () => (await terminalColors(settings)).terminalBackground).toEqual({ mode: 'custom', color: '#262427' })
  const imported = await terminalColors(settings)
  expect(imported.terminalColors?.ansi).toEqual(palette)
  expect(imported.terminalColors?.foreground).toBe('#fcfcfa')
  await expect(hex).toHaveValue('#262427')
  await expect.poll(() => themeBackground(settings)).toBe('#262427')
  await expect.poll(() => previewBackground(settings)).toBe('rgb(38, 36, 39)')

  // 恢复默认 clears the imported colors and the custom background.
  const reset = settings.getByRole('button', { name: '恢复默认' })
  await reset.scrollIntoViewIfNeeded()
  await reset.click()
  await expect.poll(async () => (await terminalColors(settings)).terminalColors).toBeNull()
  expect((await terminalColors(settings)).terminalBackground.mode).toBe('theme')
  await app.close()
  rmSync(dir, { recursive: true, force: true })
})
