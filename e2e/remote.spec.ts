// 手机远程 end to end (PRD F22) through the real path: 设置 · 手机 turns the server on and shows a pairing code; a
// stand-in phone (src/main/remote/test-phone.ts, the same handshake and frames as the app) pairs with it, lists the
// sessions, types a prompt and a photo into a fake Claude's terminal, answers a held permission request, reads the
// conversation from a transcript under a temporary CLAUDE_CONFIG_DIR and gets what is appended, and is cut off by 撤销.
// Screenshots of 设置 · 手机 (Figma 45K) in both themes go to test-results/remote/.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import type { RemoteStatus } from '../src/shared/remote'
import { pairPhone, TestPhone, type PairedDevice } from '../src/main/remote/test-phone'
import { fakeHookClaude, type FakeAgentFolder } from './fake-hook-claude'
import { launchApp, setWindowSize } from './launch'

const SHOTS = join(process.cwd(), 'test-results', 'remote')
const WITHIN = { timeout: 20_000 }
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

interface Hooks {
  tr: {
    settings: { update(patch: unknown): Promise<unknown> }
    ui: { openSettings(): void }
    remote: { status(): Promise<RemoteStatus> }
  }
  __trWorkspace: { getState(): { addProject(path: string): string; addSession(projectId: string, kind: 'claude'): string | null; setActiveSession(id: string): void } }
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

test.describe('手机远程', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(120_000)

  const fake = fakeHookClaude('wavi-remote-')
  const claudeConfig = join(fake.root, 'claude-config')
  const conversation = join(claudeConfig, 'projects', 'acme')
  const transcript = join(conversation, 'remote-conversation.jsonl')
  let app: ElectronApplication
  let page: Page
  let folder: FakeAgentFolder
  let sessionId: string
  let url: string
  let paired: PairedDevice
  let phone: TestPhone

  /** What the fake received, without the bracketed-paste markers around each paste. */
  const typed = () => folder.typed().replaceAll('\x1b[200~', '').replaceAll('\x1b[201~', '')
  const status = () => page.evaluate(() => (globalThis as unknown as Hooks).tr.remote.status())

  test.beforeAll(async () => {
    mkdirSync(conversation, { recursive: true })
    mkdirSync(SHOTS, { recursive: true })
    folder = fake.folder('acme')
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: folder.path })
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: folder.path })
    const port = await freePort()
    url = `ws://127.0.0.1:${port}`
    app = await launchApp({ ...fake.env, CLAUDE_CONFIG_DIR: claudeConfig })
    page = await app.firstWindow()
    await page.addInitScript(() => {
      ;(globalThis as unknown as { __TR_E2E__: boolean }).__TR_E2E__ = true
    })
    await page.reload()
    await page.waitForSelector('[data-region="sidebar"]')
    await setWindowSize(app, page, 1440, 900)
    await page.evaluate((p) => (globalThis as unknown as Hooks).tr.settings.update({ remote: { port: p } }), port)
    sessionId = await page.evaluate((path) => {
      const ws = (globalThis as unknown as Hooks).__trWorkspace.getState()
      const id = ws.addSession(ws.addProject(path), 'claude') ?? ''
      ws.setActiveSession(id)
      return id
    }, realpathSync(folder.path))
    expect(sessionId).not.toBe('')
    await expect.poll(() => folder.pid(), WITHIN).not.toBeNull()
  })

  test.afterAll(async () => {
    phone?.close()
    await app?.close()
  })

  test('设置 · 手机 turns the server on and shows a pairing code (Figma 45K)', async () => {
    await page.evaluate(() => (globalThis as unknown as Hooks).tr.ui.openSettings())
    await page.getByRole('tab', { name: '手机' }).click()
    await expect(page.getByRole('switch', { name: '允许手机连接' })).toHaveAttribute('aria-checked', 'false')
    await page.getByRole('switch', { name: '允许手机连接' }).click()
    await expect(page.getByRole('img', { name: '配对二维码' })).toBeVisible(WITHIN)
    const current = await status()
    expect(current).toMatchObject({ enabled: true, listening: true })
    expect(current.pairing?.code).toMatch(/^[2-9A-HJ-NP-Z]{6}$/)
    await expect(page.getByLabel('配对', { exact: true })).toContainText(`${current.pairing!.code.slice(0, 3)}-${current.pairing!.code.slice(3)}`)
  })

  test('a phone pairs with the code and the page lists it as online', async () => {
    const current = await status()
    paired = await pairPhone(url, macKey(current.pairing!.link), current.pairing!.code, 'Jacoy 的 iPhone')
    phone = await TestPhone.connect(url, paired)
    await expect(page.getByRole('region', { name: '已配对的设备' })).toContainText('Jacoy 的 iPhone', WITHIN)
    await expect(page.getByRole('region', { name: '已配对的设备' })).toContainText('在线')
    for (const theme of ['dark', 'light'] as const) {
      await page.evaluate((t) => (globalThis as unknown as Hooks).tr.settings.update({ appearance: { theme: t } }), theme)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await page.waitForTimeout(300)
      await page.screenshot({ path: `${SHOTS}/settings-phone-${theme}.png` })
    }
    await page.keyboard.press('Escape')
  })

  test('the phone sees the sessions and types a prompt into the agent', async () => {
    await expect
      .poll(async () => {
        const answer = await phone.request({ type: 'snapshot' })
        return answer.ok ? (answer.data as { sessions: { id: string; agent: string }[] }).sessions : []
      }, WITHIN)
      .toEqual([expect.objectContaining({ id: sessionId, agent: 'claude' })])
    const answer = await phone.request({ type: 'send', session: sessionId, text: 'hello from the phone', photos: [] }, 20_000)
    expect(answer).toMatchObject({ ok: true })
    expect(typed()).toContain('hello from the phone<ENTER>')
  })

  test('a photo becomes a file whose path goes in before the text (F19)', async () => {
    const answer = await phone.request({ type: 'send', session: sessionId, text: '看这张截图', photos: [{ name: 'IMG_0001', data: PNG.toString('base64') }] }, 20_000)
    expect(answer).toMatchObject({ ok: true })
    const text = typed()
    const path = /\/wavi\/attachments\/phone-[^\s']+\.png/.exec(text)?.[0]
    expect(path).toBeTruthy()
    expect(text.indexOf(path!)).toBeLessThan(text.lastIndexOf('看这张截图<ENTER>'))
  })

  test('a permission request is held while the phone is connected and answered from it', async () => {
    folder.step({ hook: 'PermissionRequest', payload: { tool_name: 'Bash', tool_input: { command: 'pnpm add -D msw' }, permission_suggestions: [] } })
    const event = await phone.next((e) => e.event === 'prompts' && e.data.some((p) => p.kind === 'permission' && p.answerable), 20_000)
    const prompt = event.event === 'prompts' ? event.data.find((p) => p.kind === 'permission')! : null
    expect(prompt).toMatchObject({ sessionId, tool: 'Bash', answerable: true })
    expect(await phone.request({ type: 'permission', prompt: prompt!.id, decision: 'allow-once' })).toMatchObject({ ok: true })
    await phone.next((e) => e.event === 'prompts' && e.data.length === 0)
    expect(await phone.request({ type: 'permission', prompt: prompt!.id, decision: 'deny' })).toEqual(expect.objectContaining({ ok: false }))
  })

  test('the phone reads the conversation from the transcript and gets what is appended', async () => {
    const line = (o: object) => `${JSON.stringify({ timestamp: '2026-11-01T10:00:00.000Z', cwd: folder.path, ...o })}\n`
    appendFileSync(transcript, line({ type: 'user', message: { content: 'token 过期前 5 分钟续期' } }))
    appendFileSync(transcript, line({ type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'pnpm test' } }] } }))
    folder.step({ hook: 'UserPromptSubmit', payload: { transcript_path: transcript, prompt: 'x' } })
    await expect
      .poll(async () => {
        const answer = await phone.request({ type: 'feed', session: sessionId })
        return answer.ok ? (answer.data as { items: { kind: string }[] }).items.map((i) => i.kind) : []
      }, WITHIN)
      .toEqual(['user', 'tool'])
    const watched = await phone.request({ type: 'watch', session: sessionId })
    expect(watched).toMatchObject({ ok: true, data: { start: 0, total: 2 } })
    appendFileSync(transcript, line({ type: 'user', toolUseResult: { stdout: 'ok', stderr: '' }, message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } }))
    appendFileSync(transcript, line({ type: 'assistant', message: { id: 'm2', content: [{ type: 'text', text: '测试都过了。' }] } }))
    const pushed = await phone.next((e) => e.event === 'feed' && e.data.items.some((i) => i.kind === 'text'), 20_000)
    expect(pushed.event === 'feed' && pushed.data).toMatchObject({ session: sessionId, start: 1, items: [{ kind: 'tool', state: 'ok' }, { kind: 'text', text: '测试都过了。' }] })
  })

  test('撤销 forgets the phone and closes its connection', async () => {
    await page.evaluate(() => (globalThis as unknown as Hooks).tr.ui.openSettings())
    await page.getByRole('tab', { name: '手机' }).click()
    const closed = new Promise<number>((resolve) => phone.socket.once('close', (code) => resolve(code)))
    await page.getByRole('region', { name: '已配对的设备' }).getByRole('button', { name: '撤销' }).click()
    expect(await closed).toBe(4003)
    await expect(page.getByRole('region', { name: '已配对的设备' })).toHaveCount(0)
    await expect(TestPhone.connect(url, paired)).rejects.toThrow(/unknown device/)
    expect(readFileSync(join(fake.root, 'acme', '.fake-typed'), 'utf8')).toContain('hello from the phone')
  })
})
