// Copy and paste in the terminal (B19), through the same webContents.copy() / paste() the Edit menu's 拷贝 / 粘贴
// (⌘C / ⌘V) call, with the real system clipboard.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp } from './launch'

interface Hook {
  readScreen(sessionId: string, scrollbackLines?: number): string
}
const SESSION = 's-cookie'

let app: ElectronApplication
let page: Page
let savedClipboard = ''

const pane = () => page.locator(`[data-region="terminal"] [data-session-id="${SESSION}"]`)
const screen = () => page.evaluate((id) => (globalThis as unknown as { __trTerminals: Hook }).__trTerminals.readScreen(id), SESSION)
const clipboard = () => app.evaluate(({ clipboard: c }) => c.readText())
const setClipboard = (text: string) => app.evaluate(({ clipboard: c }, t) => c.writeText(t), text)
const editCommand = (command: 'copy' | 'paste') =>
  app.evaluate(({ BrowserWindow }, c) => {
    const contents = BrowserWindow.getAllWindows()[0]?.webContents
    if (c === 'copy') contents?.copy()
    else contents?.paste()
  }, command)

async function run(command: string): Promise<void> {
  await pane().click()
  await page.keyboard.type(command)
  await page.keyboard.press('Enter')
}

test.describe.configure({ mode: 'serial' })
test.setTimeout(60_000)

test.beforeAll(async () => {
  app = await launchApp()
  page = await app.firstWindow()
  await page.addInitScript(() => {
    ;(globalThis as unknown as { __TR_E2E__: boolean }).__TR_E2E__ = true
  })
  await page.reload()
  await expect(pane()).toBeVisible()
  await expect.poll(screen, { timeout: 20_000 }).not.toBe('')
  savedClipboard = await clipboard()
})

test.afterAll(async () => {
  // The clipboard is the developer's own: put it back.
  await setClipboard(savedClipboard)
  await app.close()
})

test('⌘A selects everything and 拷贝 puts it on the clipboard, CJK included', async () => {
  await run("clear; printf 'copy-marker 你好世界\\n'")
  await expect.poll(screen, { timeout: 10_000 }).toMatch(/^copy-marker 你好世界$/m)
  await page.keyboard.press('Meta+a')
  await editCommand('copy')
  await expect.poll(clipboard).toContain('copy-marker 你好世界')
})

test('拷贝 with nothing selected leaves the clipboard alone and sends nothing to the shell', async () => {
  await run('clear')
  await pane().click()
  await setClipboard('untouched')
  await editCommand('copy')
  await page.waitForTimeout(200)
  expect(await clipboard()).toBe('untouched')
  expect(await screen()).not.toContain('^C')
})

test('粘贴 types the clipboard into the shell', async () => {
  await setClipboard('echo pasted-$((20+1))-中文')
  await pane().click()
  await editCommand('paste')
  await page.keyboard.press('Enter')
  await expect.poll(screen, { timeout: 10_000 }).toMatch(/^pasted-21-中文$/m)
})

test('a program that asks for bracketed paste gets the paste wrapped', async () => {
  await run("clear; printf '\\033[?2004h'; cat -v")
  await setClipboard('abc')
  await page.waitForTimeout(300)
  await editCommand('paste')
  await page.keyboard.press('Enter')
  await expect.poll(screen, { timeout: 10_000 }).toContain('^[[200~abc^[[201~')
  await page.keyboard.press('Control+c')
  await run("printf '\\033[?2004l'; clear")
})

test('with mouse reporting on (as in agent TUIs), ⌥-drag still selects text to copy', async () => {
  await run("clear; printf 'drag-target-text\\n\\033[?1000h'")
  await expect.poll(screen, { timeout: 10_000 }).toMatch(/^drag-target-text$/m)
  const box = await pane().locator('.xterm-screen').boundingBox()
  if (!box) throw new Error('no terminal screen')
  const rows = await page.evaluate((id) => (globalThis as unknown as { __trTerminals: { size(id: string): { rows: number } | null } }).__trTerminals.size(id)?.rows ?? 24, SESSION)
  const rowHeight = box.height / rows
  const y = box.y + rowHeight / 2
  await page.keyboard.down('Alt')
  await page.mouse.move(box.x + 1, y)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 3, y, { steps: 5 })
  await page.mouse.up()
  await page.keyboard.up('Alt')
  await setClipboard('')
  await editCommand('copy')
  await expect.poll(clipboard).toContain('drag-target')
  await run("printf '\\033[?1000l'; clear")
})
