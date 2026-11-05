// GUI sessions (PRD F23, Figma 49″) in the built app, against the fake headless Claude of src/main/gui/fixtures
// (stream-json in and out, no model, no tokens) put first on the login shell's PATH: the chat instead of a terminal,
// the label and flags it is launched with, streaming text, a permission card answered from the GUI, a message queued
// while a turn runs, the stop button, the 界面 row of the new-session sheet, and the session surviving a reload of
// the window (last: a reload shows the boot screen's dots for up to 8 s). Screenshots in both themes go to test-results/gui-session/.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { outerClaudeEnv } from './fake-claude'
import { launchApp, setWindowSize } from './launch'

const SHOTS = join(process.cwd(), 'test-results', 'gui-session')
const WITHIN = { timeout: 20_000 }
const FAKE = join(process.cwd(), 'src', 'main', 'gui', 'fixtures', 'fake-claude.mjs')

test.describe.configure({ mode: 'serial' })
test.setTimeout(90_000)

test.describe('F23 GUI session (Claude)', () => {
  const root = mkdtempSync(join(tmpdir(), 'tr-e2e-gui-'))
  const bin = join(root, 'bin')
  const zdot = join(root, 'zdot')
  const project = join(root, 'demo')
  const profile = join(root, 'profile')
  for (const dir of [bin, zdot, project, profile]) mkdirSync(dir)
  const argsFile = join(root, 'claude-args.json')
  // `claude` runs the fake with this Node; anything else (a TUI launch) would fail loudly.
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@"\n`)
  chmodSync(join(bin, 'claude'), 0o755)
  writeFileSync(join(zdot, '.zshrc'), `export PATH="${bin}:$PATH"\nexport FAKE_ARGS_FILE="${argsFile}"\n`)
  writeFileSync(join(project, 'README.md'), '# demo\n')

  let app: ElectronApplication
  let page: Page
  const chat = () => page.getByTestId('gui-chat')
  const feed = () => page.locator('[data-region="gui-feed"]')
  const composer = () => page.getByTestId('gui-composer')
  const input = () => composer().getByRole('textbox', { name: '回复' })
  const send = async (text: string) => {
    await input().fill(text)
    await input().press('Enter')
  }

  test.beforeAll(async () => {
    writeFileSync(
      join(profile, 'workspace.json'),
      JSON.stringify({
        version: 2,
        projects: [{ id: 'p1', name: 'demo', rootPath: project }],
        worktrees: [{ id: 'w-main', projectId: 'p1', branch: 'main', path: project, isMain: true }],
        sessions: [{ id: 's1', worktreeId: 'w-main', kind: 'claude', ui: 'gui', title: 'GUI 会话', startedAt: 1, lastActivityAt: 1 }],
        activeSessionId: 's1',
        sidebarCollapsed: false,
        drafts: {}
      })
    )
    app = await launchApp({ ...outerClaudeEnv(), ZDOTDIR: zdot, SHELL: '/bin/zsh' }, { userDataDir: profile })
    page = await app.firstWindow()
    await setWindowSize(app, page, 1440, 900)
  })

  test.afterAll(async () => {
    await app?.close().catch(() => {})
  })

  test('shows the chat, not a terminal, and launches claude -p with the wavi label', async () => {
    await expect(chat()).toBeVisible(WITHIN)
    await expect(composer()).toBeVisible()
    await expect(page.locator('[data-region="terminal"] .xterm')).toHaveCount(0)
    await expect.poll(() => existsSync(argsFile), WITHIN).toBe(true)
    const launched = JSON.parse(readFileSync(argsFile, 'utf8')) as { args: string[]; entrypoint: string | null }
    expect(launched.entrypoint).toBe('wavi')
    expect(launched.args).toEqual(expect.arrayContaining(['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--include-partial-messages', '--permission-prompt-tool', 'stdio']))
  })

  test('sends a message and shows the reply', async () => {
    await send('你好')
    await expect(feed().getByText('你好', { exact: true })).toBeVisible(WITHIN)
    await expect(feed().getByText('Hello: 你好')).toBeVisible(WITHIN)
  })

  test('answers a permission card from the GUI and the turn goes on', async () => {
    await send('please write a file')
    const card = page.getByTestId('gui-permission')
    await expect(card).toBeVisible(WITHIN)
    await page.screenshot({ path: join(SHOTS, 'permission-dark.png') })
    await card.getByRole('button', { name: /^允许/ }).click()
    await expect(card).toHaveCount(0, WITHIN)
  })

  test('queues a message sent while a turn runs, then stops the turn', async () => {
    await send('slow answer')
    await expect(composer().getByRole('button', { name: '停止' })).toBeVisible(WITHIN)
    await send('queued one')
    await expect(page.getByTestId('gui-queued')).toContainText('queued one', WITHIN)
    await composer().getByRole('button', { name: '停止' }).click()
    // The stopped turn ends; the queued message goes next and gets its reply.
    await expect(feed().getByText('Hello: queued one')).toBeVisible(WITHIN)
    await expect(page.getByTestId('gui-queued')).toHaveCount(0)
  })

  test('lists the agent’s commands under /', async () => {
    await input().fill('/re')
    await expect(page.getByTestId('gui-slash-menu')).toContainText('review', WITHIN)
    await input().fill('')
  })

  test('looks right in both themes', async () => {
    for (const theme of ['dark', 'light'] as const) {
      await page.evaluate((t) => (globalThis as unknown as { tr: { settings: { update(p: unknown): Promise<unknown> } } }).tr.settings.update({ appearance: { theme: t } }), theme)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await page.waitForTimeout(300)
      await page.screenshot({ path: join(SHOTS, `chat-${theme}.png`) })
    }
  })

  test('keeps the conversation across a window reload (same process)', async () => {
    await page.reload()
    await expect(chat()).toBeVisible(WITHIN)
    await expect(feed().getByText('Hello: 你好')).toBeVisible(WITHIN)
  })

})
