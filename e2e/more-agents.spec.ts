// More agent CLIs (ROADMAP 7, PRD F4 v1.68, Figma 24A / 25B). A fake `opencode` on the login shell's PATH speaks OSC 7501
// Program Status the way OpenCode 2 / Grok / Pi do: it asks `OSC 7501 ; ?`, waits for the terminal's answer, then
// reports `working` and `blocked`. The test picks it from 新建会话's 智能体 menu, checks Wavi answered the query and that
// the sidebar status follows the reports, and looks at 设置 · 智能体. Screenshots of both themes go to
// test-results/more-agents/.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { outerClaudeEnv } from './fake-claude'
import { launchApp } from './launch'

const SHOTS = 'test-results/more-agents'
const WITHIN = { timeout: 15_000 }

// Raw mode with a 3 s read timeout: the terminal's answer to the query is read without echo, then logged.
const FAKE_OPENCODE = `#!/bin/sh
if [ "$1" = "--version" ]; then echo "opencode 2.1.4"; exit 0; fi
printf '%s\\n' "$*" >> "$TR_FAKE_LOG.argv"
stty -echo -icanon min 0 time 30 2>/dev/null
printf '\\033]7501;?\\033\\\\'
reply=$(dd bs=64 count=1 2>/dev/null | od -An -c | tr -d ' \\n')
case "$reply" in *7501*) printf 'answered\\n' >> "$TR_FAKE_LOG" ;; *) printf 'unanswered\\n' >> "$TR_FAKE_LOG" ;; esac
printf 'OpenCode (fake)\\n'
printf '\\033]7501;state=working:app=opencode\\033\\\\'
sleep 2
printf '\\033]7501;state=blocked:app=opencode:kind=permission:msg=%s\\033\\\\' "$(printf 'Edit src/a.ts' | base64)"
sleep 120
`

interface Hooks {
  __trWorkspace: { getState(): { addProject(path: string): string; sessions: Array<{ id: string; kind: string }> } }
  __trStatus: { state(id: string): { status: string; currentAction?: string } | undefined }
  tr: { settings: { update(patch: unknown): Promise<unknown> }; ui: { openSettings(): void } }
}

test.describe('more agent CLIs', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(120_000)

  let app: ElectronApplication
  let page: Page
  let root = ''
  let log = ''
  let project = ''

  const sheet = () => page.getByTestId('new-session-sheet')

  test.beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'tr-more-agents-'))
    const bin = join(root, 'bin')
    const zdot = join(root, 'zdot')
    project = join(root, 'repo')
    for (const dir of [bin, zdot, project]) mkdirSync(dir)
    writeFileSync(join(bin, 'opencode'), FAKE_OPENCODE)
    chmodSync(join(bin, 'opencode'), 0o755)
    writeFileSync(join(zdot, '.zshrc'), `export PATH="${bin}:$PATH"\n`)
    log = join(root, 'opencode.log')
    writeFileSync(log, '')
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: project })
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: project })
    project = realpathSync(project)
    // Main only reads git state for projects it knows from workspace.json (the fixture workspace is never saved).
    const profile = join(root, 'profile')
    mkdirSync(profile)
    writeFileSync(
      join(profile, 'workspace.json'),
      JSON.stringify({
        version: 2,
        projects: [{ id: 'p-repo', name: 'repo', rootPath: project }],
        worktrees: [{ id: 'w-repo', projectId: 'p-repo', branch: 'main', path: project, isMain: true }],
        sessions: [],
        activeSessionId: null,
        sidebarCollapsed: false,
        rightPanel: null,
        drafts: {}
      })
    )
    app = await launchApp({ ...outerClaudeEnv(), ZDOTDIR: zdot, SHELL: '/bin/zsh', TR_FAKE_LOG: log }, { userDataDir: profile })
    page = await app.firstWindow()
    await page.addInitScript(() => {
      ;(globalThis as unknown as { __TR_E2E__: boolean }).__TR_E2E__ = true
    })
    await page.reload()
    await page.waitForSelector('[data-region="sidebar"]')
    await page.evaluate((path) => (globalThis as unknown as Hooks).__trWorkspace.getState().addProject(path), project)
  })

  test.afterAll(async () => {
    await app?.close()
  })

  test('新建会话 lists the installed CLI in 智能体 and starts it; OSC 7501 drives its status', async () => {
    await page.keyboard.press('Meta+N')
    await expect(sheet()).toBeVisible()
    await sheet().getByRole('button', { name: '项目' }).click()
    await page.getByRole('listbox', { name: '项目' }).getByRole('option', { name: 'repo' }).click()
    await sheet().getByRole('button', { name: '智能体' }).click()
    const menu = page.getByRole('listbox', { name: '智能体' })
    await expect(menu.getByRole('option', { name: 'OpenCode' })).toBeVisible(WITHIN)
    await expect(menu.getByRole('option', { name: 'Claude Code' })).toBeVisible()
    await expect(menu.getByRole('option', { name: '终端' })).toBeVisible()
    mkdirSync(SHOTS, { recursive: true })
    for (const theme of ['dark', 'light'] as const) {
      await page.evaluate((t) => (globalThis as unknown as Hooks).tr.settings.update({ appearance: { theme: t } }), theme)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await page.waitForTimeout(300)
      await page.screenshot({ path: `${SHOTS}/agent-menu-${theme}.png` })
    }
    await menu.getByRole('option', { name: 'OpenCode' }).click()
    await expect(sheet().getByRole('button', { name: '智能体' })).toContainText('OpenCode')
    if (await sheet().getByRole('radio', { name: '当前目录' }).isEnabled()) await sheet().getByRole('radio', { name: '当前目录' }).click()
    await page.keyboard.press('Meta+Enter')
    await expect(sheet()).toBeHidden()

    const sessionId = await page.evaluate(() => (globalThis as unknown as Hooks).__trWorkspace.getState().sessions.find((s) => s.kind === 'opencode')?.id)
    expect(sessionId).toBeTruthy()
    const status = () => page.evaluate((id) => (globalThis as unknown as Hooks).__trStatus.state(id as string), sessionId)
    // Wavi answered the query, so the CLI reports; `blocked` with a message becomes 等你处理 with that line.
    await expect.poll(() => readFileSync(log, 'utf8'), WITHIN).toContain('answered')
    await expect.poll(async () => (await status())?.status, WITHIN).toBe('needs_you')
    expect((await status())?.currentAction).toBe('Edit src/a.ts')
    expect(readFileSync(`${log}.argv`, 'utf8').trim()).toBe('')
  })

  test('设置 · 智能体 lists what is installed with its status source, and how to install the rest', async () => {
    await page.evaluate(() => (globalThis as unknown as Hooks).tr.ui.openSettings())
    await page.getByRole('tab', { name: '智能体' }).click()
    const pane = page.locator('#settings-pane')
    await expect(pane.getByRole('group', { name: 'OpenCode' })).toBeVisible(WITHIN)
    await expect(pane.getByRole('button', { name: '复制安装命令' }).first()).toBeVisible()
    for (const theme of ['dark', 'light'] as const) {
      await page.evaluate((t) => (globalThis as unknown as Hooks).tr.settings.update({ appearance: { theme: t } }), theme)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await page.waitForTimeout(300)
      await page.screenshot({ path: `${SHOTS}/settings-agents-${theme}.png` })
    }
  })
})
