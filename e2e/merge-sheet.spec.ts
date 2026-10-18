// F4 local merge and F13 让 agent 审阅 on a real repository, with a fake `claude` (a shell script first on the login
// shell's PATH via a throwaway ZDOTDIR) that logs every line it reads. Worktrees: jacob/clean (two commits, merges
// cleanly) and jacob/conflict (edits the README that main also edited). Checks the review command reaches the agent,
// a squash merge lands on main and removes the worktree, and a conflict is listed and put into the agent's input line (sent only when the user presses Enter), unmerged.
// Screenshots in both themes go to test-results/merge-sheet/ (compare with Figma 05).
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './launch'

const SHOTS = join(process.cwd(), 'test-results', 'merge-sheet')
const WITHIN = { timeout: 30_000 }

// Reads byte by byte (-icanon) so the log shows what sits in the input line before Enter, which it logs as <ENTER>.
// Control characters are echoed raw (-echoctl), so the paste markers the send protocol writes are swallowed by the
// terminal as escape sequences instead of showing up as ^[[200~, as in the real TUI.
const FAKE_CLAUDE = `#!/bin/sh
stty -echoctl -icanon min 1 2>/dev/null
printf 'Claude Code v9.9.9\\n\\n❯ Try "how does it work?"\\n\\n  ⏸ manual mode on\\n'
nl=$(printf '\\n.'); nl=\${nl%.}
while c=$(dd bs=1 count=1 2>/dev/null; echo .); do
  c=\${c%.}
  [ -z "$c" ] && exit 0
  if [ "$c" = "$nl" ]; then printf '<ENTER>\\n' >> "$TR_FAKE_LOG"; else printf '%s' "$c" >> "$TR_FAKE_LOG"; fi
done
`

function outerClaudeEnv(): Record<string, undefined> {
  const strip: Record<string, undefined> = {}
  for (const key of Object.keys(process.env)) {
    if (key === 'CLAUDECODE' || key.startsWith('CLAUDE_CODE_') || key.startsWith('CLAUDE_AGENT_')) strip[key] = undefined
  }
  return strip
}

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'tr-e2e-merge-'))
  const bin = join(root, 'bin')
  const zdot = join(root, 'zdot')
  const project = join(root, 'demo')
  const clean = join(root, 'wt-clean')
  const conflict = join(root, 'wt-conflict')
  for (const dir of [bin, zdot, project]) mkdirSync(dir)
  writeFileSync(join(bin, 'claude'), FAKE_CLAUDE)
  chmodSync(join(bin, 'claude'), 0o755)
  writeFileSync(join(zdot, '.zshrc'), `export PATH="${bin}:$PATH"\n`)
  const log = join(root, 'claude.log')
  writeFileSync(log, '')

  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.email=e2e@example.com', '-c', 'user.name=e2e', '-c', 'commit.gpgsign=false', ...args], { cwd }).toString()
  const commitIn = (cwd: string, file: string, text: string, message: string) => {
    writeFileSync(join(cwd, file), text)
    git(cwd, 'add', '.')
    git(cwd, 'commit', '-q', '-m', message)
  }
  writeFileSync(join(project, 'README.md'), '# demo\n')
  git(project, 'init', '-q', '-b', 'main')
  git(project, 'add', '.')
  git(project, 'commit', '-q', '-m', 'init')
  for (const [path, branch] of [
    [clean, 'jacob/clean'],
    [conflict, 'jacob/conflict']
  ] as const) {
    git(project, 'worktree', 'add', '-q', '-b', branch, path)
    git(project, 'config', `branch.${branch}.base`, 'main')
  }
  commitIn(clean, 'nav.ts', "export const nav = 'sticky'\n", 'Make nav sticky')
  commitIn(clean, 'nav.test.ts', 'test("nav")\n', 'Test nav')
  commitIn(conflict, 'README.md', '# demo\nfrom the branch\n', 'Branch edits README')
  commitIn(project, 'README.md', '# demo\nfrom main\n', 'Main edits README')
  const env = { ZDOTDIR: zdot, SHELL: '/bin/zsh', TR_FAKE_LOG: log }
  return { env, log, project, clean, conflict, git }
}

test.describe.configure({ mode: 'serial' })
test.setTimeout(90_000)

test.describe('F4 merge sheet · F13 review', () => {
  const profile = mkdtempSync(join(tmpdir(), 'tr-e2e-merge-profile-'))
  const repo = setup()
  let app: ElectronApplication
  let page: Page

  const panel = () => page.locator('[data-region="panel"]')
  const sheet = () => page.getByTestId('merge-sheet')
  const logged = () => readFileSync(repo.log, 'utf8')
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
          { id: 'w-clean', projectId: 'p1', branch: 'jacob/clean', path: repo.clean, isMain: false, baseBranch: 'main' },
          { id: 'w-conflict', projectId: 'p1', branch: 'jacob/conflict', path: repo.conflict, isMain: false, baseBranch: 'main' }
        ],
        sessions: [
          { id: 's-clean', worktreeId: 'w-clean', kind: 'claude', title: '导航吸顶', startedAt: 1, lastActivityAt: 1 },
          { id: 's-conflict', worktreeId: 'w-conflict', kind: 'claude', title: '改 README', startedAt: 2, lastActivityAt: 2 }
        ],
        activeSessionId: 's-clean',
        sidebarCollapsed: false,
        rightPanel: 'git',
        drafts: {}
      })
    )
    app = await launchApp({ ...outerClaudeEnv(), ...repo.env }, { userDataDir: profile })
    page = await app.firstWindow()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 900))
    await expect(page.locator('[data-region="terminal"] .xterm').first()).toBeVisible({ timeout: 20_000 })
  })

  test.afterAll(async () => {
    await app?.close().catch(() => {})
  })

  test('F13: 让 agent 审阅 in Git · 变更 types /code-review into the session', async () => {
    await panel().getByRole('tab', { name: /^变更/ }).click()
    const review = panel().getByRole('button', { name: '让 agent 审阅' })
    // Enabled once the fake agent has drawn its UI.
    await expect(review).toBeEnabled(WITHIN)
    await review.click()
    await expect.poll(logged, WITHIN).toMatch(/code-review.*<ENTER>/s)
  })

  test('F4: a clean branch squashes into main, and the worktree goes with its session', async () => {
    await panel().getByRole('button', { name: /^合并到 main/ }).click()
    await expect(sheet()).toBeVisible()
    await expect(sheet().getByRole('heading')).toHaveText('合并到 main')
    await expect(sheet()).toContainText('jacob/clean')
    await expect(sheet()).toContainText('领先 main 2 个提交')
    await expect(sheet()).toContainText('main 有 1 个新提交，可以自动合并')
    await expect(sheet().getByRole('radio', { name: 'Squash' })).toHaveAttribute('aria-checked', 'true')
    await expect(sheet().getByRole('checkbox', { name: '合并后删除 worktree（保留分支）' })).toHaveAttribute('aria-checked', 'true')
    await expect(sheet().getByRole('checkbox', { name: '合并后推送到 origin' })).toBeDisabled()
    await shoot('05a-clean')

    await sheet().getByRole('button', { name: /^合并/ }).click()
    await expect(sheet()).toContainText('已合并到 main', WITHIN)
    await expect(sheet()).toContainText('已删除 worktree，分支保留')
    await shoot('05b-done')
    await sheet().getByRole('button', { name: /^完成/ }).click()
    await expect(sheet()).toHaveCount(0)

    expect(repo.git(repo.project, 'log', '-1', '--format=%B', 'main').trim()).toBe('导航吸顶\n\n- Make nav sticky\n- Test nav')
    expect(existsSync(join(repo.project, 'nav.ts'))).toBe(true)
    expect(existsSync(repo.clean)).toBe(false)
    expect(repo.git(repo.project, 'branch', '--list', 'jacob/clean').trim()).toBe('jacob/clean')
    await expect(page.locator(`[data-region="sidebar"] [data-session-id="s-clean"]`)).toHaveCount(0)
  })

  test('F4: ⇧⌘M on a conflicting branch lists the files and hands them to the agent; main does not move', async () => {
    await page.locator(`[data-region="sidebar"] [data-session-id="s-conflict"]`).click()
    await expect(page.locator('header h1')).toHaveText('改 README')
    const before = repo.git(repo.project, 'rev-parse', 'main').trim()
    await page.keyboard.press('Meta+Shift+M')
    await expect(sheet()).toBeVisible()
    await expect(sheet()).toContainText('main 有 2 个新提交，与本分支冲突')
    await expect(sheet().getByRole('list', { name: '冲突的文件' })).toContainText('README.md两边都改了同一处')
    await expect(sheet().getByRole('radio', { name: 'Squash' })).toHaveCount(0)

    const handOff = sheet().getByRole('button', { name: /^交给 Claude 解决/ })
    await expect(handOff).toBeVisible()
    await expect(sheet()).toContainText('说明会放进 Claude 的输入行，看过后按回车发送')
    await shoot('05c-conflict')
    await page.keyboard.press('Meta+Enter')
    await expect(sheet()).toHaveCount(0)
    // Put into the input line, not sent: the text arrives without an Enter after it until the user presses one.
    await expect.poll(logged, WITHIN).toContain('完成后告诉我。')
    await page.waitForTimeout(500)
    expect(logged().endsWith('完成后告诉我。') || /完成后告诉我。\x1b\[201~$/.test(logged())).toBe(true)
    expect(logged()).toContain('GIT_EDITOR=true git merge main')
    await page.keyboard.press('Enter')
    await expect.poll(logged, WITHIN).toMatch(/完成后告诉我。(\x1b\[201~)?<ENTER>\n$/)
    expect(repo.git(repo.project, 'rev-parse', 'main').trim()).toBe(before)
  })
})
