// Dispatch drawn in a GUI dispatcher's chat (PRD F21 / F23, Figma 68′), end to end: the fake headless Claude
// (src/main/gui/fixtures/fake-claude.mjs) runs the real `wavi run cursor … --ui cli` twice in its own shell; the chat
// draws the two calls as one fan-out graph that is the confirm (no terminal strip); 开始 opens the sessions, the
// notice comes in as a quiet line and the strip shows above the composer; a child's `wavi report` arrives as a report
// card beside its agent's mark, not as the user's bubble. The children are fake Cursor Agent TUIs that run `wavi` when
// a step asks. Screenshots in both themes go to test-results/gui-dispatch/.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { outerClaudeEnv } from './fake-claude'
import { launchApp, setWindowSize } from './launch'

const SHOTS = join(process.cwd(), 'test-results', 'gui-dispatch')
const WITHIN = { timeout: 30_000 }
const FAKE = join(process.cwd(), 'src', 'main', 'gui', 'fixtures', 'fake-claude.mjs')

/** A Cursor Agent TUI stand-in: runs `wavi` with the arguments a step gives it, logging what it printed. */
const FAKE_CURSOR = `#!/usr/bin/env node
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const dir = process.cwd()
fs.writeFileSync(dir + '/.fake-argv', JSON.stringify(process.argv.slice(2)))
process.stdout.write('Cursor Agent (fake)\\r\\n\\r\\n❯ ')
let seen = 0
setInterval(() => {
  let steps
  try { steps = fs.readFileSync(dir + '/.fake-steps', 'utf8').split('\\n').filter(Boolean) } catch { return }
  for (; seen < steps.length; seen++) {
    const s = JSON.parse(steps[seen])
    const r = spawnSync('wavi', s.args, { encoding: 'utf8', env: process.env, timeout: 20000 })
    fs.appendFileSync(dir + '/.fake-wavi', JSON.stringify({ code: r.status, out: (r.stdout || '') + (r.stderr || '') }) + '\\n')
  }
}, 150)
`

test.describe.configure({ mode: 'serial' })
test.setTimeout(120_000)

test.describe('GUI 派活可视化 (Figma 68′)', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'tr-e2e-gui-dispatch-')))
  const bin = join(root, 'bin')
  const home = join(root, 'home')
  const zdot = join(root, 'zdot')
  const project = join(root, 'demo')
  const profile = join(root, 'profile')
  const worktreesDir = join(home, '.tr', 'worktrees', 'demo')
  const argsFile = join(root, 'claude-args.json')
  let app: ElectronApplication
  let page: Page
  const feed = () => page.locator('[data-region="gui-feed"]')
  /** The user's bubbles (the fake agent echoes each message back in its own words, which is not a bubble). */
  const bubbles = () => feed().locator('[class*="bubbleText"]')
  const graph = () => page.getByTestId('dispatch-graph')
  const input = () => page.getByTestId('gui-composer').getByRole('textbox', { name: '回复' })
  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=e2e@example.com', '-c', 'user.name=e2e', '-c', 'commit.gpgsign=false', ...args], { cwd }).toString()
  const setTheme = (theme: 'dark' | 'light') =>
    page.evaluate((t) => (globalThis as unknown as { tr: { settings: { update(p: unknown): Promise<unknown> } } }).tr.settings.update({ appearance: { theme: t } }), theme)
  const shoot = async (name: string) => {
    mkdirSync(SHOTS, { recursive: true })
    for (const theme of ['dark', 'light'] as const) {
      await setTheme(theme)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await page.waitForTimeout(200)
      await page.screenshot({ path: join(SHOTS, `${name}-${theme}.png`) })
    }
    await setTheme('dark')
  }
  /** The worktree of the child whose first message (on its command line) has this in it. */
  const worktreeOf = (needle: string): string => {
    for (const name of existsSync(worktreesDir) ? readdirSync(worktreesDir) : []) {
      const argv = join(worktreesDir, name, '.fake-argv')
      if (existsSync(argv) && readFileSync(argv, 'utf8').includes(needle)) return join(worktreesDir, name)
    }
    return ''
  }

  test.beforeAll(async () => {
    for (const dir of [bin, home, zdot, project, profile]) mkdirSync(dir, { recursive: true })
    writeFileSync(join(bin, 'claude'), `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@"\n`)
    writeFileSync(join(bin, 'cursor-agent'), FAKE_CURSOR)
    chmodSync(join(bin, 'claude'), 0o755)
    chmodSync(join(bin, 'cursor-agent'), 0o755)
    writeFileSync(join(zdot, '.zshrc'), `export PATH="${bin}:$PATH"\nexport FAKE_ARGS_FILE="${argsFile}"\n`)
    writeFileSync(join(project, 'README.md'), '# demo\n')
    writeFileSync(join(project, '.gitignore'), '.fake-*\n')
    git(project, 'init', '-q', '-b', 'main')
    git(project, 'add', '.')
    git(project, 'commit', '-q', '-m', 'init')
    writeFileSync(
      join(profile, 'workspace.json'),
      JSON.stringify({
        version: 2,
        projects: [{ id: 'p1', name: 'demo', rootPath: project }],
        worktrees: [{ id: 'w-main', projectId: 'p1', branch: 'main', path: project, isMain: true }],
        sessions: [{ id: 's-gui', worktreeId: 'w-main', kind: 'claude', ui: 'gui', title: 'Cookie 会话迁移', startedAt: 1, lastActivityAt: 1 }],
        activeSessionId: 's-gui',
        sidebarCollapsed: false,
        drafts: {}
      })
    )
    app = await launchApp({ ...outerClaudeEnv(), HOME: home, ZDOTDIR: zdot, SHELL: '/bin/zsh', CLAUDE_CONFIG_DIR: join(root, 'claude-config') }, { userDataDir: profile })
    page = await app.firstWindow()
    await setWindowSize(app, page, 1440, 900)
    await expect(page.getByTestId('gui-chat')).toBeVisible(WITHIN)
    // The session is open (its agent launched) before anything is sent to it.
    await expect.poll(() => existsSync(argsFile), WITHIN).toBe(true)
  })

  test.afterAll(async () => {
    await app?.close().catch(() => {})
  })

  test('two wavi run calls are one graph that asks for 开始, in the chat instead of a terminal strip', async () => {
    await input().fill('dispatch the tests and the cleanup')
    await input().press('Enter')
    await expect(graph()).toHaveCount(1, WITHIN)
    await expect(graph().getByTestId('dispatch-node')).toHaveCount(2, WITHIN)
    await expect(graph().locator('[data-testid="dispatch-node"][data-state="pending"]')).toHaveCount(2)
    await expect(graph()).toContainText('想开 2 个会话')
    // The calls themselves left the feed: no 「运行 wavi run …」 rows.
    await expect(feed().getByText('wavi run cursor')).toHaveCount(0)
    await expect(page.getByTestId('dispatch-strip')).toHaveCount(0)
    await expect(page.getByTestId('dispatch-crew')).toHaveCount(0)
    await shoot('pending')
  })

  test('开始 opens the sessions: the nodes come alive, the notice is a line, the strip shows above the composer', async () => {
    await graph().getByTestId('dispatch-graph-start').click()
    await expect(graph().locator('[data-testid="dispatch-node"][data-state="working"]')).toHaveCount(2, WITHIN)
    await expect(graph()).toContainText('派出 2 个会话')
    await expect(page.getByTestId('dispatch-notice')).toContainText('已开始 2 个会话', WITHIN)
    // Wavi's notice is not the user's bubble: the one bubble is what the user wrote.
    await expect(bubbles()).toHaveCount(1)
    await expect(bubbles().filter({ hasText: '用户同意了' })).toHaveCount(0)
    await expect(page.getByTestId('dispatch-crew')).toBeVisible()
    await expect.poll(() => worktreeOf('Write the login tests'), WITHIN).not.toBe('')
    await shoot('running')
  })

  test('a child’s report is a card beside its agent’s mark, counted on the dispatcher', async () => {
    const dir = worktreeOf('Write the login tests')
    appendFileSync(join(dir, '.fake-steps'), `${JSON.stringify({ args: ['report', 'Added 4 login tests; no app code changed.'] })}\n`)
    await expect.poll(() => (existsSync(join(dir, '.fake-wavi')) ? readFileSync(join(dir, '.fake-wavi'), 'utf8') : ''), WITHIN).toContain('"code":0')
    const card = page.getByTestId('dispatch-report')
    await expect(card).toHaveCount(1, WITHIN)
    await expect(card).toContainText('登录接口测试')
    await expect(card).toContainText('Added 4 login tests')
    await expect(bubbles().filter({ hasText: '你派出的会话有了结果' })).toHaveCount(0)
    await expect(bubbles()).toHaveCount(1)
    await expect(graph().locator('[class*="badge"]')).toHaveText('1')
    await shoot('reported')
    await page.getByTestId('dispatch-crew').getByRole('button', { name: '展开' }).click()
    await expect(page.getByTestId('dispatch-crew')).toContainText('移除 localStorage 读写')
    await shoot('strip-open')
  })
})
