// Project and session entry points in the sidebar (Figma 09 · B–D): hover actions, empty projects, the nav entry,
// and the in-app menus behind ＋ / … / right-click.
import { expect, test, type Locator } from '@playwright/test'
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
  await expect(menu.getByRole('menuitem')).toHaveText(['关闭会话⌘W', '在此新建会话', '归档 worktree…'])
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
