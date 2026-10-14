// M2 / MVP acceptance against the real Claude CLI, driven only through the UI (PRD §8 M2).
// Opt-in (calls the model, 3 short turns): TR_E2E_AGENTS=claude npm run test:e2e -- mvp
// Flow: composer → Claude asks for Bash permission → sidebar shows 等你处理 → prompt bar 允许一次
//       → command runs → status leaves 等你处理; then an AskUserQuestion answered by clicking an option.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { launchApp } from './launch'

const enabled = (process.env.TR_E2E_AGENTS ?? '').split(',').includes('claude')
// Same lab as hooks.spec.ts: already trusted, so no new ~/.claude.json entries.
const LAB = '/tmp/tr-hooks-lab'

interface Hooks {
  __trTerminals: { readScreen(id: string, scrollback?: number): string }
  __trWorkspace: { getState(): { addProject(path: string): string; addSession(projectId: string, kind: 'claude'): string | null } }
  tr: { pty: { write(id: string, data: string): void } }
}

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

test.describe('MVP: status + one-click answers with real Claude', () => {
  test.skip(!enabled, 'set TR_E2E_AGENTS=claude to run the real-Claude MVP test')
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(240_000)

  let app: ElectronApplication
  let page: Page
  let sessionId: string

  const screen = () => page.evaluate((id) => (globalThis as unknown as Hooks).__trTerminals.readScreen(id, 5000), sessionId)
  const composer = () => page.getByRole('textbox', { name: '输入框' })
  const row = () => page.locator(`[data-region="sidebar"] [data-session-id="${sessionId}"]`)
  const rowStatus = () => row().getByRole('img').getAttribute('aria-label')
  const bar = () => page.locator('[data-region="prompt-bar"]')

  async function send(text: string): Promise<void> {
    await composer().fill(text)
    await composer().press('Enter')
  }

  test.beforeAll(async () => {
    ensureLab()
    app = await launchApp(outerClaudeEnv())
    page = await app.firstWindow()
    await page.addInitScript(() => {
      ;(globalThis as unknown as { __TR_E2E__: boolean }).__TR_E2E__ = true
    })
    await page.reload()
    sessionId = await page.evaluate((root) => {
      const ws = (globalThis as unknown as Hooks).__trWorkspace.getState()
      return ws.addSession(ws.addProject(root), 'claude') ?? ''
    }, LAB)
    expect(sessionId).not.toBe('')
    await expect.poll(screen, { timeout: 60_000, intervals: [500] }).toMatch(/\? for shortcuts|manual mode/)
    await expect(composer()).toBeEnabled()
    await page.waitForTimeout(1500)
  })

  test.afterAll(async () => {
    await app?.close()
  })

  test('permission: sidebar shows 等你处理, 允许一次 in the prompt bar runs the command', async () => {
    const marker = `mvp-${Date.now()}`
    const file = `${LAB}/${marker}.txt`
    rmSync(file, { force: true })
    await send(`Use the Bash tool to run exactly: echo ${marker} > ${file}   Then reply DONE.`)

    await expect.poll(rowStatus, { timeout: 30_000 }).toBe('运行中')
    await expect(bar()).toBeVisible({ timeout: 90_000 })
    await expect(bar()).toHaveAttribute('data-prompt-kind', 'permission')
    await expect(bar()).toContainText(marker)
    await expect.poll(rowStatus, { timeout: 5_000 }).toBe('等你处理')
    expect(existsSync(file)).toBe(false)
    await page.screenshot({ path: 'test-results/mvp-permission.png' })

    await bar().getByRole('button', { name: '允许一次' }).click()

    await expect.poll(() => existsSync(file), { timeout: 30_000 }).toBe(true)
    expect(readFileSync(file, 'utf8').trim()).toBe(marker)
    await expect(bar()).toBeHidden()
    // The default "Claude Code" title is replaced by the first prompt.
    await expect(row()).toContainText('Use the Bash tool to run exactly')
    // Finished while the user is looking at it → idle (not done_unread).
    await expect.poll(rowStatus, { timeout: 60_000 }).toBe('空闲')
    rmSync(file, { force: true })
  })

  test('question: clicking an option in the prompt bar answers AskUserQuestion', async () => {
    await send(
      'Use the AskUserQuestion tool exactly once to ask "Pick a colour" with the options Red, Green and Blue (single select). After I answer, reply with only the colour I picked, in upper case.'
    )
    await expect(bar()).toBeVisible({ timeout: 90_000 })
    await expect(bar()).toHaveAttribute('data-prompt-kind', 'question')
    await expect.poll(rowStatus, { timeout: 5_000 }).toBe('等你处理')
    await page.screenshot({ path: 'test-results/mvp-question.png' })

    await bar().getByRole('button', { name: /Green/ }).click()

    await expect(bar()).toBeHidden({ timeout: 15_000 })
    await expect.poll(screen, { timeout: 60_000 }).toMatch(/GREEN/)
    await expect.poll(rowStatus, { timeout: 60_000 }).toBe('空闲')
  })
})
