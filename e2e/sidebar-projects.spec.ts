// Project and session entry points in the sidebar (Figma 09 · B–D): hover actions, empty projects, the nav entry,
// and the in-app menus behind ＋ / … / right-click.
import { expect, test, type Locator } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './launch'

/**
 * Hovers until `revealed` is visible. Parallel runs open and close windows under the real cursor, and macOS then
 * sends this window real mouse events that can end a synthetic hover at any moment.
 */
async function hoverUntilVisible(target: Locator, revealed: Locator): Promise<void> {
  await expect(async () => {
    await target.hover()
    await expect(revealed).toBeVisible({ timeout: 500 })
  }).toPass({ timeout: 10_000 })
}

interface Hooks {
  __trWorkspace: { getState(): { addProject(path: string): string } }
}

test('projects stay listed and offer 新建会话; hovering a header reveals ＋ and …', async () => {
  const app = await launchApp()
  const page = await app.firstWindow()
  await page.addInitScript(() => {
    ;(globalThis as unknown as { __TR_E2E__: boolean }).__TR_E2E__ = true
  })
  await page.reload()
  const sidebar = page.locator('[data-region="sidebar"]')

  await expect(sidebar.getByRole('button', { name: /^打开项目… ⌘O$/ })).toBeVisible()
  await expect(sidebar.getByText('新任务')).toHaveCount(0)

  // A project with no sessions is still listed, with a 新建会话 row under it.
  await page.evaluate(() => (globalThis as unknown as Hooks).__trWorkspace.getState().addProject('/tmp/docs-site'))
  const group = sidebar.locator('section[aria-label="docs-site"]')
  await expect(group).toBeVisible()
  await expect(group.getByRole('button', { name: '新建会话', exact: true })).toBeVisible()
  await expect(group.locator('> div').first()).toHaveText('docs-site') // no "0" count on an empty project

  // Actions appear on hover and replace the count.
  const header = sidebar.locator('section[aria-label="acme-web"] > div').first()
  const plus = sidebar.getByRole('button', { name: '在 acme-web 新建会话' })
  await expect(plus).toBeHidden()
  await hoverUntilVisible(header, plus)
  await expect(sidebar.getByRole('button', { name: 'acme-web 项目菜单' })).toBeVisible()
  await page.screenshot({ path: 'test-results/sidebar-projects-hover.png' })

  // ＋ opens the new-session sheet for that project (PRD F4); Esc closes it.
  // Keyboard focus inside the header also shows its actions (:focus-within), so a lost hover can't hide ＋ mid-click.
  await sidebar.getByRole('button', { name: 'acme-web', exact: true }).focus()
  await plus.click()
  const sheet = page.getByTestId('new-session-sheet')
  await expect(sheet.getByRole('button', { name: '项目' })).toHaveText('acme-web')
  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)

  // Right-clicking a session opens its menu at the pointer; hovering 在此新建会话 opens the submenu, which starts
  // another session in the same folder without the sheet.
  const menu = page.getByRole('menu')
  const cookie = sidebar.locator('[data-session-id="s-cookie"]')
  await cookie.click({ button: 'right' })
  await expect(menu.getByRole('menuitem')).toHaveText(['移到新窗口', '关闭会话⌘W', '在此新建会话', '归档 worktree…'])
  const submenu = page.getByRole('menu', { name: '在此新建会话' })
  await hoverUntilVisible(menu.getByRole('menuitem', { name: '在此新建会话' }), submenu)
  await expect(submenu.getByRole('menuitem')).toHaveText(['Claude Code', 'Codex', '终端'])
  await page.screenshot({ path: 'test-results/sidebar-session-context-menu.png' })
  for (const theme of ['light', 'dark'] as const) {
    await page.locator('html').evaluate((html, t) => html.setAttribute('data-theme', t), theme)
    await page.screenshot({ path: `test-results/sidebar-session-context-menu-${theme}.png` })
  }
  // A press outside dismisses it without choosing anything.
  await page.mouse.click(700, 400)
  await expect(page.getByRole('menu')).toHaveCount(0)

  // Sessions stay under their project, whatever their status (PRD §3.3): the error session is in terminal-reborn.
  await expect(sidebar.locator('section[aria-label="terminal-reborn"] [data-session-id="s-graph"]')).toBeVisible()

  // Folding a project hides its rows; the header keeps the count and shows the most urgent attention status.
  const toggle = sidebar.getByRole('button', { name: 'acme-web', exact: true })
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(sidebar.locator('[data-session-id="s-cookie"]')).toHaveCount(0)
  await expect(header.getByRole('img', { name: '已完成' })).toBeVisible()
  await toggle.click()
  await expect(sidebar.locator('[data-session-id="s-cookie"]')).toBeVisible()
  await app.close()
})

interface StatusHooks {
  __trWorkspace: { getState(): { patchSession(id: string, patch: { status: string }): void } }
}

test('会话分组 switches the sidebar to status groups, most urgent first (PRD §3.3, Figma 53C)', async () => {
  const app = await launchApp()
  const page = await app.firstWindow()
  await page.addInitScript(() => {
    ;(globalThis as unknown as { __TR_E2E__: boolean }).__TR_E2E__ = true
  })
  await page.reload()
  const sidebar = page.locator('[data-region="sidebar"]')
  // Fixed statuses: 结算页性能优化 waits for the user; the fixtures have an error, an unread finish and an idle shell.
  await page.evaluate(() => (globalThis as unknown as StatusHooks).__trWorkspace.getState().patchSession('s-perf', { status: 'needs_you' }))

  const button = sidebar.getByRole('button', { name: '会话分组' })
  await button.click()
  const menu = page.getByRole('menu')
  await expect(menu.getByText('分组')).toBeVisible()
  await expect(menu.getByRole('menuitemradio')).toHaveText(['项目', '状态'])
  await expect(menu.getByRole('menuitemradio', { name: '项目' })).toHaveAttribute('aria-checked', 'true')
  for (const theme of ['light', 'dark'] as const) {
    await page.locator('html').evaluate((html, t) => html.setAttribute('data-theme', t), theme)
    await page.screenshot({ path: `test-results/sidebar-group-by-menu-${theme}.png` })
  }
  await menu.getByRole('menuitemradio', { name: '状态' }).click()
  await expect(page.getByRole('menu')).toHaveCount(0)

  // Status groups replace the projects; the first ones are the urgent ones, in the overview's order.
  const sections = sidebar.locator('section')
  await expect(sections.first()).toHaveAttribute('aria-label', '等你处理')
  await expect(sections.nth(1)).toHaveAttribute('aria-label', '出错')
  await expect(sidebar.locator('section[aria-label="acme-web"]')).toHaveCount(0)
  const waiting = sidebar.locator('section[aria-label="等你处理"]')
  await expect(waiting.locator('[data-session-id="s-perf"]')).toContainText('acme-web › jacob/checkout-perf')
  await expect(sidebar.locator('section[aria-label="出错"] [data-session-id="s-graph"]')).toContainText('terminal-reborn › jacob/graph-layout')
  await expect(sidebar.locator('section[aria-label="已完成"] [data-session-id="s-nav"]')).toBeVisible()
  // A status group's header has no ＋ / ….
  await expect(sidebar.getByRole('button', { name: '在 等你处理 新建会话' })).toHaveCount(0)
  for (const theme of ['light', 'dark'] as const) {
    await page.locator('html').evaluate((html, t) => html.setAttribute('data-theme', t), theme)
    await page.screenshot({ path: `test-results/sidebar-by-status-${theme}.png` })
  }

  // A row moves to its new group when its status changes.
  await page.evaluate(() => (globalThis as unknown as StatusHooks).__trWorkspace.getState().patchSession('s-perf', { status: 'running' }))
  await expect(sidebar.locator('section[aria-label="运行中"] [data-session-id="s-perf"]')).toBeVisible()
  await expect(sidebar.locator('section[aria-label="等你处理"]')).toHaveCount(0)

  // Folding a status group hides its rows and shows its count.
  const errors = sidebar.getByRole('button', { name: '出错', exact: true })
  await errors.click()
  await expect(errors).toHaveAttribute('aria-expanded', 'false')
  await expect(sidebar.locator('[data-session-id="s-graph"]')).toHaveCount(0)
  await expect(sidebar.locator('section[aria-label="出错"]')).toContainText('1')
  await errors.click()
  await expect(sidebar.locator('[data-session-id="s-graph"]')).toBeVisible()

  // Back to projects.
  await button.click()
  await page.getByRole('menu').getByRole('menuitemradio', { name: '项目' }).click()
  await expect(sections.first()).toHaveAttribute('aria-label', 'acme-web')
  await app.close()
})

test('the sidebar grouping is kept across restarts', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'tr-e2e-group-by-'))
  let app = await launchApp({}, { userDataDir: profile })
  let page = await app.firstWindow()
  const button = page.locator('[data-region="sidebar"]').getByRole('button', { name: '会话分组' })
  await button.click()
  await page.getByRole('menu').getByRole('menuitemradio', { name: '状态' }).click()
  const file = join(profile, 'workspace.json')
  await expect
    .poll(() => (existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as { sidebarGroupBy?: string }).sidebarGroupBy : undefined), { timeout: 5000 })
    .toBe('status')
  await app.close()

  app = await launchApp({}, { userDataDir: profile })
  page = await app.firstWindow()
  await page.locator('[data-region="sidebar"]').getByRole('button', { name: '会话分组' }).click()
  await expect(page.getByRole('menu').getByRole('menuitemradio', { name: '状态' })).toHaveAttribute('aria-checked', 'true')
  await app.close()
})
