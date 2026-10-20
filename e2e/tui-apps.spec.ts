// Full-screen terminal programs inside the app: vim, less, top, and htop when it is installed. Each one must draw on
// the alternate screen, take keys (arrows, Esc, CJK text), the mouse and a resize, and give the shell its screen back
// on exit. A minimal zsh (own ZDOTDIR) keeps the user's prompt and rc files out of it; screenshots go to
// test-results/tui/ for a look by eye.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './launch'

interface Hook {
  readScreen(sessionId: string, scrollbackLines?: number): string
  size(sessionId: string): { cols: number; rows: number } | null
}
const SESSION = 's-tui'
const SHOTS = join(process.cwd(), 'test-results', 'tui')
const hasHtop = (() => {
  try {
    execFileSync('/bin/sh', ['-c', 'command -v htop'])
    return true
  } catch {
    return false
  }
})()

test.describe.configure({ mode: 'serial' })
test.setTimeout(60_000)

const root = mkdtempSync(join(tmpdir(), 'tr-e2e-tui-'))
const project = join(root, 'proj')
const profile = join(root, 'profile')
const zdot = join(root, 'zdot')
let app: ElectronApplication
let page: Page

const pane = () => page.locator(`[data-region="terminal"] [data-session-id="${SESSION}"]`)
/** The visible screen, each line without the blank cells after its text. */
const screen = async () =>
  (await page.evaluate((id) => (globalThis as unknown as { __trTerminals: Hook }).__trTerminals.readScreen(id), SESSION))
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
const lines = async () => (await screen()).split('\n')
const size = () => page.evaluate((id) => (globalThis as unknown as { __trTerminals: Hook }).__trTerminals.size(id), SESSION)

async function run(command: string): Promise<void> {
  await page.keyboard.type(command)
  await page.keyboard.press('Enter')
}

/** Back at the prompt with the shell's own screen (the program left the alternate screen). */
async function expectShellBack(marker: string): Promise<void> {
  await expect.poll(screen).toContain(marker)
  await run(`echo shell-$((40+2))`)
  await expect.poll(screen).toMatch(/^shell-42$/m)
}

/** Clicks the terminal cell at (col, row), both 0-based. */
async function clickCell(col: number, row: number): Promise<void> {
  const box = await pane().locator('.xterm-screen').boundingBox()
  const dims = await size()
  if (!box || !dims) throw new Error('no terminal')
  await page.mouse.click(box.x + ((col + 0.5) * box.width) / dims.cols, box.y + ((row + 0.5) * box.height) / dims.rows)
}

test.beforeAll(async () => {
  for (const dir of [project, profile, zdot, SHOTS]) mkdirSync(dir, { recursive: true })
  writeFileSync(join(zdot, '.zshrc'), "PROMPT='$ '\nunset LESS LESSOPEN PAGER\nexport LANG=en_US.UTF-8\n")
  writeFileSync(
    join(profile, 'workspace.json'),
    JSON.stringify({
      version: 2,
      projects: [{ id: 'p1', name: 'tui', rootPath: project }],
      worktrees: [{ id: 'w1', projectId: 'p1', branch: '', path: project, isMain: true }],
      sessions: [{ id: SESSION, worktreeId: 'w1', kind: 'shell', title: 'Shell', startedAt: 1, lastActivityAt: 1 }],
      activeSessionId: SESSION,
      sidebarCollapsed: false,
      rightPanel: null,
      drafts: {}
    })
  )
  app = await launchApp({ ZDOTDIR: zdot, SHELL: '/bin/zsh' }, { userDataDir: profile })
  page = await app.firstWindow()
  await page.addInitScript(() => {
    ;(globalThis as unknown as { __TR_TERMINAL_PROBE__: boolean }).__TR_TERMINAL_PROBE__ = true
  })
  await page.reload()
  await expect(pane()).toBeVisible()
  await expect.poll(screen, { timeout: 20_000 }).toMatch(/^\$/m)
  await pane().click()
})

test.afterAll(async () => {
  await app?.close()
})

test('the terminal says what it is: xterm-256color, truecolor, 256 colours', async () => {
  await run('clear; echo "$TERM $COLORTERM $(tput colors)"')
  await expect.poll(screen).toMatch(/^xterm-256color truecolor 256$/m)
})

test('vim: insert CJK text, arrows in normal mode, mouse click, save, and the shell screen comes back', async () => {
  await run('clear; echo before-vim')
  await run('vim -Nu NONE -i NONE notes.txt')
  await expect.poll(screen).toMatch(/^~$/m)
  await expect.poll(screen).toContain('notes.txt')

  await page.keyboard.press('i')
  await page.keyboard.type('one')
  await page.keyboard.press('Enter')
  await page.keyboard.type('two')
  await page.keyboard.press('Enter')
  await page.keyboard.type('three 你好')
  await page.keyboard.press('Escape')
  await expect.poll(async () => (await lines()).slice(0, 3)).toEqual(['one', 'two', 'three 你好'])
  await page.waitForTimeout(300)
  // ↑ in normal mode (application cursor keys): from "three" up to "two", which dd deletes.
  await page.keyboard.press('ArrowUp')
  await page.keyboard.type('dd')
  await expect.poll(async () => (await lines()).slice(0, 2)).toEqual(['one', 'three 你好'])

  // With the mouse on, a click on the first line moves the cursor there.
  await page.keyboard.type(':set mouse=a')
  await page.keyboard.press('Enter')
  await clickCell(1, 0)
  await page.waitForTimeout(200)
  await page.keyboard.type('A!')
  await page.keyboard.press('Escape')
  await expect.poll(async () => (await lines())[0]).toBe('one!')
  await page.screenshot({ path: join(SHOTS, 'vim.png') })

  await page.keyboard.type(':wq')
  await page.keyboard.press('Enter')
  await expect.poll(() => readFileSync(join(project, 'notes.txt'), 'utf8')).toBe('one!\nthree 你好\n')
  await expect.poll(screen).not.toMatch(/^~$/m)
  await expectShellBack('before-vim')
})

test('vim follows a window resize', async () => {
  await run('clear; vim -Nu NONE -i NONE')
  await expect.poll(screen).toMatch(/^~$/m)
  const before = await size()
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    const [width = 1440, height = 900] = win?.getSize() ?? []
    win?.setSize(Math.max(960, width - 240), Math.max(600, height - 120))
  })
  await expect.poll(async () => (await size())?.cols).toBeLessThan(before?.cols ?? 0)
  await page.waitForTimeout(300)
  const after = await size()
  // vim's own idea of the width, written into the buffer.
  await page.keyboard.type(':put =&columns')
  await page.keyboard.press('Enter')
  await expect.poll(screen).toMatch(new RegExp(`^${after?.cols}$`, 'm'))
  await page.keyboard.type(':q!')
  await page.keyboard.press('Enter')
  await expect.poll(screen).not.toMatch(/^~$/m)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 900))
})

test('less: pages, arrows, search, the mouse wheel, G and q', async () => {
  await run('clear; echo before-less; seq 1 500 | less')
  await expect.poll(async () => (await lines())[0]).toBe('1')
  const rows = (await size())?.rows ?? 0
  expect((await lines()).at(-1)).toBe(':')

  await page.keyboard.press('Space')
  await expect.poll(async () => (await lines())[0]).toBe(String(rows))
  await page.keyboard.press('ArrowDown')
  await expect.poll(async () => (await lines())[0]).toBe(String(rows + 1))
  await page.keyboard.type('/250')
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await lines())[0]).toBe('250')

  // No mouse tracking on the alternate screen: the wheel scrolls the program (as arrow keys), not the scrollback.
  const box = await pane().boundingBox()
  await page.mouse.move((box?.x ?? 0) + 100, (box?.y ?? 0) + 100)
  await page.mouse.wheel(0, 200)
  await expect.poll(async () => Number((await lines())[0])).toBeGreaterThan(250)
  await page.screenshot({ path: join(SHOTS, 'less.png') })

  await page.keyboard.press('Shift+KeyG')
  await expect.poll(screen).toMatch(/^500$/m)
  await expect.poll(screen).toContain('(END)')
  await page.keyboard.press('q')
  await expect.poll(screen).not.toContain('(END)')
  await expectShellBack('before-less')
})

test('top: draws the process table and quits on q', async () => {
  await run('clear; echo before-top; top -s 1')
  await expect.poll(screen, { timeout: 10_000 }).toMatch(/Processes:/)
  await expect.poll(screen).toMatch(/PID\s+COMMAND/)
  await page.screenshot({ path: join(SHOTS, 'top.png') })
  await page.keyboard.press('q')
  await expect.poll(screen).not.toMatch(/Processes:/)
  await expectShellBack('before-top')
})

test('htop: draws meters and the process list, quits on q', async () => {
  test.skip(!hasHtop, 'htop is not installed')
  await run('clear; echo before-htop; htop')
  await expect.poll(screen, { timeout: 10_000 }).toMatch(/Tasks:/)
  await expect.poll(screen).toMatch(/PID\s+USER/)
  await page.screenshot({ path: join(SHOTS, 'htop.png') })
  await page.keyboard.press('q')
  await expect.poll(screen).not.toMatch(/Tasks:/)
  await expectShellBack('before-htop')
})
