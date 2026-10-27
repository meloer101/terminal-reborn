// F5 inline review comments in Git · 变更 on a real repository, with the fake `claude` (e2e/fake-claude.ts). A worktree
// with one committed file of three lines: comment on a line, extend a second comment over a range with ⇧-click, edit
// and keep them across a reload, then put them into the agent's input line (not sent until Enter) and discard others.
// Screenshots in both themes go to test-results/review-comments/ (compare with Figma 03).
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fakeClaude } from './fake-claude'
import { launchApp, setWindowSize } from './launch'

const SHOTS = join(process.cwd(), 'test-results', 'review-comments')
const WITHIN = { timeout: 30_000 }

function setup() {
  const fake = fakeClaude('tr-e2e-comments-')
  const project = join(fake.root, 'demo')
  const linked = join(fake.root, 'wt-nav')
  mkdirSync(project)
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.email=e2e@example.com', '-c', 'user.name=e2e', '-c', 'commit.gpgsign=false', ...args], { cwd }).toString()
  writeFileSync(join(project, 'README.md'), '# demo\n')
  git(project, 'init', '-q', '-b', 'main')
  git(project, 'add', '.')
  git(project, 'commit', '-q', '-m', 'init')
  git(project, 'worktree', 'add', '-q', '-b', 'jacob/nav', linked)
  git(project, 'config', 'branch.jacob/nav.base', 'main')
  writeFileSync(join(linked, 'nav.ts'), "const max = document.body.scrollHeight\nconst y = Math.min(scrollY, max)\nexport { y }\n")
  git(linked, 'add', '.')
  git(linked, 'commit', '-q', '-m', 'Clamp scrollY')
  return { ...fake, project, linked }
}

test.describe.configure({ mode: 'serial' })
test.setTimeout(90_000)

test.describe('F5 inline review comments', () => {
  const profile = mkdtempSync(join(tmpdir(), 'tr-e2e-comments-profile-'))
  const repo = setup()
  let app: ElectronApplication
  let page: Page

  const panel = () => page.locator('[data-region="panel"]')
  const line = (n: number) => panel().locator(`[data-owner="committed:nav.ts"][data-line="${n}"]`)
  const comments = () => panel().getByRole('note')
  const editor = () => panel().getByRole('group', { name: '写评论' })
  const addOn = async (n: number, shift = false) => {
    await line(n).hover()
    await line(n).getByRole('button', { name: `评论第 ${n} 行` }).click({ modifiers: shift ? ['Shift'] : [] })
  }
  const openFile = async () => {
    await panel().getByRole('tab', { name: /^变更/ }).click()
    const file = panel().locator('[data-path="nav.ts"][data-group="committed"] button')
    if ((await file.getAttribute('aria-expanded')) !== 'true') await file.click()
    await expect(line(1)).toBeVisible()
  }
  const setTheme = async (theme: 'dark' | 'light') => {
    await page.evaluate(
      (t) => (globalThis as unknown as { tr: { settings: { update(p: unknown): Promise<unknown> } } }).tr.settings.update({ appearance: { theme: t } }),
      theme
    )
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme)
  }
  const shoot = async (name: string) => {
    mkdirSync(SHOTS, { recursive: true })
    for (const theme of ['dark', 'light'] as const) {
      await setTheme(theme)
      await page.waitForTimeout(200)
      await page.screenshot({ path: join(SHOTS, `${name}-${theme}.png`) }).catch(() => undefined)
    }
    await setTheme('dark')
  }

  test.beforeAll(async () => {
    writeFileSync(
      join(profile, 'workspace.json'),
      JSON.stringify({
        version: 2,
        projects: [{ id: 'p1', name: 'demo', rootPath: repo.project }],
        worktrees: [
          { id: 'w-main', projectId: 'p1', branch: 'main', path: repo.project, isMain: true },
          { id: 'w-nav', projectId: 'p1', branch: 'jacob/nav', path: repo.linked, isMain: false, baseBranch: 'main' }
        ],
        sessions: [{ id: 's-nav', worktreeId: 'w-nav', kind: 'claude', title: '修复导航抖动', startedAt: 1, lastActivityAt: 1 }],
        activeSessionId: 's-nav',
        sidebarCollapsed: false,
        rightPanel: 'git',
        drafts: {}
      })
    )
    app = await launchApp(repo.env, { userDataDir: profile })
    page = await app.firstWindow()
    await setWindowSize(app, page, 1440, 900)
    await expect(page.locator('[data-region="terminal"] .xterm').first()).toBeVisible({ timeout: 20_000 })
  })

  test.afterAll(async () => {
    await app?.close().catch(() => {})
  })

  test('a comment on one line, then one over a range with ⇧-click', async () => {
    await openFile()
    await addOn(1)
    await expect(editor()).toBeVisible()
    await page.keyboard.type('窗口尺寸变化后 max 不会更新，改用 ResizeObserver')
    await page.keyboard.press('Meta+Enter')
    await expect(editor()).toHaveCount(0)
    await expect(comments()).toHaveCount(1)
    await expect(comments().first()).toContainText('第 1 行')

    await addOn(2)
    await addOn(3, true)
    await expect(editor()).toContainText('第 2–3 行')
    await page.keyboard.type('y 可能是负数')
    await shoot('03-editor')
    await page.keyboard.press('Meta+Enter')
    await expect(comments()).toHaveCount(2)
    await expect(panel().locator('[data-path="nav.ts"][data-group="committed"]')).toContainText('2')
    await expect(panel().getByRole('button', { name: '发给 Claude · 2' })).toBeVisible()
    await expect(panel().getByRole('button', { name: '审阅全部改动' })).toHaveCount(0)
    await shoot('03-comments')
  })

  test('Esc cancels the editor; comments survive a reload', async () => {
    await addOn(3)
    await page.keyboard.type('不会被保存')
    await page.keyboard.press('Escape')
    await expect(editor()).toHaveCount(0)
    await expect(comments()).toHaveCount(2)

    await page.waitForTimeout(600)
    await page.reload()
    await expect(page.locator('[data-region="terminal"] .xterm').first()).toBeVisible({ timeout: 20_000 })
    await openFile()
    await expect(comments()).toHaveCount(2)
    await expect(panel()).toContainText('y 可能是负数')
  })

  test('发给 Claude puts every comment into the input line; Enter is the user’s', async () => {
    const send = panel().getByRole('button', { name: '发给 Claude · 2' })
    // Enabled once the fake agent has drawn its UI.
    await send.click()
    await expect.poll(repo.typed, WITHIN).toContain('改完后告诉我改了什么。')
    await page.waitForTimeout(500)
    const typed = repo.typed()
    expect(typed.endsWith('改完后告诉我改了什么。')).toBe(true)
    expect(typed).toContain('1. nav.ts:1')
    expect(typed).toContain('2. nav.ts:2-3')
    expect(typed).toContain('y 可能是负数')
    await expect(comments()).toHaveCount(0)
    await expect(panel().getByRole('button', { name: '审阅全部改动' })).toBeVisible()
  })

  test('放弃 asks, then removes the comments', async () => {
    await openFile()
    await addOn(1)
    await page.keyboard.type('先不要了')
    await page.keyboard.press('Meta+Enter')
    await expect(comments()).toHaveCount(1)
    await panel().getByRole('button', { name: '放弃' }).click()
    await expect(comments()).toHaveCount(0)
    const asked = await app.evaluate(() => (globalThis as unknown as { __trDialogs: { requests: { message: string }[] } }).__trDialogs.requests.map((r) => r.message))
    expect(asked).toContain('放弃 1 条评论？')
  })
})
