// 合入链路 v2 (PRD v1.169, Figma section 73) end to end: the merge chain in Git · 变更 on real repositories with a local
// bare remote, the fake hook agent (e2e/fake-hook-claude.ts; the test plays it by writing the handoff file, e2e/ship.ts)
// and a fake gh (e2e/fake-gh.ts). Two launches:
//   gh signed out — origin's fetch URL says github.com (never fetched), its push URL is a bare repository:
//     jacob/tidy — one commit, two uncommitted files: 创建 PR blocked before anything is written, exit A still runs
//   gh ready — project `demo` (origin is a bare repository, not GitHub) and project `widget` (origin on github.com):
//     jacob/pick     three uncommitted files: ⌘K's Git group, 提交… commits only the ticked ones
//     jacob/sync     never pushed, main moved past it without conflicts: ⋯ → 同步 main rebases it
//     jacob/conflict never pushed, edits README.md as main did: 和 main 会冲突, 同步 main → 交给 Claude (no Enter)
//     jacob/rebase   a rebase left stopped on README.md: 中止 restores the branch
//     jacob/push     pushed, a local commit, the remote branch moved meanwhile: 推送 is refused, 拉取 is offered
//     jacob/done     fast-forwarded into main: 已经全部合并到 main, 归档… opens the sheet
//     widget jacob/pr  PR #12 open; gh's PR list starts failing: `#12 ? 查询失败` in the sidebar and the PR line
// Screenshots of the right sidebar in both themes go to SHIP_CHAIN_SHOTS (default test-results/ship-chain/).
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fakeGh } from './fake-gh'
import { fakeHookClaude, type FakeAgentFolder } from './fake-hook-claude'
import { launchApp, setWindowSize } from './launch'
import { agentWrites, promptedPath, typedBy } from './ship'

const SHOTS = process.env.SHIP_CHAIN_SHOTS ?? join(process.cwd(), 'test-results', 'ship-chain')
const WITHIN = { timeout: 30_000 }

const gitIn = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.email=e2e@example.com', '-c', 'user.name=e2e', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    env: { ...process.env, GIT_EDITOR: 'true' },
    stdio: ['ignore', 'pipe', 'pipe']
  }).toString()

function commitIn(cwd: string, file: string, text: string, message: string): void {
  writeFileSync(join(cwd, file), text)
  gitIn(cwd, 'add', '.')
  gitIn(cwd, 'commit', '-q', '-m', message)
}

/** A project with a README and the fake agent's files ignored, on main. */
function newProject(root: string, name: string): string {
  const project = join(root, name)
  mkdirSync(project)
  writeFileSync(join(project, 'README.md'), '# demo\n')
  writeFileSync(join(project, '.gitignore'), '.fake-*\n')
  gitIn(project, 'init', '-q', '-b', 'main')
  gitIn(project, 'add', '.')
  gitIn(project, 'commit', '-q', '-m', 'init')
  return project
}

function addWorktree(project: string, path: string, branch: string): void {
  gitIn(project, 'worktree', 'add', '-q', '-b', branch, path)
  gitIn(project, 'config', `branch.${branch}.base`, 'main')
}

type Theme = 'dark' | 'light'

/** Shared page helpers for both launches. */
function pageKit(get: () => Page) {
  const panel = () => get().locator('[data-region="panel"]')
  const ship = () => panel().getByTestId('ship-block')
  const headline = () => panel().getByTestId('chain-headline')
  const setTheme = async (theme: Theme) => {
    await get().evaluate(
      (t) => (globalThis as unknown as { tr: { settings: { update(p: unknown): Promise<unknown> } } }).tr.settings.update({ appearance: { theme: t } }),
      theme
    )
    await expect.poll(() => get().evaluate(() => document.documentElement.dataset.theme)).toBe(theme)
  }
  /** The right sidebar in both themes (`<name>-dark.png`, `<name>-light.png`); `whole`: the window (⌘K). */
  const shoot = async (name: string, whole = false) => {
    mkdirSync(SHOTS, { recursive: true })
    for (const theme of ['dark', 'light'] as const) {
      await setTheme(theme)
      await get().waitForTimeout(250)
      const path = join(SHOTS, `${name}-${theme}.png`)
      await (whole ? get().screenshot({ path }) : panel().screenshot({ path })).catch(() => undefined)
    }
    await setTheme('dark')
  }
  const open = async (sessionId: string) => {
    await get().locator(`[data-region="sidebar"] [data-session-id="${sessionId}"]`).click()
    const tab = panel().getByRole('tab', { name: /^变更/ })
    if (!(await tab.isVisible())) await get().locator('header').getByRole('group', { name: '右侧栏' }).getByRole('button', { name: 'Git' }).click()
    await tab.click()
  }
  const menuItem = (name: RegExp) => get().getByRole('menu').getByRole('menuitem', { name })
  return { panel, ship, headline, shoot, open, menuItem }
}

test.describe.configure({ mode: 'serial' })
test.setTimeout(120_000)

test.describe('合入链路 v2 · gh signed out', () => {
  const profile = mkdtempSync(join(tmpdir(), 'tr-e2e-chain2-out-'))
  const fake = fakeHookClaude('tr-e2e-chain2-out-')
  const gh = fakeGh(join(fake.root, 'bin'), join(fake.root, 'gh'))
  const bare = join(fake.root, 'origin.git')
  const project = newProject(fake.root, 'demo')
  const tidy = join(fake.root, 'wt-tidy')
  gitIn(fake.root, 'init', '-q', '--bare', '-b', 'main', bare)
  gitIn(project, 'remote', 'add', 'origin', 'https://github.com/acme/widget.git')
  gitIn(project, 'config', 'remote.origin.pushurl', bare)
  // No upstream for main: exit A has nothing to fetch from github.com.
  gitIn(project, 'push', '-q', 'origin', 'main')
  addWorktree(project, tidy, 'jacob/tidy')
  commitIn(tidy, 'tidy.ts', 'export const tidy = 1\n', 'Add tidy')
  writeFileSync(join(tidy, 'a.ts'), 'export const a = 1\n')
  writeFileSync(join(tidy, 'b.ts'), 'export const b = 1\n')
  const agent = fake.folder('wt-tidy')
  gh.setSignedOut(true)

  let app: ElectronApplication
  let page: Page
  const kit = pageKit(() => page)

  test.beforeAll(async () => {
    writeFileSync(
      join(profile, 'workspace.json'),
      JSON.stringify({
        version: 2,
        projects: [{ id: 'p1', name: 'demo', rootPath: project }],
        worktrees: [
          { id: 'w-main', projectId: 'p1', branch: 'main', path: project, isMain: true },
          { id: 'w-tidy', projectId: 'p1', branch: 'jacob/tidy', path: tidy, isMain: false, baseBranch: 'main' }
        ],
        sessions: [{ id: 's-tidy', worktreeId: 'w-tidy', kind: 'claude', title: '整理', startedAt: 1, lastActivityAt: 1 }],
        activeSessionId: 's-tidy',
        sidebarCollapsed: false,
        rightPanel: 'git',
        drafts: {}
      })
    )
    app = await launchApp({ ...fake.env, ...gh.env, CLAUDE_CONFIG_DIR: join(fake.root, 'claude-config') }, { userDataDir: profile })
    page = await app.firstWindow()
    await setWindowSize(app, page, 1440, 900)
    await expect(page.locator('[data-region="terminal"] .xterm').first()).toBeVisible({ timeout: 20_000 })
    await expect.poll(() => agent.pid(), WITHIN).not.toBeNull()
  })

  test.afterAll(async () => {
    await app?.close().catch(() => {})
  })

  test('(b) the state line says gh is signed out; 创建 PR is blocked before anything is written; 合并到 main 并推送 still runs', async () => {
    await kit.open('s-tidy')
    await expect(kit.headline()).toContainText('gh 还没有登录', WITHIN)
    await expect(kit.headline()).toContainText('在终端运行 gh auth login 后可以创建 PR')
    const createPr = kit.panel().getByRole('button', { name: /^创建 PR/ })
    await expect(createPr).toBeDisabled()
    await kit.shoot('b')
    // Nothing went to the agent for a PR.
    expect(typedBy(agent)).not.toContain('pr.md')

    await kit.panel().getByRole('button', { name: /^合并到 main 并推送/ }).click()
    const file = await promptedPath(agent, 'wt-tidy', 'commit')
    agentWrites(agent, file, 'chore: tidy up\n')
    await expect(kit.ship()).toHaveAttribute('data-stage', 'glance', WITHIN)
    await expect(kit.ship().locator('[data-step="commit"]')).toHaveText(/提交/)
    await page.keyboard.press('Meta+Enter')
    await expect(kit.ship()).toHaveCount(0, WITHIN)
    expect(gitIn(project, 'log', '-1', '--format=%s', 'main').trim()).toBe('chore: tidy up')
    // Pushed to the bare repository (the push URL), not to github.com.
    expect(gitIn(bare, 'log', '-1', '--format=%s', 'main').trim()).toBe('chore: tidy up')
  })
})

test.describe('合入链路 v2 · gh ready', () => {
  const profile = mkdtempSync(join(tmpdir(), 'tr-e2e-chain2-'))
  const fake = fakeHookClaude('tr-e2e-chain2-')
  const gh = fakeGh(join(fake.root, 'bin'), join(fake.root, 'gh'))
  const bare = join(fake.root, 'origin.git')
  const project = newProject(fake.root, 'demo')
  gitIn(fake.root, 'init', '-q', '--bare', '-b', 'main', bare)
  gitIn(project, 'remote', 'add', 'origin', bare)
  gitIn(project, 'push', '-q', '-u', 'origin', 'main')

  const wt = (name: string) => join(fake.root, `wt-${name}`)
  for (const name of ['pick', 'sync', 'conflict', 'rebase', 'push', 'done']) addWorktree(project, wt(name), `jacob/${name}`)
  commitIn(wt('pick'), 'pick.ts', 'export {}\n', 'Add pick')
  for (const name of ['a', 'b', 'c']) writeFileSync(join(wt('pick'), `${name}.ts`), `export const ${name} = 1\n`)
  commitIn(wt('sync'), 'sync.ts', 'export const sync = 1\n', 'Add sync')
  commitIn(wt('conflict'), 'README.md', '# demo\nfrom the branch\n', 'Branch edits README')
  commitIn(wt('rebase'), 'README.md', '# demo\nfrom the rebase branch\n', 'Rebase branch edits README')
  commitIn(wt('done'), 'done.ts', 'export const done = 1\n', 'Add done')
  // jacob/done lands on main by fast-forward; then main moves on.
  gitIn(project, 'merge', '-q', '--ff-only', 'jacob/done')
  commitIn(project, 'main.ts', 'export const main = 1\n', 'Main adds main.ts')
  commitIn(project, 'README.md', '# demo\nfrom main\n', 'Main edits README')
  gitIn(project, 'push', '-q', 'origin', 'main')
  // jacob/rebase stops on README.md.
  try {
    gitIn(wt('rebase'), 'rebase', 'main')
  } catch {
    // The conflict is the point.
  }
  const rebaseHead = gitIn(wt('rebase'), 'rev-parse', 'jacob/rebase').trim()
  // jacob/push: pushed, then a local commit; another clone moves the remote branch.
  commitIn(wt('push'), 'push.ts', 'export const push = 1\n', 'Add push')
  gitIn(wt('push'), 'push', '-q', '-u', 'origin', 'jacob/push')
  commitIn(wt('push'), 'push.ts', 'export const push = 2\n', 'Local push change')
  // Another clone moves the remote branch in test (f), after 同步 (c) fetched: the window does not know.
  const other = join(fake.root, 'other')
  gitIn(fake.root, 'clone', '-q', '-b', 'jacob/push', bare, other)

  // widget: origin on github.com (its push URL a bare repository), PR #12 open for jacob/pr.
  const widgetBare = join(fake.root, 'widget.git')
  const widget = newProject(fake.root, 'widget')
  gitIn(fake.root, 'init', '-q', '--bare', '-b', 'main', widgetBare)
  gitIn(widget, 'remote', 'add', 'origin', 'https://github.com/acme/widget.git')
  gitIn(widget, 'config', 'remote.origin.pushurl', widgetBare)
  gitIn(widget, 'push', '-q', 'origin', 'main')
  const prPath = join(fake.root, 'wt-pr')
  addWorktree(widget, prPath, 'jacob/pr')
  commitIn(prPath, 'pr.ts', 'export {}\n', 'Add pr')
  gitIn(prPath, 'push', '-q', '-u', 'origin', 'jacob/pr')
  gh.setPrs('jacob/pr', [{ number: 12, state: 'OPEN', checks: [{ name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }] }])

  const agents: Record<string, FakeAgentFolder> = {}
  for (const name of ['pick', 'sync', 'conflict', 'rebase', 'push', 'done']) agents[name] = fake.folder(`wt-${name}`)
  agents.pr = fake.folder('wt-pr')

  let app: ElectronApplication
  let page: Page
  const kit = pageKit(() => page)

  test.beforeAll(async () => {
    const worktree = (name: string) => ({ id: `w-${name}`, projectId: 'p1', branch: `jacob/${name}`, path: wt(name), isMain: false, baseBranch: 'main' })
    const session = (name: string, title: string, at: number) => ({ id: `s-${name}`, worktreeId: `w-${name}`, kind: 'claude', title, startedAt: at, lastActivityAt: at })
    writeFileSync(
      join(profile, 'workspace.json'),
      JSON.stringify({
        version: 2,
        projects: [
          { id: 'p1', name: 'demo', rootPath: project },
          { id: 'p2', name: 'widget', rootPath: widget }
        ],
        worktrees: [
          { id: 'w-main', projectId: 'p1', branch: 'main', path: project, isMain: true },
          ...['pick', 'sync', 'conflict', 'rebase', 'push', 'done'].map(worktree),
          { id: 'w-widget', projectId: 'p2', branch: 'main', path: widget, isMain: true },
          { id: 'w-pr', projectId: 'p2', branch: 'jacob/pr', path: prPath, isMain: false, baseBranch: 'main' }
        ],
        sessions: [
          session('pick', '挑文件提交', 1),
          session('sync', '跟上主干', 2),
          session('conflict', '改 README', 3),
          session('rebase', '变基中', 4),
          session('push', '推送被拒', 5),
          session('done', '已合并', 6),
          session('pr', '有 PR', 7)
        ],
        activeSessionId: 's-pick',
        sidebarCollapsed: false,
        rightPanel: 'git',
        drafts: {}
      })
    )
    app = await launchApp({ ...fake.env, ...gh.env, CLAUDE_CONFIG_DIR: join(fake.root, 'claude-config') }, { userDataDir: profile })
    page = await app.firstWindow()
    await setWindowSize(app, page, 1440, 900)
    await expect(page.locator('[data-region="terminal"] .xterm').first()).toBeVisible({ timeout: 20_000 })
    await expect.poll(() => agents.pick!.pid(), WITHIN).not.toBeNull()
  })

  test.afterAll(async () => {
    await app?.close().catch(() => {})
  })

  test('(a) an unticked file stays out: 提交… commits only the ticked ones', async () => {
    await kit.open('s-pick')
    await kit.panel().getByRole('checkbox', { name: '提交 c.ts' }).click()
    await expect(kit.panel().getByRole('checkbox', { name: '提交 c.ts' })).toHaveAttribute('aria-checked', 'false')
    const header = kit.panel().getByRole('checkbox', { name: /全部未提交的文件|不提交未提交的文件/ })
    await expect(header).toHaveAttribute('aria-checked', 'mixed')
    await expect(kit.panel()).toContainText('3 个文件 · 勾选 2 个')
    // The preflight is in (a remote that is not on GitHub blocks 创建 PR, said on the state line).
    await expect(kit.headline()).toContainText('远程不在 GitHub 上', WITHIN)
    await kit.panel().getByTestId('chain-menu').click()
    await kit.menuItem(/^提交…/).click()
    await expect(kit.ship()).toContainText('提交 2 个文件')
    const file = await promptedPath(agents.pick!, 'wt-pick', 'commit')
    agentWrites(agents.pick!, file, 'feat: a and b\n')
    await expect(kit.ship()).toHaveAttribute('data-stage', 'glance', WITHIN)
    await expect(kit.ship().getByRole('textbox', { name: '提交说明' })).toHaveValue('feat: a and b')
    await kit.shoot('a')
    await page.keyboard.press('Meta+Enter')
    await expect(kit.ship()).toHaveCount(0, WITHIN)
    const committed = gitIn(wt('pick'), 'show', '--name-only', '--format=%s', 'HEAD').trim().split('\n')
    expect(committed[0]).toBe('feat: a and b')
    expect(committed.slice(1).filter(Boolean).sort()).toEqual(['a.ts', 'b.ts'])
    expect(gitIn(wt('pick'), 'status', '--porcelain')).toContain('c.ts')
  })

  test('(g) ⌘K lists the active worktree’s Git group; 提交… starts the run in Git · 变更', async () => {
    // c.ts was left out of the last commit: tick it again, so 提交… can run.
    await kit.panel().getByRole('checkbox', { name: '提交 c.ts' }).click()
    await expect(kit.panel().getByRole('checkbox', { name: '提交 c.ts' })).toHaveAttribute('aria-checked', 'true')
    await page.keyboard.press('Meta+k')
    const palette = page.getByTestId('command-palette')
    await expect(palette).toContainText('Git · jacob/pick', WITHIN)
    const commit = palette.getByRole('option', { name: /^提交…/ })
    await expect(commit).toContainText('1 个文件')
    // Only what can run: 拉取 (never pushed) is not offered.
    await expect(palette.getByRole('option', { name: /^拉取/ })).toHaveCount(0)
    await kit.shoot('g', true)
    await commit.click()
    await expect(kit.ship()).toBeVisible(WITHIN)
    await expect(kit.ship()).toContainText('提交 1 个文件')
    await kit.ship().getByRole('button', { name: '取消' }).click()
    await expect(kit.ship()).toHaveCount(0)
  })

  test('(c) ⋯ → 同步 main rebases a branch that was never pushed', async () => {
    await kit.open('s-sync')
    await expect(kit.headline()).toContainText('远程不在 GitHub 上', WITHIN)
    await kit.panel().getByTestId('chain-menu').click()
    const sync = kit.menuItem(/^同步 main/)
    await expect(sync).not.toHaveAttribute('aria-disabled', 'true', WITHIN)
    // The menu as Figma 73B draws it: blocked items say why.
    await expect(kit.menuItem(/^拉取/)).toHaveAttribute('aria-disabled', 'true')
    await expect(kit.menuItem(/^拉取/)).toContainText('分支还没有推送过')
    await kit.shoot('c-menu')
    await sync.click()
    await expect.poll(() => {
      try {
        gitIn(wt('sync'), 'merge-base', '--is-ancestor', 'main', 'jacob/sync')
        return true
      } catch {
        return false
      }
    }, WITHIN).toBe(true)
    await expect(kit.ship()).toHaveCount(0, WITHIN)
    await expect(kit.panel().getByTestId('pr-status')).toContainText('已同步 main')
    // A rebase, not a merge: no merge commit on the branch.
    expect(gitIn(wt('sync'), 'log', '--merges', '--format=%H', 'main..jacob/sync').trim()).toBe('')
    await kit.shoot('c')
  })

  test('(d) 和 main 会冲突: 同步 main starts nothing and 交给 Claude puts the rebase into the input line without Enter', async () => {
    await kit.open('s-conflict')
    await expect.poll(() => agents.conflict!.pid(), WITHIN).not.toBeNull()
    const before = gitIn(wt('conflict'), 'rev-parse', 'HEAD').trim()
    await expect(kit.headline()).toContainText('和 main 会冲突 · 1 个文件', WITHIN)
    await expect(kit.panel().getByTestId('chain-files')).toHaveText('README.md')
    await kit.shoot('d-headline')
    await kit.panel().getByRole('button', { name: /^同步 main/ }).click()
    await expect(kit.ship().getByRole('alert')).toContainText('rebase 会冲突 · README.md', WITHIN)
    await kit.shoot('d')
    expect(gitIn(wt('conflict'), 'rev-parse', 'HEAD').trim()).toBe(before)
    await kit.ship().getByRole('button', { name: '交给 Claude' }).click()
    await expect(kit.ship()).toHaveCount(0, WITHIN)
    await expect.poll(() => typedBy(agents.conflict!), WITHIN).toContain('GIT_EDITOR=true git rebase main')
    await page.waitForTimeout(500)
    // In the input line, not sent.
    expect(typedBy(agents.conflict!)).not.toMatch(/不要推送。<ENTER>/)
    expect(typedBy(agents.conflict!).trimEnd().endsWith('不要推送。')).toBe(true)
  })

  test('(e) a rebase left in progress: 中止 restores the branch', async () => {
    await kit.open('s-rebase')
    await expect(kit.headline()).toContainText('rebase 进行中 · 1 个文件有冲突', WITHIN)
    await expect(kit.panel().getByTestId('chain-files')).toHaveText('README.md')
    await expect(kit.panel().getByRole('button', { name: '交给 Claude' })).toBeEnabled()
    await kit.shoot('e')
    await kit.panel().getByRole('button', { name: '中止', exact: true }).click()
    await expect.poll(() => gitIn(wt('rebase'), 'rev-parse', '--abbrev-ref', 'HEAD').trim(), WITHIN).toBe('jacob/rebase')
    expect(gitIn(wt('rebase'), 'rev-parse', 'HEAD').trim()).toBe(rebaseHead)
    await expect(kit.headline()).not.toContainText('rebase 进行中', WITHIN)
  })

  test('(f) a push refused by a remote that moved: the step says so and offers 拉取', async () => {
    commitIn(other, 'elsewhere.ts', 'export {}\n', 'Pushed from elsewhere')
    gitIn(other, 'push', '-q', 'origin', 'jacob/push')
    await kit.open('s-push')
    await expect(kit.headline()).toContainText('远程不在 GitHub 上', WITHIN)
    await kit.panel().getByTestId('chain-menu').click()
    await kit.menuItem(/^推送/).click()
    const alert = kit.ship().getByRole('alert')
    await expect(alert).toContainText('远程有本地没有的提交', WITHIN)
    await expect(kit.ship().locator('[data-step="push"]')).toHaveAttribute('data-state', 'failed')
    await expect(kit.ship().getByRole('button', { name: '拉取' })).toBeVisible()
    await kit.shoot('f')
    await kit.ship().getByRole('button', { name: '取消' }).click()
  })

  test('(i) a branch merged into main: 已经全部合并到 main, 归档… opens the sheet and archives nothing by itself', async () => {
    await kit.open('s-done')
    await expect(kit.headline()).toContainText('已经全部合并到 main', WITHIN)
    await expect(kit.headline()).toHaveAttribute('data-tone', 'ok')
    await kit.shoot('i')
    await kit.panel().getByRole('button', { name: '归档…' }).click()
    await expect(page.getByTestId('archive-sheet')).toBeVisible(WITHIN)
    expect(existsSync(wt('done'))).toBe(true)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('archive-sheet')).toHaveCount(0)
  })

  test('(h) a failing PR poll reads `#12 ? 查询失败` in the sidebar and in the PR line', async () => {
    const tag = page.locator('[data-region="sidebar"] [data-session-id="s-pr"]').getByTestId('pr-tag')
    await expect(tag).toHaveText('#12', WITHIN)
    await kit.open('s-pr')
    gh.setPrListFails(true)
    await expect
      .poll(async () => {
        await page.evaluate((path) => (globalThis as unknown as { tr: { pr: { refresh(p: string): void } } }).tr.pr.refresh(path), prPath)
        return tag.textContent()
      }, { timeout: 40_000, intervals: [2000] })
      .toBe('#12查询失败')
    await expect(tag).toHaveAttribute('data-error', '')
    await expect(kit.panel().getByTestId('pr-status')).toContainText('查询失败')
    await expect(kit.panel().getByTestId('facts')).toContainText('连不上 GitHub：检查网络后重试')
    await kit.shoot('h')
    mkdirSync(SHOTS, { recursive: true })
    for (const theme of ['dark', 'light'] as const) {
      await page.evaluate(
        (t) => (globalThis as unknown as { tr: { settings: { update(p: unknown): Promise<unknown> } } }).tr.settings.update({ appearance: { theme: t } }),
        theme
      )
      await page.waitForTimeout(250)
      await page.locator('[data-region="sidebar"] [data-session-id="s-pr"]').screenshot({ path: join(SHOTS, `h-sidebar-${theme}.png`) }).catch(() => undefined)
    }
    gh.setPrListFails(false)
  })
})
