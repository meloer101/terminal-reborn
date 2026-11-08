// Pi GUI sessions over `pi --mode rpc` (PRD F23 v1.160), in the built app against the fake Pi of src/main/gui/fixtures
// put first on the login shell's PATH (no pi-acp, no model, no tokens): an empty session's agent menu offers Pi with its
// models, picking one starts Pi with it as a launch argument and Wavi's permission extension, a bash call is asked on a
// card, 接受编辑 lets an edit through, a thinking change restarts Pi on its conversation with the chat kept, and stop
// ends the turn. Pi is never sent set_model / set_thinking_level (they would rewrite ~/.pi/agent/settings.json).
// Screenshots in both themes go to test-results/gui-pi/.
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { outerClaudeEnv } from './fake-claude'
import { launchApp, setWindowSize } from './launch'

const FIXTURES = join(process.cwd(), 'src', 'main', 'gui', 'fixtures')
const SHOTS = join(process.cwd(), 'test-results', 'gui-pi')
const WITHIN = { timeout: 15_000 }

test.describe.configure({ mode: 'serial' })
test.setTimeout(90_000)

test.describe('F23 GUI session · Pi over its rpc mode', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'tr-e2e-gui-pi-')))
  const bin = join(root, 'bin')
  const zdot = join(root, 'zdot')
  const demo = join(root, 'demo')
  const profile = join(root, 'profile')
  const piLog = join(root, 'pi-log.jsonl')
  for (const dir of [bin, zdot, demo, profile]) mkdirSync(dir)
  for (const [name, fake] of [['claude', 'fake-claude.mjs'], ['pi', 'fake-pi.mjs']] as const) {
    writeFileSync(join(bin, name), `#!/bin/sh\nexec "${process.execPath}" "${join(FIXTURES, fake)}" "$@"\n`)
    chmodSync(join(bin, name), 0o755)
  }
  writeFileSync(join(zdot, '.zshrc'), `export PATH="${bin}:$PATH"\nexport FAKE_PI_LOG="${piLog}"\n`)

  let app: ElectronApplication
  let page: Page
  const composer = () => page.getByTestId('gui-composer')
  const feed = () => page.locator('[data-region="gui-feed"]')
  const input = () => composer().getByRole('textbox', { name: '回复' })
  const send = async (text: string) => {
    await input().fill(text)
    await input().press('Enter')
  }
  const piLines = () =>
    readFileSync(piLog, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { args?: string[]; command?: string })
  /** The launches of the session (not the model probe, which runs with --no-session). */
  const launches = () => piLines().flatMap((l) => (l.args && !l.args.includes('--no-session') ? [l.args] : []))
  const theme = (t: 'dark' | 'light') => page.evaluate((x) => (globalThis as unknown as { tr: { settings: { update(p: unknown): Promise<unknown> } } }).tr.settings.update({ appearance: { theme: x } }), t)

  test.beforeAll(async () => {
    writeFileSync(
      join(profile, 'workspace.json'),
      JSON.stringify({
        version: 2,
        projects: [{ id: 'p1', name: 'demo', rootPath: demo }],
        worktrees: [{ id: 'w-demo', projectId: 'p1', branch: 'main', path: demo, isMain: true }],
        sessions: [{ id: 's1', worktreeId: 'w-demo', kind: 'claude', ui: 'gui', title: 'Claude Code', startedAt: 1, lastActivityAt: 1 }],
        activeSessionId: 's1',
        sidebarCollapsed: false,
        drafts: {}
      })
    )
    app = await launchApp({ ...outerClaudeEnv(), ZDOTDIR: zdot, SHELL: '/bin/zsh', CLAUDE_CONFIG_DIR: join(root, 'claude-config') }, { userDataDir: profile })
    page = await app.firstWindow()
    await setWindowSize(app, page, 1440, 900)
  })

  test.afterAll(async () => {
    await app?.close().catch(() => {})
  })

  test('an empty session’s agent menu offers Pi with its models, no adapter to install; a pick starts Pi with it', async () => {
    await expect(composer().locator('[data-picker="model"]')).toHaveText('Opus', WITHIN)
    await composer().locator('[data-picker="model"]').click()
    await page.getByTestId('gui-agent-menu').getByRole('menuitem', { name: 'Pi', exact: true }).hover()
    const models = page.getByTestId('gui-agent-models')
    await expect(models.getByRole('menuitemradio')).toHaveText(['DeepSeek V4 Flash', 'DeepSeek V4 Pro'], WITHIN)
    await expect(models).not.toContainText('后可用')
    await page.screenshot({ path: join(SHOTS, 'agent-menu-pi-dark.png') })
    await models.getByRole('menuitemradio', { name: 'DeepSeek V4 Pro' }).click()
    await expect(composer().locator('[data-picker="model"]')).toHaveText('DeepSeek V4 Pro', WITHIN)
    await expect(composer().locator('[data-picker="effort"]')).toHaveText('高')
    await expect.poll(() => launches().length, WITHIN).toBe(1)
    const [args] = launches()
    expect(args!.slice(0, 4)).toEqual(['--mode', 'rpc', '--model', 'deepseek/deepseek-v4-pro'])
    expect(args!.at(args!.indexOf('-e') + 1)).toMatch(/resources\/hooks\/wavi-pi-gui\.js$/)
  })

  test('模式 offers 询问 and 接受编辑; a bash call is asked on a card and the turn goes on', async () => {
    const mode = composer().locator('[data-picker="permission"]')
    await expect(mode).toHaveText('询问')
    await mode.click()
    await expect(page.getByRole('dialog', { name: '模式' }).getByRole('menuitemradio')).toHaveText(['询问', '接受编辑'])
    await page.keyboard.press('Escape')

    await send('bash please')
    const card = page.getByTestId('gui-permission')
    await expect(card).toBeVisible(WITHIN)
    await expect(card).toContainText('ls')
    for (const t of ['dark', 'light'] as const) {
      await theme(t)
      await expect(page.locator('html')).toHaveAttribute('data-theme', t)
      await page.waitForTimeout(300)
      await page.screenshot({ path: join(SHOTS, `permission-${t}.png`) })
    }
    await theme('dark')
    await card.getByRole('button', { name: /^允许/ }).click()
    await expect(card).toHaveCount(0, WITHIN)
    await expect(feed().getByText('Hello: bash please (deepseek-v4-pro, high)')).toBeVisible(WITHIN)
  })

  test('接受编辑 lets an edit through without a card, its change on the row', async () => {
    await composer().locator('[data-picker="permission"]').click()
    await page.getByRole('dialog', { name: '模式' }).getByRole('menuitemradio', { name: '接受编辑' }).click()
    await expect(composer().locator('[data-picker="permission"]')).toHaveText('接受编辑')
    await send('edit it')
    await expect(feed().getByText('Hello: edit it (deepseek-v4-pro, high)')).toBeVisible(WITHIN)
    await expect(page.getByTestId('gui-permission')).toHaveCount(0)
    await expect(feed()).toContainText('a.txt')
  })

  test('a thinking change restarts Pi on its conversation with it; the chat stays', async () => {
    await composer().locator('[data-picker="effort"]').click()
    await page.getByRole('dialog').getByRole('menuitemradio', { name: '最高' }).click()
    await expect(composer().locator('[data-picker="effort"]')).toHaveText('最高', WITHIN)
    await expect.poll(() => launches().length, WITHIN).toBe(2)
    const args = launches()[1]!
    expect(args).toEqual(expect.arrayContaining(['--model', 'deepseek/deepseek-v4-pro', '--thinking', 'max', '--session-id', 'fake-pi-session']))
    await expect(feed().getByText('Hello: bash please (deepseek-v4-pro, high)')).toBeVisible()
    await send('again')
    await expect(feed().getByText('Hello: again (deepseek-v4-pro, max)')).toBeVisible(WITHIN)
  })

  test('stop ends the turn; Pi was never asked to save a model or thinking level', async () => {
    await send('slow answer')
    await expect(composer().getByRole('button', { name: '停止' })).toBeVisible(WITHIN)
    await composer().getByRole('button', { name: '停止' }).click()
    await expect(feed().getByText('已中断')).toBeVisible(WITHIN)
    await expect(composer().getByRole('button', { name: '发送' })).toBeVisible(WITHIN)
    await page.screenshot({ path: join(SHOTS, 'stopped-dark.png') })
    const commands = piLines().flatMap((l) => (l.command ? [l.command] : []))
    expect(commands).toContain('abort')
    expect(commands).not.toContain('set_model')
    expect(commands).not.toContain('set_thinking_level')
  })
})
