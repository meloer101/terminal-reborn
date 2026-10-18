// F17 right panel: the floating card, the session header's view icons, ⇧⌘B, resizing, and the 文件 view on a real
// git worktree — lazy tree, git letters, ignored entries, filter, 有改动, preview with change marks, the context menu,
// and file paths printed in the terminal opening the preview at their line (⌘-click / the link menu: the editor).
// Screenshots in both themes go to test-results/right-panel/ (compare with Figma 13D / 13F / 13G).
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './launch'

const SHOTS = join(process.cwd(), 'test-results', 'right-panel')
const SESSION = 's-files'

interface Hook {
  readScreen(sessionId: string, scrollbackLines?: number): string
}

/** A small repo: one modified file, one untracked file, one ignored folder. */
function makeRepo(): string {
  const project = mkdtempSync(join(tmpdir(), 'tr-e2e-files-'))
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.email=e2e@example.com', '-c', 'user.name=e2e', '-c', 'commit.gpgsign=false', ...args], { cwd: project })
  mkdirSync(join(project, 'src', 'components'), { recursive: true })
  mkdirSync(join(project, 'build'))
  const lines = Array.from({ length: 12 }, (_, i) => `export const line${i + 1} = ${i + 1}`)
  writeFileSync(join(project, 'src', 'app.ts'), `${lines.join('\n')}\n`)
  writeFileSync(join(project, 'src', 'util.ts'), 'export const util = 1\n')
  writeFileSync(join(project, 'src', 'components', 'Nav.tsx'), 'export function Nav() {}\n')
  writeFileSync(join(project, 'README.md'), '# demo\n')
  writeFileSync(join(project, '.gitignore'), 'build/\n')
  git('init', '-q', '-b', 'main')
  git('add', '.')
  git('commit', '-q', '-m', 'init')
  // Line 3 modified, a line added at the end.
  lines[2] = 'export const line3 = 333'
  writeFileSync(join(project, 'src', 'app.ts'), `${lines.join('\n')}\nexport const added = true\n`)
  writeFileSync(join(project, 'notes.md'), 'untracked\n')
  writeFileSync(join(project, 'build', 'out.js'), 'ignored\n')
  return project
}

test.describe.configure({ mode: 'serial' })
test.setTimeout(60_000)

test.describe('F17 right panel · 文件', () => {
  const profile = mkdtempSync(join(tmpdir(), 'tr-e2e-panel-'))
  const project = makeRepo()
  let app: ElectronApplication
  let page: Page

  const panel = () => page.locator('[data-region="panel"]')
  const tree = () => panel().getByRole('tree', { name: '文件' })
  const row = (path: string) => tree().locator(`[role="treeitem"][data-path="${path}"]`)
  const screen = () =>
    page.evaluate((id) => (globalThis as unknown as { __trTerminals?: Hook }).__trTerminals?.readScreen(id, 50) ?? '', SESSION)
  const setTheme = async (theme: 'dark' | 'light') => {
    await page.evaluate(
      (t) => (globalThis as unknown as { tr: { settings: { update(p: unknown): Promise<unknown> } } }).tr.settings.update({ appearance: { theme: t } }),
      theme
    )
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme)
  }
  const shoot = async (name: string) => {
    for (const theme of ['dark', 'light'] as const) {
      await setTheme(theme)
      await page.waitForTimeout(200)
      await page.screenshot({ path: join(SHOTS, `${name}-${theme}.png`) })
    }
    await setTheme('dark')
  }

  test.beforeAll(async () => {
    writeFileSync(
      join(profile, 'workspace.json'),
      JSON.stringify({
        version: 2,
        projects: [{ id: 'p1', name: 'demo', rootPath: project }],
        worktrees: [{ id: 'w1', projectId: 'p1', branch: 'main', path: project, isMain: true }],
        sessions: [{ id: SESSION, worktreeId: 'w1', kind: 'shell', title: '修复移动端导航抖动', startedAt: 1, lastActivityAt: 1 }],
        activeSessionId: SESSION,
        sidebarCollapsed: false,
        rightPanel: null,
        drafts: {}
      })
    )
    app = await launchApp({}, { userDataDir: profile })
    page = await app.firstWindow()
    await page.addInitScript(() => {
      ;(globalThis as unknown as { __TR_TERMINAL_PROBE__: boolean }).__TR_TERMINAL_PROBE__ = true
    })
    await page.reload()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 900))
    await expect(page.locator('[data-region="terminal"] .xterm').first()).toBeVisible({ timeout: 20_000 })
  })

  test.afterAll(async () => {
    await app?.close().catch(() => {})
  })

  test('the header icons open a view, the active one closes it, ⇧⌘B remembers the last view', async () => {
    const header = page.locator('header')
    // F17: the header no longer repeats the agent status.
    await expect(header).not.toContainText('终端 ·')
    const switcher = header.getByRole('group', { name: '右侧栏' })
    await expect(switcher.getByRole('button')).toHaveText(['', '', '', ''])
    await switcher.getByRole('button', { name: 'Git' }).click()
    await expect(panel()).toBeVisible()
    await expect(panel().getByRole('tab', { name: '图谱' })).toBeVisible()
    await expect(switcher.getByRole('button', { name: 'Git' })).toHaveAttribute('aria-pressed', 'true')

    await switcher.getByRole('button', { name: '文件' }).click()
    await expect(tree()).toBeVisible()
    await expect(switcher.getByRole('button', { name: '文件' })).toHaveAttribute('aria-pressed', 'true')
    await switcher.getByRole('button', { name: '文件' }).click()
    await expect(panel()).toHaveCount(0)

    await page.keyboard.press('Meta+Shift+KeyB')
    await expect(tree()).toBeVisible()
    await page.keyboard.press('Meta+Shift+KeyB')
    await expect(panel()).toHaveCount(0)
    await page.keyboard.press('Meta+Shift+KeyB')
    await expect(tree()).toBeVisible()
  })

  test('the card floats 8 in from the edge, 480 wide, and resizes from its left edge (min 400)', async () => {
    const card = panel().getByTestId('right-panel')
    const box = async () => (await card.boundingBox())!
    const width = await page.evaluate(() => window.innerWidth)
    const b = await box()
    expect(Math.round(b.width)).toBe(480)
    expect(Math.round(width - (b.x + b.width))).toBe(8)
    expect(Math.round(b.y)).toBe(8)

    const handle = panel().getByRole('separator', { name: '调整右侧栏宽度' })
    const h = (await handle.boundingBox())!
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2)
    await page.mouse.down()
    await page.mouse.move(h.x + h.width / 2 - 100, h.y + h.height / 2, { steps: 5 })
    await page.mouse.up()
    await expect.poll(async () => Math.round((await box()).width)).toBe(580)
    await page.mouse.move(h.x - 100, h.y + 40)
    await page.mouse.down()
    await page.mouse.move(h.x + 400, h.y + 40, { steps: 5 })
    await page.mouse.up()
    await expect.poll(async () => Math.round((await box()).width)).toBe(400)
    await handle.dblclick()
    await expect.poll(async () => Math.round((await box()).width)).toBe(480)
  })

  test('the tree shows git letters, dims ignored entries and loads folders on demand', async () => {
    await expect(panel().getByRole('heading', { name: '文件' })).toBeVisible()
    await expect(tree().locator('[role="treeitem"][aria-level="1"]')).toHaveText(['build', 'src•', '.gitignore', 'notes.mdU', 'README.md'])
    await expect(row('build')).toHaveAttribute('data-ignored', 'true')
    await expect(row('.git')).toHaveCount(0)
    await expect(row('src/app.ts')).toHaveCount(0)

    await row('src').click()
    await expect(row('src')).toHaveAttribute('aria-expanded', 'true')
    await expect(row('src/app.ts')).toHaveText('app.tsM')
    await expect(row('src/components')).toHaveAttribute('aria-expanded', 'false')
    await expect(panel().getByRole('button', { name: '有改动 2' })).toBeVisible()
    await row('src/app.ts').click()
    await shoot('13d-files')
  })

  test('double-click previews read-only with line numbers and change marks; Esc goes back', async () => {
    await row('src/app.ts').dblclick()
    const preview = panel().getByTestId('file-preview')
    await expect(preview).toBeVisible()
    await expect(preview).toBeFocused()
    await expect(panel().getByTitle('src/app.ts')).toHaveText('src/app.ts')
    const lines = preview.locator('[data-mark]')
    await expect(lines).toHaveCount(2)
    await expect(lines.nth(0)).toHaveAttribute('data-mark', 'mod')
    await expect(lines.nth(0)).toContainText('3export const line3 = 333')
    await expect(lines.nth(1)).toHaveAttribute('data-mark', 'add')
    await expect(lines.nth(1)).toContainText('13export const added = true')
    await shoot('13f-preview')

    await page.keyboard.press('Escape')
    await expect(tree()).toBeFocused()
    await expect(row('src/app.ts')).toHaveAttribute('aria-selected', 'true')
    // ↵ on the selected file previews it too; ← goes back.
    await page.keyboard.press('Enter')
    await expect(preview).toBeVisible()
    await page.keyboard.press('ArrowLeft')
    await expect(tree()).toBeVisible()
  })

  test('the filter finds files in folders that were never opened; 有改动 shows only changes', async () => {
    const filter = panel().getByRole('searchbox', { name: '筛选文件名' })
    await filter.fill('nav')
    await expect(row('src/components/Nav.tsx')).toBeVisible()
    await expect(tree().getByRole('treeitem')).toHaveCount(3) // src · components · Nav.tsx
    await filter.press('Escape')
    await expect(filter).toHaveValue('')

    await panel().getByRole('button', { name: '有改动 2' }).click()
    await expect(tree().getByRole('treeitem')).toHaveText(['src•', 'app.tsM', 'notes.mdU'])
    await panel().getByRole('button', { name: '有改动 2' }).click()
    await expect(row('build')).toBeVisible()
  })

  test('right-click: copy the relative path, insert it into the terminal', async () => {
    await row('src/app.ts').click({ button: 'right' })
    const menu = page.getByRole('menu')
    await expect(menu.getByRole('menuitem')).toHaveText([
      /^预览/,
      /^用默认编辑器打开/,
      /^在 Finder 中显示/,
      /^插入路径到终端/,
      /^复制相对路径/
    ])
    await menu.getByRole('menuitem', { name: /复制相对路径/ }).click()
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('src/app.ts')

    // zsh drops keys typed before its line editor is up; wait for the prompt.
    await expect.poll(async () => (await screen()).trim().length, { timeout: 10_000 }).toBeGreaterThan(0)
    await row('src/app.ts').click({ button: 'right' })
    await page.getByRole('menu').getByRole('menuitem', { name: /插入路径到终端/ }).click()
    await expect.poll(screen).toContain('@src/app.ts')
    // The terminal has the keyboard, and nothing was submitted.
    await expect(page.locator(`[data-region="terminal"] [data-session-id="${SESSION}"] textarea`)).toBeFocused()
    expect(await screen()).not.toContain('command not found')
  })

  test('a file changed on disk shows up without a refresh', async () => {
    writeFileSync(join(project, 'src', 'fresh.ts'), 'new\n')
    await expect(row('src/fresh.ts')).toHaveText('fresh.tsU', { timeout: 5000 })
    await expect(panel().getByRole('button', { name: '有改动 3' })).toBeVisible()
  })

  test('a path in the terminal opens the preview at its line; ⌘-click and the link menu reach the editor', async () => {
    // Main's shell.openPath, recorded instead of opening the user's editor.
    await app.evaluate(({ shell }) => {
      const opened: string[] = []
      ;(globalThis as unknown as { __openedPaths: string[] }).__openedPaths = opened
      shell.openPath = async (path: string) => {
        opened.push(path)
        return ''
      }
    })
    const openedPaths = () => app.evaluate(() => (globalThis as unknown as { __openedPaths: string[] }).__openedPaths.slice())
    const xterm = page.locator('[data-region="terminal"] .xterm').first()
    // Close the pane, then print paths on the first rows of a cleared screen: one with a line, one that does not
    // exist, and an absolute one inside the worktree.
    await page.locator('header').getByRole('group', { name: '右侧栏' }).getByRole('button', { name: '文件' }).click()
    await expect(panel()).toHaveCount(0)
    await page.locator('[data-region="terminal"] .xterm').first().click()
    // The earlier test left `@src/app.ts ` in the input line.
    await page.keyboard.press('Control+U')
    await page.keyboard.type(`clear; printf '%s\\n' src/app.ts:7 missing.ts:3 ${join(project, 'README.md')}`)
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await screen()).split('\n')[0]?.trim()).toBe('src/app.ts:7')
    /** The middle of the cell in column `col` of row `row`, in page coordinates. */
    const cell = async (row: number, col: number) => {
      const box = await page.locator('[data-region="terminal"] .xterm-screen').first().boundingBox()
      const size = await page.evaluate(
        (id) => (globalThis as unknown as { __trTerminals: { size(id: string): { cols: number; rows: number } | null } }).__trTerminals.size(id),
        SESSION
      )
      if (!box || !size) throw new Error('no terminal')
      return { x: box.x + (box.width / size.cols) * (col + 0.5), y: box.y + (box.height / size.rows) * (row + 0.5) }
    }

    // A path that does not exist is not a link.
    const missing = await cell(1, 2)
    await page.mouse.move(missing.x, missing.y)
    await page.waitForTimeout(500)
    await expect(xterm).not.toHaveAttribute('title', /.*/)

    // Hovering names the path and line; a click previews the file, scrolled to and marking line 7.
    const at = await cell(0, 3)
    await page.mouse.move(at.x, at.y)
    await expect(xterm).toHaveAttribute('title', /^src\/app\.ts:7\n/)
    await page.mouse.click(at.x, at.y)
    const preview = panel().getByTestId('file-preview')
    await expect(preview).toBeVisible()
    await expect(panel().getByTitle('src/app.ts')).toHaveText('src/app.ts')
    await expect(preview.locator('[data-target]')).toHaveText('7export const line7 = 7')
    await expect(preview.locator('[data-target]')).toBeInViewport()

    // An absolute path inside the worktree previews that file.
    const absolute = await cell(2, 5)
    await page.mouse.move(absolute.x, absolute.y)
    await expect(xterm).toHaveAttribute('title', /^README\.md\n/)
    await page.mouse.click(absolute.x, absolute.y)
    await expect(panel().getByTitle('README.md')).toHaveText('README.md')
    await expect(preview.locator('[data-target]')).toHaveCount(0)

    // ⌘-click: the default editor.
    const meta = await cell(0, 6)
    await page.mouse.move(meta.x, meta.y)
    await expect(xterm).toHaveAttribute('title', /^src\/app\.ts:7/)
    await page.keyboard.down('Meta')
    await page.mouse.click(meta.x, meta.y)
    await page.keyboard.up('Meta')
    await expect.poll(openedPaths).toEqual([expect.stringMatching(/\/src\/app\.ts$/)])

    // Right-click: the path menu.
    const right = await cell(0, 8)
    await page.mouse.move(right.x, right.y)
    await expect(xterm).toHaveAttribute('title', /^src\/app\.ts:7/)
    await page.mouse.click(right.x, right.y, { button: 'right' })
    const menu = page.getByRole('menu')
    await expect(menu.getByRole('menuitem')).toHaveText(['预览', '用默认编辑器打开', '在 Finder 中显示', '复制路径'])
    await menu.getByRole('menuitem', { name: '复制路径' }).click()
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('src/app.ts')
  })
})
