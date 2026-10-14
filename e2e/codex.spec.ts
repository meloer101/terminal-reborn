// Codex parity inside the app (PRD §4 F2/F3, docs/spikes/codex.md): per-launch hooks reach the status machine,
// and a shell approval is answered from the prompt bar's API (window.tr.agent.respondPermission).
// Opt-in because it needs the `codex` CLI on the login shell's PATH: TR_E2E_AGENTS=codex npm run test:e2e -- codex
//
// Default mode drives the REAL Codex binary (TUI, sandbox/approval logic, hooks) against a scripted local model
// (scripts/spikes/codex-mock-provider.mjs) with a throw-away CODEX_HOME, so no provider, account or ~/.codex file is
// involved. Set TR_E2E_CODEX_REAL=1 to use the user's own config and model provider instead (2 short model turns;
// the provider has answered 503 before, then the test fails on its first poll rather than hanging).
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TrApi } from '../src/shared/ipc'
import { startMockProvider, type MockProvider } from '../scripts/spikes/codex-mock-provider.mjs'
import { launchApp } from './launch'

const enabled = (process.env.TR_E2E_AGENTS ?? '').split(',').includes('codex')
const real = process.env.TR_E2E_CODEX_REAL === '1'
const LAB = '/tmp/tr-codex-lab'

interface Hooks {
  tr: TrApi
  __trTerminals: { readScreen(id: string, scrollback?: number): string }
  __trWorkspace: { getState(): { addProject(path: string): string; addSession(projectId: string, kind: 'codex'): string | null } }
  __trStatus: { state(id: string): { status: string; currentAction?: string } | undefined }
  __trSeen: {
    events: Array<{ sessionId: string; agent: string; event: { type: string; tool?: string; ok?: boolean } }>
    prompts: Array<{ kind: string; id: string; sessionId: string; tool?: string; summary?: string; canAllowAlways?: boolean }>
    resolved: Array<{ id: string; by: string }>
  }
}

/** Markers of the Claude Code session running this suite (if any); agent PTYs would inherit them. */
function outerClaudeEnv(): Record<string, undefined> {
  const strip: Record<string, undefined> = {}
  for (const key of Object.keys(process.env)) {
    if (key === 'CLAUDECODE' || key.startsWith('CLAUDE_CODE_') || key.startsWith('CLAUDE_AGENT_')) strip[key] = undefined
  }
  return strip
}

function ensureLab(): string {
  mkdirSync(LAB, { recursive: true })
  if (!existsSync(`${LAB}/.git`)) {
    execFileSync('git', ['init', '-q'], { cwd: LAB })
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: LAB })
  }
  return realpathSync(LAB)
}

test.describe('codex hooks', () => {
  test.skip(!enabled, 'set TR_E2E_AGENTS=codex to run the Codex hooks test')
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(240_000)

  let app: ElectronApplication
  let page: Page
  let mock: MockProvider | undefined
  let home = ''
  let lab = ''
  let sessionId: string

  const screen = () => page.evaluate((id) => (globalThis as unknown as Hooks).__trTerminals.readScreen(id, 5000), sessionId)
  const seen = () => page.evaluate(() => (globalThis as unknown as Hooks).__trSeen)
  const status = () => page.evaluate((id) => (globalThis as unknown as Hooks).__trStatus.state(id)?.status, sessionId)
  const composer = () => page.getByRole('textbox', { name: '输入框' })
  const permissionPrompts = async () => (await seen()).prompts.filter((p) => p.kind === 'permission')

  async function send(text: string): Promise<void> {
    await composer().fill(text)
    await composer().press('Enter')
  }

  test.beforeAll(async () => {
    lab = ensureLab()
    const env: Record<string, string | undefined> = outerClaudeEnv()
    if (!real) {
      mock = await startMockProvider()
      home = mkdtempSync(join(tmpdir(), 'tr-codex-home-'))
      // A throw-away Codex home: nothing of the user's config, auth, sessions or hooks is involved.
      writeFileSync(
        join(home, 'config.toml'),
        [
          'model = "gpt-5.5"',
          'model_provider = "mock"',
          'approval_policy = "untrusted"',
          'check_for_update_on_startup = false',
          '[model_providers.mock]',
          'name = "mock"',
          `base_url = "http://127.0.0.1:${mock.port}/v1"`,
          'wire_api = "responses"',
          'requires_openai_auth = false'
        ].join('\n')
      )
      env.CODEX_HOME = home
    }
    app = await launchApp(env)
    page = await app.firstWindow()
    await page.addInitScript(() => {
      const g = globalThis as unknown as Hooks & { __TR_E2E__: boolean }
      g.__TR_E2E__ = true
      const log: Hooks['__trSeen'] = { events: [], prompts: [], resolved: [] }
      g.__trSeen = log
      g.tr.agent.onEvent((e) => log.events.push(e as unknown as Hooks['__trSeen']['events'][number]))
      g.tr.agent.onPrompt((p) => log.prompts.push(p as unknown as Hooks['__trSeen']['prompts'][number]))
      g.tr.agent.onPromptResolved((r) => log.resolved.push(r))
    })
    await page.reload()
    sessionId = await page.evaluate((root) => {
      const ws = (globalThis as unknown as Hooks).__trWorkspace.getState()
      return ws.addSession(ws.addProject(root), 'codex') ?? ''
    }, lab)
    expect(sessionId).not.toBe('')
    // Codex's prompt glyph. The first launch of a real config may also show MCP startup warnings.
    await expect.poll(screen, { timeout: 60_000, intervals: [500] }).toMatch(/›/)
    await expect(composer()).toBeEnabled()
    await page.waitForTimeout(3000)
  })

  test.afterAll(async () => {
    await app?.close()
    await mock?.close()
    if (home) rmSync(home, { recursive: true, force: true })
  })

  test('hooks were injected for this launch only, with trust pinned through -c', async () => {
    // A trusted hook is what lets SessionStart (sent with the first prompt) through; this test sends it.
    await send(real ? 'Reply with only the word OK.' : 'REPLY: OK')
    await expect.poll(async () => (await seen()).events.map((e) => e.event.type), { timeout: 90_000, intervals: [300] }).toEqual(
      expect.arrayContaining(['session-start', 'prompt-submit', 'stop'])
    )
    const events = (await seen()).events
    expect(events.every((e) => e.sessionId === sessionId && e.agent === 'codex')).toBe(true)
    // Not through the global config: the process list shows -c hooks.*, and a throw-away home has no hooks.json.
    const ps = execFileSync('ps', ['-axo', 'args']).toString()
    expect(ps).toMatch(/hooks\.PermissionRequest=/)
    expect(ps).toMatch(/hooks\.state=/)
    expect(ps).not.toMatch(/dangerously-bypass-hook-trust/)
  })

  test('status follows the turn: running while it works, back to idle/done after the stop', async () => {
    await expect.poll(status, { timeout: 15_000 }).toMatch(/^(idle|done_unread)$/)
    const before = (await seen()).events.length
    await send(real ? 'Reply with only the word OK.' : 'REPLY: OK')
    await expect.poll(async () => (await seen()).events.length, { timeout: 60_000 }).toBeGreaterThan(before)
    await expect.poll(async () => (await seen()).events.filter((e) => e.event.type === 'stop').length, { timeout: 60_000 }).toBeGreaterThanOrEqual(2)
    await expect.poll(status, { timeout: 15_000 }).toMatch(/^(idle|done_unread)$/)
  })

  test('a shell approval is held in the app, answered through respondPermission, and the command runs', async () => {
    test.skip(real, 'the real provider run only checks delivery and status')
    const marker = `codex-e2e-${Date.now()}`
    const file = `${lab}/${marker}.txt`
    rmSync(file, { force: true })
    const before = (await permissionPrompts()).length
    await send(`RUN: echo ${marker} > ${file}`)

    await expect.poll(async () => (await permissionPrompts()).length, { timeout: 60_000, intervals: [300] }).toBe(before + 1)
    const prompt = (await permissionPrompts()).at(-1)!
    expect(prompt.sessionId).toBe(sessionId)
    expect(prompt.tool).toBe('Bash')
    expect(prompt.summary).toContain('运行')
    expect(prompt.summary).toContain(marker)
    expect(prompt.canAllowAlways).toBe(false) // Codex's "don't ask again" would write ~/.codex rules
    await expect.poll(status, { timeout: 5_000 }).toBe('needs_you')
    expect(existsSync(file)).toBe(false) // blocked in the hook; Codex does not even show its own dialog yet
    expect(await screen()).not.toMatch(/Would you like to run the following command\?/)

    await page.evaluate((id) => (globalThis as unknown as Hooks).tr.agent.respondPermission(id, 'allow-once'), prompt.id)

    await expect.poll(() => existsSync(file), { timeout: 30_000 }).toBe(true)
    expect(readFileSync(file, 'utf8').trim()).toBe(marker)
    await expect.poll(async () => (await seen()).resolved.find((r) => r.id === prompt.id)?.by).toBe('gui')
    await expect.poll(async () => (await seen()).events.filter((e) => e.event.type === 'tool-end').length, { timeout: 30_000 }).toBeGreaterThanOrEqual(1)
    await expect.poll(status, { timeout: 30_000 }).toMatch(/^(idle|done_unread)$/)
    rmSync(file, { force: true })
  })

  test('denying from the app stops the command and lets the turn finish', async () => {
    test.skip(real, 'the real provider run only checks delivery and status')
    const marker = `codex-e2e-deny-${Date.now()}`
    const file = `${lab}/${marker}.txt`
    const before = (await permissionPrompts()).length
    await send(`RUN: echo ${marker} > ${file}`)
    await expect.poll(async () => (await permissionPrompts()).length, { timeout: 60_000, intervals: [300] }).toBe(before + 1)
    const prompt = (await permissionPrompts()).at(-1)!
    const stops = (await seen()).events.filter((e) => e.event.type === 'stop').length
    await page.evaluate((id) => (globalThis as unknown as Hooks).tr.agent.respondPermission(id, 'deny'), prompt.id)
    await expect.poll(async () => (await seen()).events.filter((e) => e.event.type === 'stop').length, { timeout: 30_000 }).toBe(stops + 1)
    expect(existsSync(file)).toBe(false)
  })

  test('interrupting in the terminal while a request is held withdraws the stale prompt on the next turn', async () => {
    test.skip(real, 'the real provider run only checks delivery and status')
    // Codex hides its own dialog while our hook holds the request, and Esc cancels the whole turn without any hook
    // event (0.142.5 has no Interrupt hook). The prompt stays until something proves the turn moved on.
    const marker = `codex-e2e-esc-${Date.now()}`
    const file = `${lab}/${marker}.txt`
    const before = (await permissionPrompts()).length
    await send(`RUN: echo ${marker} > ${file}`)
    await expect.poll(async () => (await permissionPrompts()).length, { timeout: 60_000, intervals: [300] }).toBe(before + 1)
    const prompt = (await permissionPrompts()).at(-1)!
    await page.evaluate(([id, data]) => (globalThis as unknown as Hooks).tr.pty.write(id!, data!), [sessionId, '\x1b'])
    await expect.poll(screen, { timeout: 15_000 }).toMatch(/Conversation interrupted/)
    // The idle title heals the status even though no Stop arrived.
    await expect.poll(status, { timeout: 20_000 }).toMatch(/^(idle|done_unread)$/)
    await send('REPLY: OK')
    await expect.poll(async () => (await seen()).resolved.find((r) => r.id === prompt.id)?.by, { timeout: 30_000 }).toBe('terminal')
    expect(existsSync(file)).toBe(false)
  })
})
