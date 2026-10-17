// Claude Code hooks bridge against the real CLI, inside the app (PRD §4 F3, PRD §6.6).
// Opt-in (it calls the model, 2 short turns): TR_E2E_AGENTS=claude npm run test:e2e -- hooks
// A Bash permission is raised in a fixed, already-trusted lab directory (one trust entry in ~/.claude.json,
// ever); the lab's .claude/settings.local.json pins the permission mode to "default" so Claude asks.
// Answer 1: through window.tr.agent.respondPermission -> the hook returns the decision, the command runs.
// Answer 2: directly in the TUI -> the held hook is released and the prompt is resolved as 'terminal'.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import type { TrApi } from '../src/shared/ipc'
import { launchApp } from './launch'

const enabled = (process.env.TR_E2E_AGENTS ?? '').split(',').includes('claude')
const LAB = '/tmp/tr-hooks-lab'

interface Hooks {
  tr: TrApi
  __trTerminals: { readScreen(id: string, scrollback?: number): string }
  __trWorkspace: { getState(): { addProject(path: string): string; addSession(projectId: string, kind: 'claude'): string | null } }
  __trSeen: {
    events: Array<{ sessionId: string; event: { type: string; tool?: string; ok?: boolean } }>
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

function ensureLab(): void {
  mkdirSync(`${LAB}/.claude`, { recursive: true })
  if (!existsSync(`${LAB}/.git`)) {
    execFileSync('git', ['init', '-q'], { cwd: LAB })
    writeFileSync(`${LAB}/README.md`, '# hooks lab\n')
    execFileSync('git', ['add', '.'], { cwd: LAB })
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init'], { cwd: LAB })
  }
  writeFileSync(`${LAB}/.claude/settings.local.json`, JSON.stringify({ permissions: { defaultMode: 'default' } }))
}

test.describe('claude hooks bridge', () => {
  test.skip(!enabled, 'set TR_E2E_AGENTS=claude to run the real-Claude hooks test')
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(240_000)

  let app: ElectronApplication
  let page: Page
  let sessionId: string

  const screen = () => page.evaluate((id) => (globalThis as unknown as Hooks).__trTerminals.readScreen(id, 5000), sessionId)
  const seen = () => page.evaluate(() => (globalThis as unknown as Hooks).__trSeen)
  const write = (data: string) => page.evaluate(([id, d]) => (globalThis as unknown as Hooks).tr.pty.write(id as string, d as string), [sessionId, data])

  /** Types the prompt into the terminal, then presses ↵ once the agent has drawn it, as a user would. */
  async function send(text: string): Promise<void> {
    await write(text)
    await page.waitForTimeout(500)
    await write('\r')
  }

  test.beforeAll(async () => {
    ensureLab()
    app = await launchApp(outerClaudeEnv())
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
      return ws.addSession(ws.addProject(root), 'claude') ?? ''
    }, LAB)
    expect(sessionId).not.toBe('')
    // The lab is trusted already; if it is not (fresh machine) accept the one-time trust dialog.
    await expect.poll(screen, { timeout: 60_000, intervals: [500] }).toMatch(/\? for shortcuts|manual mode|❯ 1\. Yes|Yes, I trust/)
    if (/Yes, I trust/.test(await screen())) {
      await page.waitForTimeout(2500)
      await page.evaluate((id) => (globalThis as unknown as Hooks).tr.pty.write(id, '\x1b[B'), sessionId)
      await page.waitForTimeout(400)
      await page.evaluate((id) => (globalThis as unknown as Hooks).tr.pty.write(id, '\r'), sessionId)
      await expect.poll(screen, { timeout: 30_000, intervals: [500] }).toMatch(/\? for shortcuts|manual mode/)
    }
    await page.waitForTimeout(1500)
  })

  test.afterAll(async () => {
    await app?.close()
  })

  test('session-start arrives from the injected hooks', async () => {
    await expect.poll(async () => (await seen()).events.map((e) => e.event.type), { timeout: 15_000 }).toContain('session-start')
    expect((await seen()).events.every((e) => e.sessionId === sessionId)).toBe(true)
  })

  test('a Bash permission is answered through respondPermission and the command runs', async () => {
    const marker = `hooks-e2e-${Date.now()}`
    const file = `${LAB}/${marker}.txt`
    rmSync(file, { force: true })
    await send(`Use the Bash tool to run exactly: echo ${marker} > ${file}   Then reply DONE.`)

    await expect.poll(async () => (await seen()).prompts.filter((p) => p.kind === 'permission').length, { timeout: 90_000, intervals: [300] }).toBe(1)
    const prompt = (await seen()).prompts.find((p) => p.kind === 'permission')!
    expect(prompt.sessionId).toBe(sessionId)
    expect(prompt.tool).toBe('Bash')
    expect(prompt.summary).toContain('运行')
    expect(prompt.summary).toContain(marker)
    expect(existsSync(file)).toBe(false) // still blocked

    await page.evaluate((id) => (globalThis as unknown as Hooks).tr.agent.respondPermission(id, 'allow-once'), prompt.id)

    await expect.poll(() => existsSync(file), { timeout: 30_000 }).toBe(true)
    expect(readFileSync(file, 'utf8').trim()).toBe(marker)
    await expect.poll(async () => (await seen()).resolved.find((r) => r.id === prompt.id)?.by).toBe('gui')
    await expect.poll(async () => (await seen()).events.filter((e) => e.event.type === 'stop').length, { timeout: 60_000 }).toBe(1)
    // The TUI recorded that the hook allowed it.
    expect(await screen()).toMatch(/Allowed by PermissionRequest hook|DONE/)
    const types = (await seen()).events.map((e) => e.event.type)
    expect(types).toEqual(expect.arrayContaining(['prompt-submit', 'tool-start', 'tool-end', 'stop']))
    rmSync(file, { force: true })
  })

  test('answering in the TUI releases the held hook and resolves the prompt as terminal', async () => {
    const marker = `hooks-e2e-tui-${Date.now()}`
    const file = `${LAB}/${marker}.txt`
    rmSync(file, { force: true })
    const before = (await seen()).prompts.filter((p) => p.kind === 'permission').length
    await send(`Use the Bash tool to run exactly: echo ${marker} > ${file}   Then reply DONE.`)

    await expect.poll(async () => (await seen()).prompts.filter((p) => p.kind === 'permission').length, { timeout: 90_000, intervals: [300] }).toBe(before + 1)
    const prompt = (await seen()).prompts.filter((p) => p.kind === 'permission').at(-1)!
    // Claude shows its own dialog while our hook is pending (spike §4): pick "1. Yes" there.
    await expect.poll(screen, { timeout: 15_000 }).toMatch(/Do you want to proceed\?/)
    await page.evaluate((id) => (globalThis as unknown as Hooks).tr.pty.write(id, '1'), sessionId)

    await expect.poll(() => existsSync(file), { timeout: 30_000 }).toBe(true)
    await expect.poll(async () => (await seen()).resolved.find((r) => r.id === prompt.id)?.by, { timeout: 15_000 }).toBe('terminal')
    rmSync(file, { force: true })
  })
})
