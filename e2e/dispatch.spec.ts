// 派活与回报 end to end (PRD F21 v1.103) on a real repository, through the real path: the agent's own shell runs
// `wavi` (Wavi's `<userData>/bin/wavi`, first on PATH) → its WAVI_DIR request file → main → the window → the answer
// file → back; reports go into the dispatcher's channel. Fake agents only, no model: `claude` runs the per-launch hooks
// (like e2e/fake-hook-claude.ts), keeps a cross-session inbox socket whose messages it logs, and runs `wavi` with the
// arguments a test step gives it, logging what it printed; `cursor-agent` (no channel: reports wait for 送进去) does
// the same without hooks or inbox and echoes what is typed. Screenshots in both themes go to test-results/dispatch/.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { appendFileSync, chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fakeHookClaude } from './fake-hook-claude'
import { launchApp, setWindowSize } from './launch'

const WITHIN = { timeout: 30_000 }
const SHOTS = join(process.cwd(), 'test-results', 'dispatch')

/** What both fakes share: argv, steps, `wavi` runs, typed input echoed like a TUI's input line. */
const COMMON = `
const { spawnSync, execSync } = require('node:child_process')
const fs = require('node:fs')
const dir = process.cwd()
fs.writeFileSync(dir + '/.fake-pid', String(process.pid))
fs.writeFileSync(dir + '/.fake-argv', JSON.stringify(process.argv.slice(2)))
fs.writeFileSync(dir + '/.fake-env', JSON.stringify({ PATH: process.env.PATH, WAVI_DIR: process.env.WAVI_DIR || '', WAVI_BIN: process.env.WAVI_BIN || '' }))
const wavi = (s) => {
  const r = spawnSync('wavi', s.args, { encoding: 'utf8', input: s.input || '', env: process.env, timeout: 20000 })
  fs.appendFileSync(dir + '/.fake-wavi', JSON.stringify({ id: s.id, code: r.status, out: (r.stdout || '') + (r.stderr || '') + (r.error ? String(r.error) : '') }) + '\\n')
}
if (process.stdin.isTTY) process.stdin.setRawMode(true)
process.stdin.on('data', (d) => {
  const text = d.toString()
  fs.appendFileSync(dir + '/.fake-typed', text.replace(/\\r/g, '<ENTER>\\n'))
  process.stdout.write(text.replace(/\\x1b\\[20[01]~/g, '').replace(/\\r/g, '\\r\\n❯ '))
})
`

const FAKE_CLAUDE = `#!/usr/bin/env node
${COMMON}
const net = require('node:net')
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null }
const settings = arg('--settings') ? JSON.parse(fs.readFileSync(arg('--settings'), 'utf8')) : {}
// A cross-session inbox like Claude Code's: newline JSON, auth first; its path and token in the env of hooks and Bash.
const inbox = '/tmp/wavi-e2e-inbox-' + process.pid + '.sock'
try { fs.rmSync(inbox) } catch {}
process.env.CLAUDE_CODE_MESSAGING_SOCKET = inbox
process.env.CLAUDE_CODE_MESSAGING_TOKEN = 'tok-' + process.pid
net.createServer((c) => {
  let buf = ''
  c.on('data', (d) => {
    buf += d.toString()
    let i
    while ((i = buf.indexOf('\\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1)
      const m = JSON.parse(line)
      if (m.type === 'user') fs.appendFileSync(dir + '/.fake-inbox', JSON.stringify(m.message.content) + '\\n')
    }
  })
}).listen(inbox)
const hook = (event, payload) => {
  const entry = settings.hooks && settings.hooks[event] && settings.hooks[event][0].hooks[0]
  if (!entry) return
  try { execSync(entry.command, { input: JSON.stringify({ hook_event_name: event, session_id: 'fake-' + process.pid, cwd: dir, ...payload }), timeout: 10000, shell: '/bin/sh', stdio: ['pipe', 'ignore', 'ignore'], env: process.env }) } catch {}
}
process.stdout.write('Claude Code v9.9.9\\r\\n\\r\\n❯ \\r\\n')
hook('SessionStart', { source: 'startup' })
let seen = 0
setInterval(() => {
  let steps
  try { steps = fs.readFileSync(dir + '/.fake-steps', 'utf8').split('\\n').filter(Boolean) } catch { return }
  for (; seen < steps.length; seen++) {
    const step = JSON.parse(steps[seen])
    if (step.exit !== undefined) process.exit(step.exit)
    if (step.hook) hook(step.hook, step.payload || {})
    if (step.wavi) wavi(step.wavi)
  }
}, 150)
`

const FAKE_CURSOR = `#!/usr/bin/env node
${COMMON}
process.stdout.write('Cursor Agent (fake)\\r\\n\\r\\n❯ ')
let seen = 0
setInterval(() => {
  let steps
  try { steps = fs.readFileSync(dir + '/.fake-steps', 'utf8').split('\\n').filter(Boolean) } catch { return }
  for (; seen < steps.length; seen++) {
    const step = JSON.parse(steps[seen])
    if (step.wavi) wavi(step.wavi)
  }
}, 150)
`

test.describe.configure({ mode: 'serial' })
test.setTimeout(180_000)

test.describe('派活与回报 · wavi', () => {
  const fake = fakeHookClaude('tr-e2e-dispatch-')
  const home = join(fake.root, 'home')
  const project = join(fake.root, 'demo')
  /** A second project whose only session runs Cursor Agent: a dispatcher without a channel. */
  const other = join(fake.root, 'other')
  const profile = join(fake.root, 'profile')
  const worktreesDir = join(home, '.tr', 'worktrees', 'demo')
  let app: ElectronApplication
  let page: Page
  const dirs: Record<'fix' | 'review' | 'types', string> = { fix: '', review: '', types: '' }
  const ids: Record<'fix' | 'review' | 'types', string> = { fix: '', review: '', types: '' }

  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.email=e2e@example.com', '-c', 'user.name=e2e', '-c', 'commit.gpgsign=false', ...args], { cwd }).toString()
  const read = (dir: string, name: string) => (existsSync(join(dir, name)) ? readFileSync(join(dir, name), 'utf8') : '')
  const step = (dir: string, value: unknown) => appendFileSync(join(dir, '.fake-steps'), `${JSON.stringify(value)}\n`)
  const waviOut = (dir: string, id: number): { code: number; out: string } | null => {
    for (const line of read(dir, '.fake-wavi').split('\n').filter(Boolean)) {
      const v = JSON.parse(line) as { id: number; code: number; out: string }
      if (v.id === id) return v
    }
    return null
  }
  let nextId = 1
  /** Runs `wavi <args>` in the fake agent's own shell and waits for what it printed. */
  const wavi = async (dir: string, ...args: string[]): Promise<{ code: number; out: string }> => {
    const id = nextId++
    step(dir, { wavi: { id, args } })
    await expect.poll(() => waviOut(dir, id), WITHIN).not.toBeNull()
    return waviOut(dir, id)!
  }
  const inbox = (dir: string): string[] => read(dir, '.fake-inbox').split('\n').filter(Boolean).map((l) => JSON.parse(l) as string)
  const strip = () => page.getByTestId('dispatch-strip')
  const sidebar = () => page.locator('[data-region="sidebar"]')
  const setTheme = (theme: 'dark' | 'light') =>
    page.evaluate((t) => {
      ;(globalThis as unknown as { document: { documentElement: { dataset: Record<string, string> } } }).document.documentElement.dataset.theme = t
    }, theme)
  const shoot = async (name: string) => {
    mkdirSync(SHOTS, { recursive: true })
    for (const theme of ['dark', 'light'] as const) {
      await setTheme(theme)
      await page.waitForTimeout(150)
      await page.screenshot({ path: join(SHOTS, `${name}-${theme}.png`) })
    }
    await setTheme('dark')
  }
  const worktreeOf = (needle: string): string => {
    for (const name of existsSync(worktreesDir) ? readdirSync(worktreesDir) : []) {
      const dir = join(worktreesDir, name)
      if (read(dir, '.fake-argv').includes(needle)) return dir
    }
    return ''
  }

  test.beforeAll(async () => {
    mkdirSync(home, { recursive: true })
    writeFileSync(join(home, '.zshrc'), '')
    writeFileSync(join(fake.root, 'bin', 'claude'), FAKE_CLAUDE)
    writeFileSync(join(fake.root, 'bin', 'cursor-agent'), FAKE_CURSOR)
    chmodSync(join(fake.root, 'bin', 'claude'), 0o755)
    chmodSync(join(fake.root, 'bin', 'cursor-agent'), 0o755)
    mkdirSync(project)
    writeFileSync(join(project, 'README.md'), '# demo\n')
    writeFileSync(join(project, '.gitignore'), '.fake-*\n')
    git(project, 'init', '-q', '-b', 'main')
    git(project, 'config', 'user.name', 'Jacob E2E')
    git(project, 'config', 'user.email', 'e2e@example.com')
    git(project, 'add', '.')
    git(project, 'commit', '-q', '-m', 'init')
    mkdirSync(other)
    writeFileSync(join(other, '.gitignore'), '.fake-*\n')
    git(other, 'init', '-q', '-b', 'main')
    git(other, 'add', '.')
    git(other, 'commit', '-q', '-m', 'init')
    writeFileSync(join(other, '.fake-steps'), '')
    mkdirSync(profile, { recursive: true })
    writeFileSync(
      join(profile, 'workspace.json'),
      JSON.stringify({
        version: 2,
        projects: [
          { id: 'p1', name: 'demo', rootPath: project },
          { id: 'p2', name: 'other', rootPath: other }
        ],
        worktrees: [
          { id: 'w-main', projectId: 'p1', branch: 'main', path: project, isMain: true },
          { id: 'w-other', projectId: 'p2', branch: 'main', path: other, isMain: true }
        ],
        sessions: [
          { id: 's-plan', worktreeId: 'w-main', kind: 'claude', title: '规划登录改版', startedAt: 1, lastActivityAt: 1 },
          { id: 's-cursor', worktreeId: 'w-other', kind: 'cursor', title: '整理文档', startedAt: 1, lastActivityAt: 1 }
        ],
        activeSessionId: 's-plan',
        sidebarCollapsed: false,
        drafts: {}
      })
    )
    writeFileSync(join(project, '.fake-steps'), '')
    app = await launchApp({ ...fake.env, HOME: home, CLAUDE_CONFIG_DIR: join(fake.root, 'claude-config') }, { userDataDir: profile })
    page = await app.firstWindow()
    await setWindowSize(app, page, 1440, 900)
    await expect(page.locator('[data-region="terminal"] .xterm').first()).toBeVisible(WITHIN)
  })

  test.afterAll(async () => {
    await app?.close().catch(() => {})
    for (const dir of [project, other, ...Object.values(dirs)].filter(Boolean)) {
      const pid = Number(read(dir, '.fake-pid')) || 0
      try {
        if (pid) process.kill(pid, 'SIGTERM')
      } catch {
        // Already gone.
      }
    }
  })

  test('the agent finds wavi first on its PATH and a system prompt about it; nothing global is written', async () => {
    await expect.poll(() => read(project, '.fake-argv'), WITHIN).not.toBe('')
    const argv = JSON.parse(read(project, '.fake-argv')) as string[]
    expect(argv).toContain('--append-system-prompt')
    expect(argv[argv.indexOf('--append-system-prompt') + 1]).toContain('wavi --skill')
    expect(argv.join(' ')).not.toMatch(/--mcp-config|mcp_servers/)
    const env = JSON.parse(read(project, '.fake-env')) as { PATH: string; WAVI_DIR: string; WAVI_BIN: string }
    expect(env.PATH.split(':')[0]).toBe(join(profile, 'bin'))
    expect(env.WAVI_DIR).toMatch(/^\/private\/tmp\/wavi-\d+-[a-f0-9]+\/s-plan$/)
    const skill = await wavi(project, '--skill')
    expect(skill.code).toBe(0)
    expect(skill.out).toContain('# wavi')
    expect(existsSync(join(home, '.claude', 'settings.json'))).toBe(false)
  })

  test('wavi run answers at once; the user’s 开始 starts every waiting request and the dispatcher hears it', async () => {
    // Not committed: a branch child goes without it, a snapshot child has it.
    writeFileSync(join(project, 'draft.txt'), 'work in progress\n')
    const fix = await wavi(project, 'run', 'claude', 'Fix the login form\nKeep the API as it is.', '--title', 'Fix login')
    expect(fix.code).toBe(0)
    expect(fix.out).toContain("waits for the user's 开始")
    expect(fix.out).toContain('end your turn now')
    const review = await wavi(project, 'run', 'claude', 'Review the login change', '--base', 'snapshot', '--title', 'Review')
    expect(review.out).toContain('read-only snapshot')
    ids.fix = /Session (\S+)/.exec(fix.out)![1]!
    ids.review = /Session (\S+)/.exec(review.out)![1]!
    // Under the dispatcher's own terminal, not over the window; its row says it is waiting on the user.
    await expect(strip()).toBeVisible(WITHIN)
    await expect(strip()).toContainText('想开 2 个会话')
    await expect(strip()).toContainText('基于 main')
    await expect(strip()).toContainText('未提交的改动不会带到新的 worktree 里')
    await expect(strip().getByTestId('dispatch-row')).toHaveCount(2)
    await expect(strip().getByTestId('dispatch-row').first()).toContainText('jacob/fix-login')
    await expect(strip().getByTestId('dispatch-row').nth(1)).toContainText('当前改动的快照')
    await strip().getByTestId('dispatch-row').first().getByRole('button').click()
    await expect(strip().getByTestId('dispatch-row').first()).toContainText('Keep the API as it is.')
    const dispatcherRow = sidebar().locator('[data-session-id="s-plan"]')
    await expect(dispatcherRow).toHaveAttribute('data-attention', 'true')
    await expect(dispatcherRow).toContainText('想开 2 个会话')
    expect(existsSync(worktreesDir)).toBe(false)
    await shoot('confirm')
    // A reload (a crash, a rebuild) keeps what waits for the user: the strip and the dispatcher's row come back.
    await page.reload()
    await expect(strip()).toBeVisible(WITHIN)
    await expect(strip().getByTestId('dispatch-row')).toHaveCount(2)
    await expect(dispatcherRow).toHaveAttribute('data-attention', 'true')
    await page.locator('[data-region="terminal"] .xterm').first().click()
    await page.keyboard.press('Meta+Enter')
    await expect(strip()).toBeHidden()
    await expect(dispatcherRow).not.toContainText('想开')
    await expect.poll(() => inbox(project).join('\n'), WITHIN).toContain('[Wavi 派活] 用户同意了')
    const notice = inbox(project)[0]!
    expect(notice).toContain(`id ${ids.fix} · claude · 「Fix login」 · 分支 jacob/fix-login`)
    expect(notice).toContain(`id ${ids.review} · claude · 「Review」 · 快照`)
  })

  test('each child starts in its own worktree with Wavi’s brief, the snapshot with the dispatcher’s uncommitted file', async () => {
    await expect.poll(() => worktreeOf('Fix the login form'), { timeout: 60_000 }).not.toBe('')
    await expect.poll(() => worktreeOf('Review the login change'), { timeout: 60_000 }).not.toBe('')
    dirs.fix = worktreeOf('Fix the login form')
    dirs.review = worktreeOf('Review the login change')
    const brief = (dir: string) => {
      const argv = JSON.parse(read(dir, '.fake-argv')) as string[]
      return { argv, text: argv[argv.indexOf('--') + 1] ?? '' }
    }
    const fix = brief(dirs.fix)
    expect(fix.text).toContain('这是 Wavi 转来的任务：Claude Code（会话「规划登录改版」）')
    expect(fix.text).toContain('分支 jacob/fix-login，基于 main')
    expect(fix.text).toContain('wavi report "<结果>"')
    // A dispatched session learns about wavi from its brief, not a system prompt.
    expect(fix.argv).not.toContain('--append-system-prompt')
    expect(existsSync(join(dirs.fix, 'draft.txt'))).toBe(false)
    expect(brief(dirs.review).text).toContain('不要改文件')
    expect(readFileSync(join(dirs.review, 'draft.txt'), 'utf8')).toBe('work in progress\n')
    expect(git(dirs.review, 'branch', '--show-current').trim()).toBe('')
    expect(git(project, 'branch', '--format=%(refname:short)').trim().split('\n').sort()).toEqual(['jacob/fix-login', 'main'])
    // The other project's Cursor session is not part of this tree.
    const rows = sidebar().locator('[data-session-id]:not([data-session-id="s-cursor"])')
    await expect(rows).toHaveCount(3, WITHIN)
    await expect(rows.nth(1)).toHaveAttribute('data-depth', '1')
    await expect(rows.nth(2)).toHaveAttribute('data-depth', '1')
  })

  test('a child starts a grandchild at once, two levels in; the grandchild may go no deeper', async () => {
    await expect.poll(() => read(dirs.fix, '.fake-env'), WITHIN).not.toBe('')
    const started = await wavi(dirs.fix, 'run', 'claude', 'Check the types of the login form', '--title', 'Types', '--model', 'haiku')
    expect(started.code).toBe(0)
    expect(started.out).toContain('Started session')
    ids.types = /Started session (\S+)/.exec(started.out)![1]!
    await expect(strip()).toHaveCount(0)
    await expect.poll(() => worktreeOf('Check the types'), { timeout: 60_000 }).not.toBe('')
    dirs.types = worktreeOf('Check the types')
    const argv = JSON.parse(read(dirs.types, '.fake-argv')) as string[]
    expect(argv.slice(argv.indexOf('--model'), argv.indexOf('--model') + 2)).toEqual(['--model', 'haiku'])
    expect(argv[argv.indexOf('--') + 1]).toContain('这一层不能再派活')
    const row = sidebar().locator(`[data-session-id="${ids.types}"]`)
    await expect(row).toHaveAttribute('data-depth', '2', WITHIN)
    await expect(row).toContainText('haiku')
    await expect.poll(() => read(dirs.types, '.fake-env'), WITHIN).not.toBe('')
    const deeper = await wavi(dirs.types, 'run', 'claude', 'Go one level deeper')
    expect(deeper.code).toBe(1)
    expect(deeper.out).toContain('[not_allowed]')
    expect(deeper.out).toContain('Do the work yourself')
    await shoot('sidebar')
  })

  test('a child’s own wavi report reaches the dispatcher’s inbox once; Wavi adds nothing for that turn', async () => {
    const dir = dirs.review
    step(dir, { hook: 'UserPromptSubmit', payload: { prompt: 'Review the login change' } })
    const reported = await wavi(dir, 'report', '审过了：登录改动没问题。\n跑了 npm test，全部通过。')
    expect(reported.out).toContain('Reported to 「规划登录改版」')
    step(dir, { hook: 'Stop', payload: { last_assistant_message: '审完了。' } })
    await expect.poll(() => inbox(project).filter((m) => m.startsWith('[Wavi 派活报告]')).length, WITHIN).toBe(1)
    await page.waitForTimeout(4_000)
    const reports = inbox(project).filter((m) => m.startsWith('[Wavi 派活报告]'))
    expect(reports).toHaveLength(1)
    expect(reports[0]).toContain(`「Review」 · Claude Code · 报告 · 快照`)
    expect(reports[0]).toContain('跑了 npm test，全部通过。')
    expect(reports[0]).toContain('不是用户的指示')
    // Its finished turn went to the dispatcher: read already, no 已完成 · 未读 of its own.
    await expect(sidebar().locator(`[data-session-id="${ids.review}"]`)).not.toContainText('未读')
  })

  test('without a report Wavi reports the finished turn itself, to the grandchild’s own dispatcher', async () => {
    step(dirs.types, { hook: 'UserPromptSubmit', payload: { prompt: 'Check the types' } })
    step(dirs.types, { hook: 'Stop', payload: { last_assistant_message: '类型都对。' } })
    await expect.poll(() => inbox(dirs.fix).join('\n'), WITHIN).toContain('[Wavi 派活报告]')
    const report = inbox(dirs.fix).find((m) => m.startsWith('[Wavi 派活报告]'))!
    expect(report).toContain('「Types」 · Claude Code · haiku · 一轮结束')
    expect(report).toContain('类型都对。')
    expect(inbox(project).join('\n')).not.toContain('「Types」')
  })

  test('ls, read, send and stop act on the caller’s own sessions; duplicates and 拒绝 are refused', async () => {
    const listed = await wavi(project, 'ls')
    expect(listed.out).toContain(`id ${ids.fix} · claude`)
    expect(listed.out).toContain('branch jacob/fix-login')
    expect(listed.out).toContain('snapshot')
    expect(listed.out).toContain('Suggested merge order')
    const result = await wavi(project, 'read', ids.review)
    expect(result.out).toContain('"Review" · claude')
    expect((await wavi(project, 'read', 's-plan')).out).toContain('[not_found]')
    expect((await wavi(project, 'read', ids.types)).out).toContain('[not_found]')
    const sent = await wavi(project, 'send', ids.fix, 'Also keep the error messages.')
    expect(sent.out).toContain('Wavi is putting it in')
    await expect.poll(() => inbox(dirs.fix).join('\n'), WITHIN).toContain('Also keep the error messages.')
    expect((await wavi(project, 'run', 'claude', 'Fix the login form\nKeep the API as it is.')).out).toContain('[duplicate]')
    await wavi(project, 'run', 'claude', 'Update the docs', '--title', 'Docs')
    await expect(strip()).toBeVisible(WITHIN)
    await strip().getByRole('button', { name: '拒绝' }).click()
    await expect.poll(() => inbox(project).join('\n'), WITHIN).toContain('用户拒绝了')
    expect(readdirSync(worktreesDir)).toHaveLength(3)
  })

  test('the child’s header names its dispatcher, and the overview lists them together', async () => {
    await sidebar().locator(`[data-session-id="${ids.fix}"]`).click()
    const link = page.getByTestId('dispatched-by').first()
    await expect(link).toHaveText('由「规划登录改版」派出', WITHIN)
    await shoot('header')
    await link.click()
    await expect(sidebar().locator('[data-session-id="s-plan"]')).toHaveAttribute('aria-current', 'true')
    await page.keyboard.press('Shift+Meta+A')
    const group = page.getByTestId('dispatch-group').first()
    await expect(group).toContainText('规划登录改版', WITHIN)
    await shoot('overview')
    await page.keyboard.press('Shift+Meta+A')
  })

  test('a dispatcher with no channel gets Wavi’s messages when the user presses 送进去', async () => {
    // Cursor Agent: its status comes from the title only, so nothing is typed into it unasked.
    await sidebar().locator('[data-session-id="s-cursor"]').click()
    await expect.poll(() => read(other, '.fake-env'), WITHIN).not.toBe('')
    const argv = JSON.parse(read(other, '.fake-argv')) as string[]
    expect(argv).not.toContain('--append-system-prompt')
    const asked = await wavi(other, 'run', 'claude', 'Write the changelog entry', '--title', 'Changelog')
    expect(asked.out).toContain("waits for the user's 开始")
    await expect(strip()).toBeVisible(WITHIN)
    await strip().getByRole('button', { name: '拒绝' }).click()
    const held = page.getByTestId('held-reports')
    await expect(held).toContainText('1 条派活消息还没送进去：「派活结果」', WITHIN)
    expect(read(other, '.fake-typed')).toBe('')
    await shoot('held')
    await held.getByRole('button', { name: '送进去' }).click()
    await expect.poll(() => read(other, '.fake-typed'), WITHIN).toContain('用户拒绝了')
    await expect(held).toBeHidden()
  })
})
