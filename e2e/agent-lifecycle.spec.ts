// Agent lifecycle (phase 2a · A3/A4/A6/A7/A8, B7) against a fake `claude`: a shell script put first on the login
// shell's PATH through a throwaway ZDOTDIR, so no model, no hooks and no real CLI is involved.
// Its behaviour per launch comes from a mode file: `slow` (nothing for 4 s), `trust` (the trust dialog first),
// anything else draws the UI at once. It exits when it reads `/exit`.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentEvent } from '../src/shared/agent-events'
import { launchApp } from './launch'

const SHOTS = join(process.cwd(), 'test-results', 'agent-lifecycle')
const WITHIN = { timeout: 30_000 }

function outerClaudeEnv(): Record<string, undefined> {
  const strip: Record<string, undefined> = {}
  for (const key of Object.keys(process.env)) {
    if (key === 'CLAUDECODE' || key.startsWith('CLAUDE_CODE_') || key.startsWith('CLAUDE_AGENT_')) strip[key] = undefined
  }
  return strip
}

const FAKE_CLAUDE = `#!/bin/sh
mode=$(cat "$TR_FAKE_MODE_FILE" 2>/dev/null)
case "$mode" in
  trust)
    printf 'Do you trust the files in this folder?\\n\\n \\033[1m❯ 1. Yes, I trust this folder\\033[0m\\n   2. No, exit\\n'
    read -r _
    printf '\\033[2J\\033[H'
    ;;
  slow) sleep 4 ;;
esac
printf 'Claude Code v9.9.9\\n\\n❯ Try "how does it work?"\\n\\n  ⏸ manual mode on\\n'
while read -r line; do
  [ "$line" = "/exit" ] && exit 0
done
`

interface Hooks {
  tr: { pty: { write(id: string, data: string): void } }
  __trWorkspace: {
    getState(): {
      addProject(path: string): string
      addSession(projectId: string, kind: 'claude'): string | null
      patchSession(id: string, patch: Record<string, unknown>): void
    }
  }
  __trTerminals: { readScreen(id: string, scrollbackLines?: number): string }
  __trStatus: {
    emit(id: string, event: AgentEvent): void
    advance(ms: number): void
    state(id: string): { status: string; phase?: string } | undefined
  }
}

function setup(): { env: Record<string, string>; modeFile: string; project: string } {
  const root = mkdtempSync(join(tmpdir(), 'tr-e2e-lifecycle-'))
  const bin = join(root, 'bin')
  const zdot = join(root, 'zdot')
  const project = join(root, 'project')
  for (const dir of [bin, zdot, project]) mkdirSync(dir)
  writeFileSync(join(bin, 'claude'), FAKE_CLAUDE)
  chmodSync(join(bin, 'claude'), 0o755)
  // The user's own rc files are skipped (ZDOTDIR), so only this one decides what `claude` is.
  writeFileSync(join(zdot, '.zshrc'), `export PATH="${bin}:$PATH"\n`)
  const modeFile = join(root, 'mode')
  writeFileSync(modeFile, 'ui')
  return { env: { ZDOTDIR: zdot, TR_FAKE_MODE_FILE: modeFile, SHELL: '/bin/zsh' }, modeFile, project }
}

test.describe.configure({ mode: 'serial' })
// Shells start slowly on a busy machine; every wait below is bounded by WITHIN, not by the default 30 s.
test.setTimeout(90_000)

test.describe('agent lifecycle · fake claude', () => {
  const { env, modeFile, project } = setup()
  let app: ElectronApplication
  let page: Page
  let projectId = ''

  const screen = (id: string) => page.evaluate((i) => (globalThis as unknown as Hooks).__trTerminals.readScreen(i, 50), id)
  const activeId = () => page.evaluate(() => (globalThis as unknown as { __trWorkspace: { getState(): { activeSessionId: string } } }).__trWorkspace.getState().activeSessionId)
  const row = (id: string) => page.locator(`[data-region="sidebar"] [data-session-id="${id}"]`)
  const mode = (value: string) => writeFileSync(modeFile, value)
  const activeClass = () =>
    page.evaluate(() => (globalThis as unknown as { document: { activeElement: { className?: string } | null } }).document.activeElement?.className ?? '')
  const addSession = (): Promise<string> =>
    page.evaluate((id) => (globalThis as unknown as Hooks).__trWorkspace.getState().addSession(id, 'claude') ?? '', projectId)
  const write = (id: string, data: string) => page.evaluate(([i, d]) => (globalThis as unknown as Hooks).tr.pty.write(i as string, d as string), [id, data])
  const emit = (id: string, event: AgentEvent) => page.evaluate(([i, e]) => (globalThis as unknown as Hooks).__trStatus.emit(i as string, e as AgentEvent), [id, event])
  const advance = (ms: number) => page.evaluate((m) => (globalThis as unknown as Hooks).__trStatus.advance(m), ms)
  const stateOf = (id: string) => page.evaluate((i) => (globalThis as unknown as Hooks).__trStatus.state(i), id)
  const shot = async (name: string) => {
    for (const theme of ['dark', 'light'] as const) {
      await page.evaluate((t) => ((globalThis as unknown as { document: { documentElement: { dataset: Record<string, string> } } }).document.documentElement.dataset.theme = t), theme)
      await page.waitForTimeout(150)
      // Screenshots are artifacts, not assertions: a busy machine may stall one without the app being wrong.
      await page.screenshot({ path: join(SHOTS, `${name}-${theme}.png`), timeout: 20_000 }).catch(() => undefined)
    }
    await page.evaluate(() => ((globalThis as unknown as { document: { documentElement: { dataset: Record<string, string> } } }).document.documentElement.dataset.theme = 'dark'))
  }

  test.beforeAll(async () => {
    mkdirSync(SHOTS, { recursive: true })
    app = await launchApp({ ...outerClaudeEnv(), ...env })
    page = await app.firstWindow()
    await page.addInitScript(() => {
      ;(globalThis as unknown as { __TR_E2E__: boolean }).__TR_E2E__ = true
    })
    await page.reload()
    await page.waitForFunction(() => Boolean((globalThis as unknown as { __trStatus?: unknown }).__trStatus))
    projectId = await page.evaluate((root) => (globalThis as unknown as Hooks).__trWorkspace.getState().addProject(root), project)
  })

  test.afterAll(async () => {
    await app?.close()
  })

  test('starting: the sidebar says so until the agent draws its UI; the terminal has the keyboard throughout', async () => {
    mode('slow')
    const id = await addSession()
    await expect(row(id)).toContainText('正在启动 Claude Code…')
    await expect(row(id).getByRole('img', { name: '运行中' })).toBeVisible()
    await expect.poll(() => activeClass()).toContain('xterm-helper-textarea')
    await shot('starting')
    await expect(row(id)).not.toContainText('正在启动', WITHIN)
    await expect(page.getByRole('textbox', { name: '输入框' })).toHaveCount(0)
    await write(id, '/exit\r')
    await expect.poll(async () => (await stateOf(id))?.phase, WITHIN).toBe('exited')
  })

  test('a trust dialog blocks: status 等你处理, the keys go straight to the terminal; answering releases it', async () => {
    mode('trust')
    const id = await addSession()
    await expect.poll(async () => (await stateOf(id))?.phase, WITHIN).toBe('blocked')
    await expect(row(id)).toContainText('等你确认：信任此文件夹')
    await expect(row(id).getByRole('img', { name: '等你处理' })).toBeVisible()
    await expect.poll(() => activeClass()).toContain('xterm-helper-textarea')
    await shot('blocked')

    await page.keyboard.press('Enter')
    await expect.poll(async () => (await stateOf(id))?.phase, WITHIN).toBe('ready')
    await expect.poll(async () => (await stateOf(id))?.status).toBe('idle')
  })

  test('hooks that never report: the header says status follows the title; the first hook event clears it', async () => {
    const id = await page.evaluate(() => (globalThis as unknown as { __trWorkspace: { getState(): { activeSessionId: string } } }).__trWorkspace.getState().activeSessionId)
    await advance(7_000)
    await expect(page.getByTestId('hooks-unavailable')).toContainText('状态仅按标题判断', WITHIN)
    await shot('hooks-unavailable')
    await emit(id, { type: 'session-start' })
    await expect(page.getByTestId('hooks-unavailable')).toHaveCount(0)
  })

  test('/clear does not freeze the status: SessionEnd(clear) then SessionStart, and the next turn runs', async () => {
    const id = await page.evaluate(() => (globalThis as unknown as { __trWorkspace: { getState(): { activeSessionId: string } } }).__trWorkspace.getState().activeSessionId)
    await emit(id, { type: 'prompt-submit', prompt: 'x' })
    await expect.poll(async () => (await stateOf(id))?.status).toBe('running')
    await emit(id, { type: 'session-end', reason: 'clear' })
    await expect.poll(async () => (await stateOf(id))?.status).toBe('idle')
    await emit(id, { type: 'session-start' })
    await emit(id, { type: 'prompt-submit', prompt: 'y' })
    await expect.poll(async () => (await stateOf(id))?.status).toBe('running')
    await expect(row(id).getByRole('img', { name: '运行中' })).toBeVisible()
    await emit(id, { type: 'stop' })
  })

  test('the agent exiting leaves its login shell in the terminal, as in any terminal', async () => {
    const id = await activeId()
    mode('ui')
    await write(id, '/exit\r')
    await expect.poll(async () => (await stateOf(id))?.phase, WITHIN).toBe('exited')
    await expect(row(id)).toContainText('Claude Code 已退出')
    await write(id, 'echo tr-$((40+2))\r')
    await expect.poll(() => screen(id), WITHIN).toContain('tr-42')
    await shot('exited')
  })

  test('a restored session with a saved conversation resumes by itself when viewed', async () => {
    const id = await addSession()
    await expect.poll(async () => (await stateOf(id))?.phase, WITHIN).toBe('ready')
    await page.evaluate(([i]) => (globalThis as unknown as Hooks).__trWorkspace.getState().patchSession(i as string, { phase: 'not-started', agentSessionId: 'conv-1', title: 'Cookie 会话迁移' }), [id])
    await expect.poll(async () => (await stateOf(id))?.phase, WITHIN).toBe('ready')
    await expect(page.getByTestId('lifecycle-card')).toHaveCount(0)
  })

  test('a missing project directory is refused in the terminal, not started in the home directory', async () => {
    const gone = join(project, 'does-not-exist')
    const id = await page.evaluate((path) => {
      const ws = (globalThis as unknown as Hooks).__trWorkspace.getState()
      return ws.addSession(ws.addProject(path), 'claude') ?? ''
    }, gone)
    await expect.poll(() => screen(id), WITHIN).toContain(`[项目目录不存在：${gone}]`)
    await expect(row(id)).toContainText('Claude Code 已退出')
    await shot('missing-directory')
  })
})

test.describe('agent lifecycle · CLI not installed', () => {
  test('a missing claude command prints an install hint in the terminal', async () => {
    const { env, project } = setup()
    // The fake is not on PATH here: a bare system PATH has no `claude`.
    const app = await launchApp({ ...outerClaudeEnv(), ...env, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', ZDOTDIR: mkdtempSync(join(tmpdir(), 'tr-e2e-zdot-')) })
    try {
      const page = await app.firstWindow()
      await page.addInitScript(() => {
        ;(globalThis as unknown as { __TR_E2E__: boolean }).__TR_E2E__ = true
      })
      await page.reload()
      await page.waitForFunction(() => Boolean((globalThis as unknown as { __trStatus?: unknown }).__trStatus))
      const id = await page.evaluate((root) => {
        const ws = (globalThis as unknown as Hooks).__trWorkspace.getState()
        return ws.addSession(ws.addProject(root), 'claude') ?? ''
      }, project)
      await expect
        .poll(() => page.evaluate((i) => (globalThis as unknown as Hooks).__trTerminals.readScreen(i, 50), id), WITHIN)
        .toContain('[没有找到 claude 命令 · 安装：npm install -g @anthropic-ai/claude-code]')
      mkdirSync(SHOTS, { recursive: true })
      await page.screenshot({ path: join(SHOTS, 'missing-cli-dark.png') })
    } finally {
      await app.close()
    }
  })
})
