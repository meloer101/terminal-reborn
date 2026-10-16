// Phase 2b P0 (docs/acceptance/ux-review-2026-10-15.md §2): every place the user can click has a next step.
//  - B10 first run: main shows a centred empty state (open project, recent folders, installed agents), no composer.
//  - B11 dead controls: no panel toggle, the header … is a real menu (rename, close), settings lists only real panes.
//  - B13 layout: at the 960×600 minimum the right panel floats over main instead of squeezing it; it has ✕.
// Screenshots of each state in both themes at 1440×900 and 960×600 go to test-results/no-dead-ends/.
// `claude` is a fake script on a throwaway ZDOTDIR PATH (same trick as agent-lifecycle.spec.ts); `codex` is absent.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { launchApp } from './launch'

const SHOTS = join(process.cwd(), 'test-results', 'no-dead-ends')
const SIZES = [
  [1440, 900],
  [960, 600]
] as const
const THEMES = ['dark', 'light'] as const

const FAKE_CLAUDE = `#!/bin/sh
printf 'Claude Code v9.9.9\\n\\n❯ Try "how does it work?"\\n'
while read -r line; do
  [ "$line" = "/exit" ] && exit 0
done
`

function outerClaudeEnv(): Record<string, undefined> {
  const strip: Record<string, undefined> = {}
  for (const key of Object.keys(process.env)) {
    if (key === 'CLAUDECODE' || key.startsWith('CLAUDE_CODE_') || key.startsWith('CLAUDE_AGENT_')) strip[key] = undefined
  }
  return strip
}

function fakeAgentEnv(): { env: Record<string, string | undefined>; project: string; profile: string } {
  const root = mkdtempSync(join(tmpdir(), 'tr-e2e-dead-ends-'))
  const bin = join(root, 'bin')
  const zdot = join(root, 'zdot')
  const project = join(root, 'acme-web')
  const profile = join(root, 'profile')
  for (const dir of [bin, zdot, project, profile]) mkdirSync(dir)
  writeFileSync(join(bin, 'claude'), FAKE_CLAUDE)
  chmodSync(join(bin, 'claude'), 0o755)
  // A fixed PATH: claude is installed, codex is not, whatever the machine has.
  writeFileSync(join(zdot, '.zshrc'), `export PATH="${bin}:/usr/bin:/bin"\n`)
  return { env: { ...outerClaudeEnv(), ZDOTDIR: zdot, SHELL: '/bin/zsh' }, project, profile }
}

const setSize = (app: ElectronApplication, width: number, height: number) =>
  app.evaluate(
    ({ BrowserWindow }, [w, h]) => {
      BrowserWindow.getAllWindows()[0]?.setSize(w!, h!)
    },
    [width, height]
  )

const setTheme = async (page: Page, theme: 'dark' | 'light') => {
  await page.evaluate(
    (t) => (globalThis as unknown as { tr: { settings: { update(p: unknown): Promise<unknown> } } }).tr.settings.update({ appearance: { theme: t } }),
    theme
  )
  await expect
    .poll(() => page.evaluate(() => (globalThis as unknown as { document: { documentElement: { dataset: { theme?: string } } } }).document.documentElement.dataset.theme))
    .toBe(theme)
}

/** One screenshot per size × theme; ends at 1440×900, dark. */
async function shootAll(app: ElectronApplication, page: Page, name: string, check?: () => Promise<void>): Promise<void> {
  for (const [w, h] of SIZES) {
    await setSize(app, w, h)
    await expect.poll(() => page.evaluate(() => (globalThis as unknown as { innerWidth: number }).innerWidth)).toBeLessThanOrEqual(w)
    await check?.()
    for (const theme of THEMES) {
      await setTheme(page, theme)
      await page.waitForTimeout(250)
      await page.screenshot({ path: join(SHOTS, `${name}-${w}x${h}-${theme}.png`) })
    }
  }
  await setSize(app, 1440, 900)
  await setTheme(page, 'dark')
}

const mainWidth = (page: Page) => page.locator('[data-region="main"]').evaluate((el) => el.getBoundingClientRect().width)

test.describe.configure({ mode: 'serial' })
test.setTimeout(90_000)

test.describe('first run and the session header', () => {
  const { env, project, profile } = fakeAgentEnv()
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async () => {
    // A workspace that remembers one folder but has no projects or sessions left.
    writeFileSync(
      join(profile, 'workspace.json'),
      JSON.stringify({
        version: 2,
        projects: [],
        worktrees: [],
        sessions: [],
        activeSessionId: null,
        sidebarCollapsed: false,
        rightPanel: null,
        drafts: {},
        recentProjects: [project]
      })
    )
    app = await launchApp(env, { userDataDir: profile })
    page = await app.firstWindow()
  })

  test.afterAll(async () => {
    await app.close()
  })

  test('B10: empty main offers open project, recent folders and agent status', async () => {
    const empty = page.getByTestId('empty-main')
    await expect(empty).toBeVisible()
    await expect(empty.getByRole('button', { name: /打开项目… ⌘O/ })).toBeVisible()
    await expect(empty.getByRole('button', { name: new RegExp(basename(project)) })).toBeVisible()
    await expect(empty.locator('[data-agent="claude"]')).toContainText('已安装')
    await expect(empty.locator('[data-agent="codex"]')).toContainText('未安装')
    await expect(empty.locator('[data-agent="codex"]')).toContainText('npm install -g @openai/codex')
    await expect(empty).toContainText('也可以把文件夹拖到这里打开')
    // The header controls that had nothing to do are gone.
    await expect(page.getByRole('button', { name: '变更面板' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '会话菜单' })).toHaveCount(0)
    await shootAll(app, page, 'b10-first-run', async () => {
      await expect(empty.getByRole('button', { name: /打开项目… ⌘O/ })).toBeInViewport()
    })
  })

  test('B10: a recent folder opens as a project with a Claude session', async () => {
    await page.getByTestId('empty-main').getByRole('button', { name: new RegExp(basename(project)) }).click()
    await expect(page.getByTestId('empty-main')).toHaveCount(0)
    await expect(page.locator('[data-region="sidebar"]')).toContainText(basename(project))
    await expect(page.locator('[data-region="terminal"] .xterm').first()).toBeVisible({ timeout: 20_000 })
  })

  test('B11: the header … menu renames and closes the session', async () => {
    await app.evaluate(() => {
      ;(globalThis as unknown as { __trDialogs: { menuAnswers: string[] } }).__trDialogs.menuAnswers.push('rename')
    })
    await page.getByRole('button', { name: '会话菜单' }).click()
    const field = page.getByRole('textbox', { name: '会话名称' })
    await expect(field).toBeFocused()
    await field.fill('迁移会话 cookie')
    await field.press('Enter')
    await expect(page.locator('[data-region="main"] h1')).toHaveText('迁移会话 cookie')
    await expect(page.locator('[data-region="sidebar"]')).toContainText('迁移会话 cookie')
    const menus = await app.evaluate(
      () => (globalThis as unknown as { __trDialogs: { menus: Array<Array<{ type: string; label?: string }>> } }).__trDialogs.menus
    )
    expect(menus.at(-1)?.filter((e) => e.type === 'item').map((e) => e.label)).toEqual(['重命名…', '在 Finder 中显示', '复制路径', '关闭会话'])

    // Esc cancels a rename.
    await page.locator('[data-region="main"] h1').dblclick()
    await page.getByRole('textbox', { name: '会话名称' }).fill('不要')
    await shootAll(app, page, 'b11-header-rename')
    await page.getByRole('textbox', { name: '会话名称' }).focus()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-region="main"] h1')).toHaveText('迁移会话 cookie')

    await app.evaluate(() => {
      ;(globalThis as unknown as { __trDialogs: { menuAnswers: string[] } }).__trDialogs.menuAnswers.push('close')
    })
    await page.getByRole('button', { name: '会话菜单' }).click()
    // Every session closed: the empty state is back, now listing the project that is still open.
    await expect(page.getByTestId('empty-main')).toBeVisible()
  })
})

test('B11: settings lists only panes with content', async () => {
  const app = await launchApp()
  const page = await app.firstWindow()
  await page.waitForSelector('[data-region="sidebar"]')
  await page.evaluate(() => (globalThis as unknown as { tr: { ui: { openSettings(): void } } }).tr.ui.openSettings())
  const dialog = page.getByRole('dialog', { name: '设置' })
  await expect(dialog.getByRole('tab')).toHaveText(['外观', '关于'])
  await expect(dialog.getByText('即将推出')).toHaveCount(0)
  await shootAll(app, page, 'b11-settings')
  await app.close()
})

test.describe('B13: right panel at the minimum window', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async () => {
    app = await launchApp()
    page = await app.firstWindow()
    await page.addInitScript(() => {
      ;(globalThis as unknown as { __TR_E2E__: boolean; __TR_PANEL__: boolean }).__TR_E2E__ = true
      ;(globalThis as unknown as { __TR_PANEL__: boolean }).__TR_PANEL__ = true
    })
    await page.reload()
    await expect(page.locator('[data-region="terminal"] .xterm').first()).toBeVisible({ timeout: 20_000 })
  })

  test.afterAll(async () => {
    await app.close()
  })

  test('the panel docks when there is room, floats over main when there is not, and closes with ✕', async () => {
    const panel = page.locator('[data-region="panel"]')
    await page.getByRole('button', { name: '变更面板' }).click()
    await expect(panel).toBeVisible()
    for (const [w, h] of SIZES) {
      await setSize(app, w, h)
      await expect.poll(() => page.evaluate(() => (globalThis as unknown as { innerWidth: number }).innerWidth)).toBeLessThanOrEqual(w)
      const width = await page.evaluate(() => (globalThis as unknown as { innerWidth: number }).innerWidth)
      await expect(panel).toHaveAttribute('data-mode', width >= 264 + 440 + 560 ? 'docked' : 'overlay')
      expect(await mainWidth(page)).toBeGreaterThanOrEqual(560)
      await expect(panel.getByRole('button', { name: '关闭面板' })).toBeInViewport()
    }
    // Graph is wider: at 960 it floats too.
    await panel.getByRole('tab', { name: '图谱' }).click()
    await expect(panel).toHaveAttribute('data-mode', 'overlay')
    await panel.getByRole('tab', { name: '变更' }).click()
    await shootAll(app, page, 'b13-panel')
    await panel.getByRole('button', { name: '关闭面板' }).click()
    await expect(panel).toHaveCount(0)
  })
})
