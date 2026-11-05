// GUI sessions (PRD F23, Figma 49″) in the built app, against the fake headless Claude of src/main/gui/fixtures
// (stream-json in and out, no model, no tokens) put first on the login shell's PATH: the chat instead of a terminal,
// the label and flags it is launched with, streaming text, a permission card answered from the GUI, a message queued
// while a turn runs, the stop button, the 界面 row of the new-session sheet, and the session surviving a reload of
// the window (last: a reload shows the boot screen's dots for up to 8 s). Screenshots in both themes go to test-results/gui-session/.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
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

  /** How far below the top of the feed a sent message's bubble sits. */
  const offsetFromTop = async (text: string): Promise<number> => {
    const [bubble, region] = await Promise.all([feed().locator('[data-item]').filter({ hasText: text }).last().boundingBox(), feed().boundingBox()])
    return Math.round((bubble?.y ?? NaN) - (region?.y ?? NaN))
  }

  test('sends a message and shows the reply, top down (Figma 50A)', async () => {
    await send('你好')
    await expect(feed().getByText('你好', { exact: true })).toBeVisible(WITHIN)
    await expect(feed().getByText('Hello: 你好')).toBeVisible(WITHIN)
    expect(await offsetFromTop('你好')).toBe(24)
  })

  test('a sent message shows at once, before the agent echoes it, and only once after', async () => {
    const sentAt = Date.now()
    await send('late echo please')
    await expect(feed().locator('[data-item]').filter({ hasText: 'late echo please' })).toBeVisible({ timeout: 1000 })
    expect(Date.now() - sentAt).toBeLessThan(1000)
    await expect(feed().getByText('Hello: late echo please')).toBeVisible(WITHIN)
    await expect(feed().locator('[data-item]').filter({ hasText: 'late echo please' })).toHaveCount(1)
  })

  test('later messages go below the earlier ones, with no room left under them', async () => {
    await send('top of the feed')
    await expect(feed().getByText('Hello: top of the feed')).toBeVisible(WITHIN)
    // Short enough to fit: nothing scrolled, the first message where it was, no blank space added after the reply.
    expect(await offsetFromTop('你好')).toBe(24)
    expect(await feed().evaluate((el) => [el.scrollTop, el.scrollHeight <= el.clientHeight])).toEqual([0, true])
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

  test('a pasted picture is a thumbnail in the composer (Figma 50C)', async () => {
    const shot = join(root, 'shot.png')
    writeFileSync(shot, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'))
    const saved = execFileSync('pbpaste', { encoding: 'utf8' })
    try {
      execFileSync('osascript', ['-e', `set the clipboard to (read (POSIX file "${shot}") as «class PNGf»)`])
      await input().click()
      await page.keyboard.press('Meta+V')
    } finally {
      execFileSync('pbcopy', { input: saved })
    }
    const thumb = composer().getByRole('img', { name: /^paste-.*\.png$/ })
    await expect(thumb).toBeVisible(WITHIN)
    expect(await thumb.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)
    expect(await thumb.boundingBox()).toMatchObject({ width: 64, height: 64 })
    await thumb.hover()
    await page.screenshot({ path: join(SHOTS, 'thumbnail-dark.png') })
    await composer().getByRole('button', { name: /^移除 / }).click()
    await expect(thumb).toHaveCount(0)
  })

  /**
   * ProseMirror takes a selection made with the keyboard from the next `selectionchange`: a shortcut pressed in the
   * same instant would apply to the old one. Two frames are enough.
   */
  const selectionSettles = () => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(null)))))

  /** The text of the last user bubble: what the agent got. */
  const lastSent = () => feed().locator('[data-item]').last()

  test('lists start from "- " and ⇧⏎ adds an item; the agent gets Markdown (Figma 50C)', async () => {
    await input().click()
    await page.keyboard.type('步骤：')
    await page.keyboard.press('Shift+Enter')
    await page.keyboard.type('1. 后端下发 cookie')
    await page.keyboard.press('Shift+Enter')
    await page.keyboard.type('前端删掉 my_token')
    await expect(input().locator('ol > li')).toHaveCount(2)
    await page.keyboard.press('Enter')
    // The bubble shows what the agent got as Markdown (Figma 51A): a paragraph and an ordered list, `my_token` as typed.
    await expect(lastSent().locator('ol > li')).toHaveText(['后端下发 cookie', '前端删掉 my_token'], WITHIN)
    await expect(lastSent().locator('p').first()).toHaveText('步骤：')
    await expect(input().locator('ol')).toHaveCount(0)
  })

  test('**x** typed inline stays text; the 格式 bar and ⌘I format a selection (Figma 50D)', async () => {
    await input().click()
    await page.keyboard.type('**不是粗体** 和 斜体')
    await composer().getByRole('button', { name: '格式' }).click()
    const bar = composer().getByRole('toolbar', { name: '格式' })
    await expect(bar).toBeVisible()
    for (let i = 0; i < 2; i++) await page.keyboard.press('Shift+ArrowLeft')
    await selectionSettles()
    await page.keyboard.press('Meta+i')
    await expect(input().locator('em')).toHaveText('斜体')
    await expect(bar.getByRole('button', { name: /^斜体/ })).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('End')
    await selectionSettles()
    await page.keyboard.press('Shift+Home')
    await selectionSettles()
    await bar.getByRole('button', { name: /^删除线/ }).click()
    await page.screenshot({ path: join(SHOTS, 'format-bar-dark.png') })
    await page.keyboard.press('Enter')
    // Sent as `~~**不是粗体** 和 *斜体*~~`: the typed asterisks are Markdown to the agent, so the bubble shows them bold.
    await expect(lastSent().locator('del em')).toHaveText('斜体', WITHIN)
    await expect(lastSent().locator('del strong')).toHaveText('不是粗体')
    await composer().getByRole('button', { name: '格式' }).click()
    await expect(bar).toHaveCount(0)
  })

  test('a selection shows the format buttons over it (Figma 50E); ⏎ in a code block is a newline', async () => {
    await input().click()
    await page.keyboard.type('run npm test')
    for (let i = 0; i < 8; i++) await page.keyboard.press('Shift+ArrowLeft')
    await selectionSettles()
    const floating = composer().getByRole('toolbar', { name: '选中文字的格式' })
    await expect(floating).toBeVisible()
    await page.screenshot({ path: join(SHOTS, 'selection-toolbar.png') })
    await floating.getByRole('button', { name: /^行内代码/ }).click()
    await page.keyboard.press('End')
    await selectionSettles()
    await page.keyboard.press('Shift+Enter')
    await page.keyboard.type('```')
    await page.keyboard.type(' ')
    await page.keyboard.type('a()')
    await page.keyboard.press('Enter')
    await page.keyboard.type('  b()')
    await expect(input().locator('pre')).toHaveCount(1)
    await page.keyboard.press('Meta+Enter')
    await expect(lastSent().locator('p code')).toHaveText('npm test', WITHIN)
    await expect(lastSent().locator('pre')).toHaveText('a()\n  b()')
  })

  test('@ puts a file mention at the caret, inside the list it is typed in', async () => {
    const readme = join(project, 'README.md')
    await app.evaluate(({ dialog }, files) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: files })) as typeof dialog.showOpenDialog
    }, [readme])
    await input().click()
    await page.keyboard.type('- 看')
    await composer().getByRole('button', { name: '提及文件' }).click()
    await expect(input().locator('ul > li')).toHaveText('看 @README.md ')
    await page.keyboard.type('里的说明')
    await page.keyboard.press('Enter')
    await expect(lastSent().locator('ul > li')).toHaveText('看 @README.md 里的说明', WITHIN)
    // Long by now: the view follows the end, the reply at the bottom.
    await expect.poll(() => feed().evaluate((el) => Math.round(el.scrollHeight - el.scrollTop - el.clientHeight)), WITHIN).toBe(0)
  })

  test('scrolled up, the view stays; sending a message brings it back to the end', async () => {
    await feed().evaluate((el) => el.scrollTo(0, 0))
    await feed().evaluate((el) => new Promise((done) => requestAnimationFrame(() => done(el.scrollTop))))
    expect(await feed().evaluate((el) => el.scrollTop)).toBe(0)
    await send('back to the end')
    await expect(feed().getByText('Hello: back to the end')).toBeVisible(WITHIN)
    await expect.poll(() => feed().evaluate((el) => Math.round(el.scrollHeight - el.scrollTop - el.clientHeight)), WITHIN).toBe(0)
  })

  test('reads like a chat: the agent’s mark on each turn, the user’s picture and 对话 settings (Figma 51A)', async () => {
    // One mark per turn: each run of agent blocks after a user message (a turn stopped before any reply has none).
    // The last test's reply may still be on its way: compare until both settle.
    const counts = () =>
      feed()
        .locator('> div')
        .first()
        .evaluate((column) => {
          const turns = [...column.children].filter((el, i, all) => !el.hasAttribute('data-item') && (i === 0 || all[i - 1]!.hasAttribute('data-item'))).length
          return { turns, marks: column.querySelectorAll('[data-agent-mark]').length }
        })
    await expect.poll(async () => { const c = await counts(); return c.turns === c.marks && c.turns > 3 }, WITHIN).toBe(true)
    // The mark is a solid circle that is never cut by its block (blocks paint only inside themselves).
    for (const mark of await feed().locator('[data-agent-mark]').all()) {
      const [box, turn] = await Promise.all([mark.boundingBox(), mark.locator('..').boundingBox()])
      expect(box!.y).toBeGreaterThanOrEqual(turn!.y)
      expect(box!.y + box!.height).toBeLessThanOrEqual(turn!.y + turn!.height + 0.5)
    }
    const userAvatar = feed().locator('[data-item]').last().locator('[aria-hidden]').last()
    await expect(userAvatar).toBeHidden()
    const avatar = `data:image/png;base64,${'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='}`
    await page.evaluate(
      (chat) => (globalThis as unknown as { tr: { settings: { update(p: unknown): Promise<unknown> } } }).tr.settings.update({ appearance: { chat } }),
      { width: 'medium', fontWeight: 500, fontSize: 16, opacity: 0.85, avatar }
    )
    await expect(userAvatar).toBeVisible()
    const bubble = feed().locator('[data-item]').last()
    await expect.poll(() => bubble.evaluate((el) => getComputedStyle(el.querySelector('p, li')!).fontSize)).toBe('16px')
    expect(await bubble.evaluate((el) => getComputedStyle(el.querySelector('p, li')!).fontWeight)).toBe('500')
    expect(await feed().locator('> div').first().evaluate((el) => getComputedStyle(el).maxWidth)).toBe('992px')
    expect(await chat().evaluate((el) => getComputedStyle(el.parentElement!).backgroundColor)).toMatch(/0\.85\)$|color\(srgb .* \/ 0\.85\)$/)
    await feed().evaluate((el) => el.scrollTo(0, 0))
    await page.screenshot({ path: join(SHOTS, 'chat-avatars.png') })
    await page.evaluate(() =>
      (globalThis as unknown as { tr: { settings: { update(p: unknown): Promise<unknown> } } }).tr.settings.update({
        appearance: { chat: { width: 'narrow', fontWeight: 400, fontSize: 14, opacity: 1, avatar: '' } }
      })
    )
    await expect(userAvatar).toBeHidden()
  })

  test('lists the agent’s commands under /', async () => {
    await input().fill('/re')
    await expect(page.getByTestId('gui-slash-menu')).toContainText('review', WITHIN)
    await input().fill('')
  })

  test('looks right in both themes', async () => {
    // The empty composer shows its placeholder (Tiptap's class, not a module class).
    expect(await input().locator('p').first().evaluate((p) => getComputedStyle(p, '::before').content)).toBe('"回复"')
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
