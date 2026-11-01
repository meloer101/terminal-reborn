// Git · 变更's exits and 归档 from the phone (PRD F22, Figma 45I / 45J) through the real path: a stand-in phone
// (src/main/remote/test-phone.ts) asks which exits a worktree has, starts 合并到 main, sees the agent's commit message
// arrive with the session list, edits it, goes ahead, and the branch is squashed into main with the edited message;
// then it archives the worktree. Same repository as merge-chain.spec.ts (no remote, so 合并到 main is the only exit).
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PhoneEvent, RemoteExits, RemoteSession, RemoteStatus } from '../src/shared/remote'
import { pairPhone, TestPhone } from '../src/main/remote/test-phone'
import { fakeHookClaude } from './fake-hook-claude'
import { launchApp, setWindowSize } from './launch'
import { agentWrites, promptedPath } from './ship'

const WITHIN = { timeout: 30_000 }

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port
      server.close(() => resolve(port))
    })
  })
}

test.describe.configure({ mode: 'serial' })
test.setTimeout(120_000)

test.describe('手机 · Git 出口', () => {
  const profile = mkdtempSync(join(tmpdir(), 'tr-e2e-remote-exits-'))
  const fake = fakeHookClaude('tr-e2e-remote-exits-')
  const project = join(fake.root, 'demo')
  const clean = join(fake.root, 'wt-clean')
  let agent: ReturnType<typeof fake.folder>
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.email=e2e@example.com', '-c', 'user.name=e2e', '-c', 'commit.gpgsign=false', ...args], { cwd }).toString()
  let app: ElectronApplication
  let page: Page
  let phone: TestPhone

  /** The session as the latest list the phone got shows it. */
  const row = (event: PhoneEvent): RemoteSession | undefined => (event.event === 'sessions' ? event.data.sessions.find((s) => s.id === 's-clean') : undefined)
  const shipped = (match: (s: RemoteSession) => boolean) => phone.next((e) => (row(e) ? match(row(e)!) : false), 30_000).then(row)

  test.beforeAll(async () => {
    mkdirSync(project)
    mkdirSync(join(fake.root, 'claude-config'))
    writeFileSync(join(project, 'README.md'), '# demo\n')
    writeFileSync(join(project, '.gitignore'), '.fake-*\n')
    git(project, 'init', '-q', '-b', 'main')
    git(project, 'add', '.')
    git(project, 'commit', '-q', '-m', 'init')
    git(project, 'worktree', 'add', '-q', '-b', 'jacob/clean', clean)
    git(project, 'config', 'branch.jacob/clean.base', 'main')
    agent = fake.folder('wt-clean')
    writeFileSync(join(clean, 'nav.ts'), "export const nav = 'sticky'\n")
    git(clean, 'add', '.')
    git(clean, 'commit', '-q', '-m', 'Make nav sticky')
    writeFileSync(
      join(profile, 'workspace.json'),
      JSON.stringify({
        version: 2,
        projects: [{ id: 'p1', name: 'demo', rootPath: project }],
        worktrees: [
          { id: 'w-main', projectId: 'p1', branch: 'main', path: project, isMain: true },
          { id: 'w-clean', projectId: 'p1', branch: 'jacob/clean', path: clean, isMain: false, baseBranch: 'main' }
        ],
        sessions: [{ id: 's-clean', worktreeId: 'w-clean', kind: 'claude', title: '导航吸顶', startedAt: 1, lastActivityAt: 1 }],
        activeSessionId: 's-clean',
        sidebarCollapsed: false,
        rightPanel: null,
        drafts: {}
      })
    )
    app = await launchApp({ ...fake.env, CLAUDE_CONFIG_DIR: join(fake.root, 'claude-config') }, { userDataDir: profile })
    page = await app.firstWindow()
    await page.waitForSelector('[data-region="sidebar"]')
    await setWindowSize(app, page, 1440, 900)
    await expect.poll(() => agent.pid(), WITHIN).not.toBeNull()

    const port = await freePort()
    const url = `ws://127.0.0.1:${port}`
    await page.evaluate((p) => (globalThis as unknown as { tr: { settings: { update(x: unknown): Promise<unknown> } } }).tr.settings.update({ remote: { enabled: true, port: p } }), port)
    let status: RemoteStatus | null = null
    await expect
      .poll(async () => {
        status = await page.evaluate(() => (globalThis as unknown as { tr: { remote: { status(): Promise<RemoteStatus> } } }).tr.remote.status())
        return status.listening && status.pairing !== null
      }, WITHIN)
      .toBe(true)
    const pairing = status!.pairing!
    const key = (JSON.parse(Buffer.from(pairing.link.slice('wavi://pair?d='.length), 'base64url').toString('utf8')) as { key: string }).key
    phone = await TestPhone.connect(url, await pairPhone(url, key, pairing.code, 'iPhone'))
  })

  test.afterAll(async () => {
    phone?.close()
    await app?.close().catch(() => {})
  })

  test('the phone gets the exits Git · 变更 would offer', async () => {
    await expect
      .poll(async () => {
        const answer = await phone.request({ type: 'exits', session: 's-clean' }, 30_000)
        return answer.ok ? (answer.data as RemoteExits).primary : answer
      }, WITHIN)
      .toEqual({ kind: 'main', label: '合并到 main', blocker: null })
    const answer = await phone.request({ type: 'exits', session: 's-clean' }, 30_000)
    expect(answer.ok && (answer.data as RemoteExits)).toMatchObject({ secondary: null, pr: null, base: 'main' })
  })

  test('合并到 main from the phone: the agent writes, the phone edits and goes ahead, main gets the edited message', async () => {
    expect(await phone.request({ type: 'ship', session: 's-clean', action: { do: 'start', exit: 'main' } }, 30_000)).toMatchObject({ ok: true })
    const writing = await shipped((s) => s.ship?.stage === 'writing')
    expect(writing?.ship).toMatchObject({ kind: 'main', title: '合并到 main', steps: expect.arrayContaining([expect.objectContaining({ id: 'write', state: 'working' })]) })
    // Nothing to go ahead with yet, nothing to edit, and no second run.
    expect(await phone.request({ type: 'ship', session: 's-clean', action: { do: 'submit' } })).toMatchObject({ ok: false })
    expect(await phone.request({ type: 'ship', session: 's-clean', action: { do: 'edit', texts: { commit: 'too early' } } })).toMatchObject({ ok: false })
    expect(await phone.request({ type: 'ship', session: 's-clean', action: { do: 'start', exit: 'main' } }, 30_000)).toMatchObject({ ok: false })

    const file = await promptedPath(agent, 'wt-clean', 'commit')
    agentWrites(agent, file, '导航吸顶\n\n- 导航滚动时吸在顶部\n')
    const glance = await shipped((s) => s.ship?.stage === 'glance')
    expect(glance?.ship).toMatchObject({ fields: ['commit'], submitLabel: '合并并推送', submitBlocker: null, texts: { commit: '导航吸顶\n\n- 导航滚动时吸在顶部' } })

    expect(await phone.request({ type: 'ship', session: 's-clean', action: { do: 'edit', texts: { commit: '导航吸顶（手机上改过）' } } })).toMatchObject({ ok: true })
    await shipped((s) => s.ship?.texts.commit === '导航吸顶（手机上改过）')
    expect(await phone.request({ type: 'ship', session: 's-clean', action: { do: 'submit' } })).toMatchObject({ ok: true })

    const done = await shipped((s) => s.ship === undefined && /已合并到 main/.test(s.shipNotice ?? ''))
    expect(done?.shipNotice).toMatch(/已合并到 main · [0-9a-f]{7}/)
    expect(git(project, 'log', '-1', '--format=%B', 'main').trim()).toBe('导航吸顶（手机上改过）')
    expect(existsSync(join(project, 'nav.ts'))).toBe(true)
    // Nothing left to ship.
    await expect
      .poll(async () => {
        const answer = await phone.request({ type: 'exits', session: 's-clean' }, 30_000)
        return answer.ok ? (answer.data as RemoteExits).primary : 'error'
      }, WITHIN)
      .toBeNull()
  })

  test('归档 from the phone folds the worktree away and keeps its folder', async () => {
    await expect
      .poll(async () => {
        const answer = await phone.request({ type: 'exits', session: 's-clean' }, 30_000)
        return answer.ok ? (answer.data as RemoteExits).archive.blocker : 'error'
      }, WITHIN)
      .toBeNull()
    expect(await phone.request({ type: 'archive', session: 's-clean' }, 60_000)).toMatchObject({ ok: true })
    await phone.next((e) => e.event === 'sessions' && !e.data.sessions.some((s) => s.id === 's-clean'), 30_000)
    expect(existsSync(clean)).toBe(true)
  })
})
