// Files into a running session (PRD F19), with the fake `claude` (e2e/fake-claude.ts) logging every byte it reads:
// the header's paperclip puts the picked files' escaped paths into the input line, ⌘V with an image on the clipboard
// saves it to a temp file and puts that path in, and files dragged over the terminal frame it. What the real agents do
// with those paths is measured in scripts/spikes/50-attach-lab.mjs. Screenshots go to test-results/attachments/.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fakeClaude } from './fake-claude'
import { launchApp, setWindowSize } from './launch'

const SHOTS = join(process.cwd(), 'test-results', 'attachments')
const WITHIN = { timeout: 20_000 }
// 1×1 PNG.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

test.describe.configure({ mode: 'serial' })
test.setTimeout(90_000)

test.describe('F19 files into a running session', () => {
  const profile = mkdtempSync(join(tmpdir(), 'tr-e2e-attach-profile-'))
  const fake = fakeClaude('tr-e2e-attach-')
  const project = join(fake.root, 'demo')
  mkdirSync(project)
  const shot = join(project, 'my shot 截图.png')
  const notes = join(project, 'notes.md')
  const docs = join(project, 'docs 文档')
  writeFileSync(shot, Buffer.from(PNG, 'base64'))
  writeFileSync(notes, '# notes\n')
  mkdirSync(docs)
  writeFileSync(join(docs, 'a.md'), 'a\n')
  let app: ElectronApplication
  let page: Page
  const header = () => page.locator('[data-region="main"] header').first()

  test.beforeAll(async () => {
    writeFileSync(
      join(profile, 'workspace.json'),
      JSON.stringify({
        version: 2,
        projects: [{ id: 'p1', name: 'demo', rootPath: project }],
        worktrees: [{ id: 'w-main', projectId: 'p1', branch: 'main', path: project, isMain: true }],
        sessions: [{ id: 's1', worktreeId: 'w-main', kind: 'claude', title: '加附件', startedAt: 1, lastActivityAt: 1 }],
        activeSessionId: 's1',
        sidebarCollapsed: false,
        drafts: {}
      })
    )
    app = await launchApp(fake.env, { userDataDir: profile })
    page = await app.firstWindow()
    await setWindowSize(app, page, 1440, 900)
    await expect(page.locator('[data-region="terminal"] .xterm').first()).toBeVisible(WITHIN)
    await expect.poll(() => fake.launches().length, WITHIN).toBe(1)
  })

  test.afterAll(async () => {
    await app?.close().catch(() => {})
  })

  test('the paperclip opens a picker in the session’s folder and puts the escaped paths in, without Enter', async () => {
    await app.evaluate(({ dialog }, files) => {
      const g = globalThis as unknown as { __pickedFrom?: string }
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        const options = args[args.length - 1] as { defaultPath?: string }
        g.__pickedFrom = options.defaultPath
        return { canceled: false, filePaths: files }
      }) as typeof dialog.showOpenDialog
    }, [shot, notes])
    await header().getByTestId('add-files').click()
    await expect.poll(() => fake.typed(), WITHIN).toContain(`${project}/my\\ shot\\ 截图.png ${notes} `)
    expect(fake.typed()).not.toContain('<ENTER>')
    expect(await app.evaluate(() => (globalThis as unknown as { __pickedFrom?: string }).__pickedFrom)).toBe(project)
    // The terminal has the keyboard again.
    await expect.poll(() => page.evaluate(() => document.activeElement?.classList.contains('xterm-helper-textarea'))).toBe(true)
  })

  test('⌘V with an image on the clipboard puts a temp file’s path in; text still pastes as text', async () => {
    // The real clipboard, through the menu's paste: keep what the user had on it (text).
    const saved = execFileSync('pbpaste', { encoding: 'utf8' })
    try {
      execFileSync('osascript', ['-e', `set the clipboard to (read (POSIX file "${shot}") as «class PNGf»)`])
      await page.locator('[data-region="terminal"] .xterm').first().click()
      const before = fake.typed().length
      await page.keyboard.press('Meta+V')
      await expect.poll(() => fake.typed().slice(before), WITHIN).toMatch(/\/wavi\/attachments\/paste-\d+-[0-9a-f]+\.png $/)

      execFileSync('pbcopy', { input: 'plain words' })
      const mark = fake.typed().length
      await page.keyboard.press('Meta+V')
      await expect.poll(() => fake.typed().slice(mark), WITHIN).toBe('plain words')
    } finally {
      execFileSync('pbcopy', { input: saved })
    }
  })

  test('files dragged over the terminal frame it, and leaving takes the frame away', async () => {
    const host = page.locator('[data-region="terminal"] [data-session-id="s1"] > div').first()
    const drag = async (type: 'dragenter' | 'dragleave') =>
      host.evaluate((el, t) => {
        const data = new DataTransfer()
        data.items.add(new File(['x'], 'x.png', { type: 'image/png' }))
        el.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: data }))
      }, type)
    await drag('dragenter')
    await expect(host).toHaveAttribute('data-file-drop', 'true')
    mkdirSync(SHOTS, { recursive: true })
    await page.screenshot({ path: join(SHOTS, 'drop-dark.png') }).catch(() => undefined)
    await drag('dragleave')
    await expect(host).not.toHaveAttribute('data-file-drop')
  })

  test('the paperclip takes folders too', async () => {
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [folder] })) as typeof dialog.showOpenDialog
    }, docs)
    const before = fake.typed().length
    await header().getByTestId('add-files').click()
    await expect.poll(() => fake.typed().slice(before), WITHIN).toBe(`${project}/docs\\ 文档 `)
  })

  test('an entry dragged out of the 文件 view onto the terminal goes in by its absolute path', async () => {
    await header().getByRole('group', { name: '右侧栏' }).getByRole('button', { name: '文件', exact: true }).click()
    const panel = page.locator('[data-region="panel"]')
    const row = panel.locator('[role="treeitem"][data-path="docs 文档"]')
    await expect(row).toBeVisible(WITHIN)
    const before = fake.typed().length
    await row.dragTo(page.locator('[data-region="terminal"] .xterm').first())
    await expect.poll(() => fake.typed().slice(before), WITHIN).toBe(`${project}/docs\\ 文档 `)
    await expect(page.locator('[data-file-drop]')).toHaveCount(0)
  })

  test('⌘V after ⌘C on a file in Finder puts its full path in, not just its name', async () => {
    const saved = execFileSync('pbpaste', { encoding: 'utf8' })
    try {
      execFileSync('osascript', ['-e', `set the clipboard to (POSIX file "${notes}")`])
      await page.locator('[data-region="terminal"] .xterm').first().click()
      const before = fake.typed().length
      await page.keyboard.press('Meta+V')
      await expect.poll(() => fake.typed().slice(before), WITHIN).toBe(`${notes} `)
    } finally {
      execFileSync('pbcopy', { input: saved })
    }
  })
})
