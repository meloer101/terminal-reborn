// Project and session entry points in the sidebar (Figma 09 · B–D). Native menus can't be driven
// from Playwright, so this covers what is visible: hover actions, empty projects, the nav entry.
import { expect, test } from '@playwright/test'
import { launchApp } from './launch'

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
  await expect(group.locator('h2 + span')).toHaveCount(0) // no "0" count on an empty project

  // Actions appear on hover and replace the count.
  const header = sidebar.locator('section[aria-label="acme-web"] > div').first()
  const plus = sidebar.getByRole('button', { name: '在 acme-web 新建会话' })
  await expect(plus).toBeHidden()
  await header.hover()
  await expect(plus).toBeVisible()
  await expect(sidebar.getByRole('button', { name: 'acme-web 项目菜单' })).toBeVisible()
  await page.screenshot({ path: 'test-results/sidebar-projects-hover.png' })

  // The 等你处理 queue header has no actions.
  const queueHeader = sidebar.locator('section[aria-label="等你处理"] > div').first()
  await queueHeader.hover()
  await expect(queueHeader.getByRole('button')).toHaveCount(0)
  await app.close()
})
