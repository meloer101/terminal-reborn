// The main checkout's branch reaches the sidebar's third line and the session header (PRD §3.3, Figma 34P): its
// record starts without one, git is read on launch, and a `git switch` in the checkout shows up — also after the
// Worktree view, which shares the repository watch, opens and closes.
import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './launch'

test.setTimeout(60_000)

test('the main checkout shows its branch and follows a switch', async () => {
  const project = join(realpathSync(mkdtempSync(join(tmpdir(), 'tr-e2e-branch-'))), 'acme-web')
  execFileSync('mkdir', ['-p', project])
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.email=e2e@example.com', '-c', 'user.name=e2e', '-c', 'commit.gpgsign=false', ...args], { cwd: project })
  git('init', '-q', '-b', 'main')
  writeFileSync(join(project, 'a.txt'), 'a\n')
  git('add', '.')
  git('commit', '-q', '-m', 'init')

  const profile = mkdtempSync(join(tmpdir(), 'tr-e2e-branch-sync-'))
  writeFileSync(
    join(profile, 'workspace.json'),
    JSON.stringify({
      version: 2,
      projects: [{ id: 'p1', name: 'acme-web', rootPath: project }],
      // As addProject leaves it before git is read.
      worktrees: [{ id: 'w1', projectId: 'p1', branch: '', path: project, isMain: true }],
      sessions: [{ id: 's1', worktreeId: 'w1', kind: 'shell', title: '分支同步', startedAt: 1, lastActivityAt: 1 }],
      activeSessionId: 's1',
      sidebarCollapsed: false,
      drafts: {}
    })
  )
  const app = await launchApp({}, { userDataDir: profile })
  try {
    const page = await app.firstWindow()
    const row = page.locator('[data-region="sidebar"] [data-session-id="s1"]')
    const header = page.locator('header').first()

    await expect(row).toContainText('main', { timeout: 15_000 })
    await expect(header).toContainText('main')
    await page.screenshot({ path: 'test-results/branch-sync-main.png' })

    git('switch', '-q', '-c', 'jacob/feature')
    await expect(row).toContainText('jacob/feature', { timeout: 10_000 })

    // The Worktree view watches the same repository; closing it must not stop the sidebar's watch.
    const worktreeButton = page.locator('header').getByRole('group', { name: '右侧栏' }).getByRole('button', { name: 'Worktree' })
    await worktreeButton.click()
    await expect(page.locator('[data-region="panel"]')).toContainText('jacob/feature')
    await worktreeButton.click()
    git('switch', '-q', 'main')
    await expect(row).toContainText('main', { timeout: 10_000 })
    await expect(row).not.toContainText('jacob/feature')
  } finally {
    await app.close().catch(() => {})
  }
})
