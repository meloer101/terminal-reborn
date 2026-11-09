// 手机远程 and GUI sessions (PRD F22 / F23): a session the phone starts runs as a GUI session whenever its agent has one,
// so the phone's 会话设置 (model, effort, 模式) are the agent's own pickers from the start — before the first message —
// and change by button, not by typing into a TUI; a first message typed in 新建会话 still reaches the agent. A restored
// GUI session nobody has shown yet starts when the phone opens it (PRD F22 v1.161). Against the fake headless Claude of src/main/gui/fixtures, through the stand-in phone (test-phone.ts).
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RemoteSession, RemoteStatus } from '../src/shared/remote'
import { pairPhone, TestPhone } from '../src/main/remote/test-phone'
import { outerClaudeEnv } from './fake-claude'
import { launchApp, setWindowSize } from './launch'

const WITHIN = { timeout: 20_000 }
const FAKE = join(process.cwd(), 'src', 'main', 'gui', 'fixtures', 'fake-claude.mjs')

interface Hooks {
  tr: { settings: { update(patch: unknown): Promise<unknown> }; ui: { openSettings(): void }; remote: { status(): Promise<RemoteStatus> } }
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port
      server.close(() => resolve(port))
    })
  })
}

const macKey = (link: string): string => (JSON.parse(Buffer.from(link.slice('wavi://pair?d='.length), 'base64url').toString('utf8')) as { key: string }).key

test.describe('手机远程 · GUI sessions', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(120_000)

  const root = realpathSync(mkdtempSync(join(tmpdir(), 'tr-e2e-remote-gui-')))
  const bin = join(root, 'bin')
  const zdot = join(root, 'zdot')
  const project = join(root, 'demo')
  const profile = join(root, 'profile')
  const argsFile = join(root, 'claude-args.json')
  for (const dir of [bin, zdot, project, profile]) mkdirSync(dir)
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@"\n`)
  chmodSync(join(bin, 'claude'), 0o755)
  writeFileSync(join(zdot, '.zshrc'), `export PATH="${bin}:$PATH"\nexport FAKE_ARGS_FILE="${argsFile}"\n`)

  let app: ElectronApplication
  let page: Page
  let phone: TestPhone
  let created: string

  /** The arguments the fake Claude was last started with: a GUI session runs it headless (`-p`, stream-json). */
  const launchedArgs = (): string[] => (existsSync(argsFile) ? (JSON.parse(readFileSync(argsFile, 'utf8')) as { args: string[] }).args : [])
  const phoneRow = async (id: string): Promise<RemoteSession | undefined> => {
    const answer = await phone.request({ type: 'snapshot' })
    return answer.ok ? (answer.data as { sessions: RemoteSession[] }).sessions.find((s) => s.id === id) : undefined
  }
  const kinds = async (id: string) => (await phoneRow(id))?.settings?.items.map((i) => i.kind) ?? []
  const current = async (id: string, kind: string) => (await phoneRow(id))?.settings?.items.find((i) => i.kind === kind)?.current

  test.beforeAll(async () => {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: project })
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: project })
    // s1: a GUI session restored from disk that no window shows (s0 is the one shown), so nothing has started it.
    writeFileSync(
      join(profile, 'workspace.json'),
      JSON.stringify({
        version: 2,
        projects: [{ id: 'p1', name: 'demo', rootPath: project }],
        worktrees: [{ id: 'w-main', projectId: 'p1', branch: 'main', path: project, isMain: true }],
        sessions: [
          { id: 's0', worktreeId: 'w-main', kind: 'claude', ui: 'gui', title: '看着的会话', startedAt: 1, lastActivityAt: 2 },
          { id: 's1', worktreeId: 'w-main', kind: 'claude', ui: 'gui', title: '旧会话', startedAt: 1, lastActivityAt: 1 }
        ],
        activeSessionId: 's0',
        sidebarCollapsed: false,
        drafts: {}
      })
    )
    app = await launchApp({ ...outerClaudeEnv(), ZDOTDIR: zdot, SHELL: '/bin/zsh', CLAUDE_CONFIG_DIR: join(root, 'claude-config') }, { userDataDir: profile })
    page = await app.firstWindow()
    await page.waitForSelector('[data-region="sidebar"]')
    await setWindowSize(app, page, 1440, 900)
    const port = await freePort()
    await page.evaluate((p) => (globalThis as unknown as Hooks).tr.settings.update({ remote: { port: p } }), port)
    await page.evaluate(() => (globalThis as unknown as Hooks).tr.ui.openSettings())
    await page.getByRole('tab', { name: '手机' }).click()
    await page.getByRole('switch', { name: '允许手机连接' }).click()
    await expect.poll(async () => (await page.evaluate(() => (globalThis as unknown as Hooks).tr.remote.status())).pairing?.code, WITHIN).toBeTruthy()
    const status = await page.evaluate(() => (globalThis as unknown as Hooks).tr.remote.status())
    const url = `ws://127.0.0.1:${port}`
    phone = await TestPhone.connect(url, await pairPhone(url, macKey(status.pairing!.link), status.pairing!.code))
    await page.keyboard.press('Escape')
  })

  test.afterAll(async () => {
    phone?.close()
    await app?.close().catch(() => {})
  })

  test('a session the phone starts is a GUI session with model, effort and 模式 before anything is said', async () => {
    // The window publishes its sessions a moment after the phone connects.
    await expect.poll(async () => ((await phone.request({ type: 'snapshot' })) as { data?: { projects: { id: string }[] } }).data?.projects.map((p) => p.id), WITHIN).toEqual(['p1'])
    const answer = await phone.request({ type: 'new-session', project: 'p1', workdir: 'worktree', agent: 'claude', base: 'main', branch: 'phone-gui' }, 30_000)
    expect(answer).toMatchObject({ ok: true, data: { session: expect.any(String) } })
    created = (answer as { data: { session: string } }).data.session
    await expect.poll(() => kinds(created), WITHIN).toEqual(['model', 'effort', 'permission'])
    expect(launchedArgs()).toEqual(expect.arrayContaining(['-p', 'stream-json']))
  })

  test('the phone changes the model within the agent, the effort and the 模式 by button', async () => {
    const row = await phoneRow(created)
    expect(row?.settings?.locked).toBeUndefined()
    expect(row?.settings?.items.find((i) => i.kind === 'model')?.values.map((v) => v.value)).toContain('haiku')
    expect(await phone.request({ type: 'set-setting', session: created, kind: 'model', value: 'haiku' })).toMatchObject({ ok: true })
    await expect.poll(() => current(created, 'model'), WITHIN).toBe('haiku')
    expect(await phone.request({ type: 'set-setting', session: created, kind: 'model', value: 'opus' })).toMatchObject({ ok: true })
    await expect.poll(() => current(created, 'model'), WITHIN).toBe('opus')
    expect(await phone.request({ type: 'set-setting', session: created, kind: 'effort', value: 'low' })).toMatchObject({ ok: true })
    await expect.poll(() => current(created, 'effort'), WITHIN).toBe('low')
    expect(await phone.request({ type: 'set-setting', session: created, kind: 'permission', value: 'accept-edits' })).toMatchObject({ ok: true })
    await expect.poll(() => current(created, 'permission'), WITHIN).toBe('accept-edits')
    expect(await phone.request({ type: 'set-setting', session: created, kind: 'permission', value: 'plan' })).toMatchObject({ ok: true })
    await expect.poll(() => current(created, 'permission'), WITHIN).toBe('plan')
  })

  test('新建会话 lists the agent\'s models and the session starts with the one picked (Figma 67A / 67B)', async () => {
    const listed = await phone.request({ type: 'agent-models', agent: 'claude' }, 30_000)
    expect(listed).toMatchObject({ ok: true, data: { gui: true } })
    const models = (listed as { data: { models: { value: string }[] } }).data.models.map((m) => m.value)
    expect(models).toEqual(expect.arrayContaining(['opus', 'haiku']))
    const answer = await phone.request({ type: 'new-session', project: 'p1', workdir: 'worktree', agent: 'claude', base: 'main', branch: 'phone-haiku', model: 'haiku' }, 30_000)
    expect(answer).toMatchObject({ ok: true })
    const id = (answer as { data: { session: string } }).data.session
    await expect.poll(() => current(id, 'model'), WITHIN).toBe('haiku')
    expect(launchedArgs()).toEqual(expect.arrayContaining(['--model', 'haiku']))
    // The agent's next session starts with it too, as a pick in the desktop's menu does.
    expect((await phone.request({ type: 'agent-models', agent: 'claude' })) as unknown).toMatchObject({ ok: true, data: { current: 'haiku' } })
  })

  test('a first message typed in 新建会话 reaches the GUI agent, started with the model picked', async () => {
    const answer = await phone.request({ type: 'new-session', project: 'p1', workdir: 'worktree', agent: 'claude', base: 'main', branch: 'phone-first', prompt: 'from the phone', model: 'haiku' }, 30_000)
    expect(answer).toMatchObject({ ok: true })
    const id = (answer as { data: { session: string } }).data.session
    // The agent got it as the conversation's first message: the Mac's chat shows its answer.
    await page.locator(`[data-region="sidebar"] [data-session-id="${id}"]`).click()
    await expect(page.locator('[data-region="gui-feed"]')).toContainText('Hello: from the phone', WITHIN)
    expect(launchedArgs()).toEqual(expect.arrayContaining(['--model', 'haiku']))
  })

  test('a restored GUI session nobody has shown starts when the phone opens it', async () => {
    expect(await kinds('s1')).toEqual([])
    expect(await phone.request({ type: 'watch', session: 's1' })).toMatchObject({ ok: true })
    // It starts with the agent's last pick (Haiku, from 新建会话 above), which has no effort levels: no effort row.
    await expect.poll(() => kinds('s1'), WITHIN).toEqual(['model', 'permission'])
    expect(await current('s1', 'model')).toBe('haiku')
  })
})
