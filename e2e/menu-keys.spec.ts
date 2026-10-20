// Every app-menu shortcut runs its command exactly once, as a real key press would (B8).
// On macOS a key press reaches the page first; a key the page handles (preventDefault) is never offered to the app
// menu, any other one goes to the menu item with that key equivalent (Electron docs on before-input-event,
// electron/electron#19279). Synthetic keys stop at the page — neither CDP nor webContents.sendInputEvent reaches
// NSMenu — so `press()` plays AppKit's half: when the page left the key alone, it clicks the menu item that owns the
// accelerator. A shortcut that both the page and the menu ran, or that neither did, shows up as a wrong count.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp } from './launch'

interface TrWindow {
  tr: { settings: { get(): Promise<{ appearance: { fontSize: number } }> } }
  __trWorkspace: { getState(): { activeSessionId: string | null; setActiveSession(id: string): void } }
  __trKeys: KeyboardEvent[]
}
interface DialogHook {
  requests: { message: string }[]
  answer: boolean
}

/** A menu item, as `menu › item` (`app` = the app menu); `quit` is the native ⌘Q role (AppKit runs terminate:, i.e. app.quit()). */
type Owner = readonly [string, string] | 'quit'

/** The app menu's shortcuts (Playwright key → menu item that owns the accelerator). */
const SHORTCUTS: { key: string; accelerator: string; item: Owner }[] = [
  { key: 'Meta+KeyN', accelerator: 'CmdOrCtrl+N', item: ['文件', '新建会话'] },
  { key: 'Meta+KeyO', accelerator: 'CmdOrCtrl+O', item: ['文件', '打开项目…'] },
  { key: 'Meta+KeyW', accelerator: 'CmdOrCtrl+W', item: ['文件', '关闭会话'] },
  { key: 'Meta+KeyF', accelerator: 'CmdOrCtrl+F', item: ['编辑', '在终端中查找…'] },
  { key: 'Meta+KeyK', accelerator: 'CmdOrCtrl+K', item: ['会话', '跳转到…'] },
  { key: 'Meta+Shift+KeyA', accelerator: 'CmdOrCtrl+Shift+A', item: ['会话', '总览'] },
  { key: 'Meta+KeyJ', accelerator: 'CmdOrCtrl+J', item: ['会话', '下一个需要你的会话'] },
  { key: 'Meta+Shift+KeyM', accelerator: 'Shift+CmdOrCtrl+M', item: ['会话', '合并到基线…'] },
  { key: 'Meta+KeyB', accelerator: 'CmdOrCtrl+B', item: ['显示', '显示 / 隐藏侧栏'] },
  { key: 'Meta+Shift+KeyB', accelerator: 'Shift+CmdOrCtrl+B', item: ['显示', '显示 / 隐藏右侧栏'] },
  { key: 'Meta+Shift+Equal', accelerator: 'CmdOrCtrl+Plus', item: ['显示', '放大'] },
  { key: 'Meta+Equal', accelerator: 'CmdOrCtrl+=', item: ['显示', '放大'] },
  { key: 'Meta+Minus', accelerator: 'CmdOrCtrl+-', item: ['显示', '缩小'] },
  { key: 'Meta+Digit0', accelerator: 'CmdOrCtrl+0', item: ['显示', '实际大小'] },
  { key: 'Meta+Comma', accelerator: 'CmdOrCtrl+,', item: ['app', '设置…'] },
  { key: 'Alt+Meta+KeyQ', accelerator: 'Alt+CmdOrCtrl+Q', item: ['app', '退出并结束所有会话…'] },
  { key: 'Meta+KeyQ', accelerator: 'CmdOrCtrl+Q', item: 'quit' }
]

let app: ElectronApplication
let page: Page

const sidebar = () => page.locator('[data-region="sidebar"]')
const terminal = () => page.locator('[data-region="terminal"] [data-active="true"]')
const settings = () => page.getByRole('dialog', { name: '设置' })
const findBar = () => page.getByTestId('terminal-search')
const fontSize = () => page.evaluate(async () => (await (globalThis as unknown as TrWindow).tr.settings.get()).appearance.fontSize)
const activeId = () => page.evaluate(() => (globalThis as unknown as TrWindow).__trWorkspace.getState().activeSessionId)
const activate = (id: string) => page.evaluate((sid) => (globalThis as unknown as TrWindow).__trWorkspace.getState().setActiveSession(sid), id)
const dialogs = () => app.evaluate(() => (globalThis as unknown as { __trDialogs: DialogHook }).__trDialogs.requests.length)
const folderPickers = () => app.evaluate(() => (globalThis as unknown as { __pickers: number }).__pickers)

/** Runs a menu item the way AppKit does for its key equivalent (the window that has the keyboard, or none). */
function runMenuItem(item: Owner): Promise<void> {
  return app.evaluate(({ app: electronApp, Menu, BrowserWindow }, owner) => {
    if (owner === 'quit') return electronApp.quit()
    const [menu, label] = owner
    const items = Menu.getApplicationMenu()?.items ?? []
    // The app menu is named after the app (Wavi, or Electron in a bare run).
    const top = menu === 'app' ? items[0] : items.find((x) => x.label === menu)
    const entry = top?.submenu?.items.find((x) => x.label === label && x.visible)
    if (!entry) throw new Error(`no menu item ${menu} › ${label}`)
    entry.click(undefined, BrowserWindow.getFocusedWindow() ?? undefined, undefined)
  }, item)
}

/** One real key press: the page first, then — only if the page left it alone — the app menu. */
async function press(key: string): Promise<'page' | 'menu'> {
  const shortcut = SHORTCUTS.find((s) => s.key === key)
  if (!shortcut) throw new Error(`no menu shortcut ${key}`)
  const before = await page.evaluate(() => (globalThis as unknown as TrWindow).__trKeys.length)
  await page.keyboard.press(key)
  const handled = await page.evaluate((n) => {
    const keys = (globalThis as unknown as TrWindow).__trKeys
    if (keys.length !== n + 1) throw new Error(`expected one keydown, saw ${keys.length - n}`)
    return keys[n]!.defaultPrevented
  }, before)
  if (handled) return 'page'
  await runMenuItem(shortcut.item)
  return 'menu'
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  app = await launchApp()
  page = await app.firstWindow()
  await page.addInitScript(() => {
    const g = globalThis as unknown as { __TR_E2E__: boolean; __trKeys: KeyboardEvent[] }
    g.__TR_E2E__ = true
    // Registered before the app's own capture listeners, so it sees every keydown and keeps the event to read
    // defaultPrevented after the app has handled it.
    g.__trKeys = []
    addEventListener('keydown', (e) => !['Meta', 'Shift', 'Alt', 'Control'].includes(e.key) && g.__trKeys.push(e), true)
  })
  await page.reload()
  await expect(sidebar()).toBeVisible()
  await app.evaluate(({ dialog }) => {
    const g = globalThis as unknown as { __pickers: number; __trDialogs: DialogHook }
    g.__pickers = 0
    g.__trDialogs.answer = false
    // The folder picker is a native sheet a test cannot click: count it and cancel.
    dialog.showOpenDialog = (async () => {
      g.__pickers++
      return { canceled: true, filePaths: [] }
    }) as typeof dialog.showOpenDialog
  })
})

test.afterAll(async () => {
  // Quitting asks while sessions run: let it through.
  await app?.evaluate(() => {
    ;(globalThis as unknown as { __trDialogs: DialogHook }).__trDialogs.answer = true
  })
  await app?.close()
})

test('the table covers every shortcut in the app menu', async () => {
  const accelerators = await app.evaluate(({ Menu }) => {
    const found: string[] = []
    const walk = (items: Electron.MenuItem[]) => {
      for (const item of items) {
        if (item.accelerator && !item.role) found.push(item.accelerator)
        if (item.submenu) walk(item.submenu.items)
      }
    }
    walk(Menu.getApplicationMenu()?.items ?? [])
    return found
  })
  expect([...accelerators].sort()).toEqual(SHORTCUTS.filter((s) => s.item !== 'quit').map((s) => s.accelerator).sort())
})

test.describe('with the keyboard in the terminal', () => {
  test.beforeEach(async () => {
    await page.keyboard.press('Escape')
    await terminal().click()
    await expect(page.locator('[data-region="terminal"] .xterm-helper-textarea:focus')).toHaveCount(1)
  })

  test('⌘N opens the new-session sheet once', async () => {
    expect(await press('Meta+KeyN')).toBe('page')
    await expect(page.getByTestId('new-session-sheet')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('new-session-sheet')).toHaveCount(0)
  })

  test('⌘O shows the folder picker once', async () => {
    const before = await folderPickers()
    expect(await press('Meta+KeyO')).toBe('page')
    await expect.poll(folderPickers).toBe(before + 1)
    await page.waitForTimeout(400)
    expect(await folderPickers()).toBe(before + 1)
  })

  test('⌘W asks once before closing the running session', async () => {
    const before = await dialogs()
    expect(await press('Meta+KeyW')).toBe('page')
    await expect.poll(dialogs).toBe(before + 1)
    await page.waitForTimeout(400)
    expect(await dialogs()).toBe(before + 1)
  })

  test('⌘F opens find and ⌘K the palette, each once (a second run would close the palette)', async () => {
    expect(await press('Meta+KeyF')).toBe('page')
    await expect(findBar()).toBeVisible()
    await page.keyboard.press('Escape')
    await terminal().click()
    expect(await press('Meta+KeyK')).toBe('page')
    await page.waitForTimeout(400)
    await expect(page.getByTestId('command-palette')).toBeVisible()
  })

  test('⇧⌘A, ⌘B and ⇧⌘B toggle once', async () => {
    const overview = page.locator('[data-region="overview"]')
    expect(await press('Meta+Shift+KeyA')).toBe('page')
    await page.waitForTimeout(400)
    await expect(overview).toBeVisible()
    expect(await press('Meta+Shift+KeyA')).toBe('page')
    await expect(overview).toHaveCount(0)

    await terminal().click()
    expect(await press('Meta+KeyB')).toBe('page')
    await page.waitForTimeout(400)
    await expect(sidebar()).toHaveCount(0)
    expect(await press('Meta+KeyB')).toBe('page')
    await expect(sidebar()).toBeVisible()

    const panel = page.locator('[data-region="panel"]')
    const open = (await panel.count()) > 0
    await terminal().click()
    expect(await press('Meta+Shift+KeyB')).toBe('page')
    await page.waitForTimeout(400)
    await expect(panel).toHaveCount(open ? 0 : 1)
    await page.locator('[data-region="terminal"] [data-active="true"]').click()
    expect(await press('Meta+Shift+KeyB')).toBe('page')
    await expect(panel).toHaveCount(open ? 1 : 0)
  })

  test('⌘J moves one step, to the session the menu item would pick', async () => {
    await activate('s-cookie')
    await runMenuItem(['会话', '下一个需要你的会话'])
    const expected = await activeId()
    expect(expected).not.toBe('s-cookie')
    await activate('s-cookie')
    await terminal().click()
    expect(await press('Meta+KeyJ')).toBe('page')
    await page.waitForTimeout(400)
    expect(await activeId()).toBe(expected)
    await activate('s-cookie')
  })

  test('⇧⌘M opens the merge sheet once', async () => {
    expect(await press('Meta+Shift+KeyM')).toBe('page')
    await expect(page.getByTestId('merge-sheet')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('merge-sheet')).toHaveCount(0)
  })

  test('⌘+, ⌘=, ⌘- and ⌘0 are left to the menu and step the font size once', async () => {
    const start = await fontSize()
    expect(await press('Meta+Shift+Equal')).toBe('menu')
    await expect.poll(fontSize).toBe(start + 1)
    await terminal().click()
    expect(await press('Meta+Equal')).toBe('menu')
    await expect.poll(fontSize).toBe(start + 2)
    await terminal().click()
    expect(await press('Meta+Minus')).toBe('menu')
    await expect.poll(fontSize).toBe(start + 1)
    await terminal().click()
    expect(await press('Meta+Digit0')).toBe('menu')
    await expect.poll(fontSize).toBe(13)
  })

  test('⌘, is left to the menu and opens settings', async () => {
    expect(await press('Meta+Comma')).toBe('menu')
    await expect(settings()).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(settings()).toHaveCount(0)
  })

  test('⌘Q and ⌥⌘Q are left to the menu and ask once', async () => {
    let before = await dialogs()
    expect(await press('Meta+KeyQ')).toBe('menu')
    await expect.poll(dialogs).toBe(before + 1)
    expect((await app.evaluate(() => (globalThis as unknown as { __trDialogs: DialogHook }).__trDialogs.requests.at(-1)?.message)) ?? '').toContain('退出会中断它们')

    await terminal().click()
    before = await dialogs()
    expect(await press('Alt+Meta+KeyQ')).toBe('menu')
    await expect.poll(dialogs).toBe(before + 1)
    expect((await app.evaluate(() => (globalThis as unknown as { __trDialogs: DialogHook }).__trDialogs.requests.at(-1)?.message)) ?? '').toContain('结束后它们会中断')
    await page.waitForTimeout(400)
    expect(await dialogs()).toBe(before + 1)
    await expect(page.locator('[data-region="main"]')).toBeVisible()
  })
})

test.describe('with a dialog in front', () => {
  test('⌘F in settings does not open find behind it, from the key or the menu', async () => {
    await runMenuItem(['app', '设置…'])
    await expect(settings()).toBeVisible()
    await settings().focus()
    await press('Meta+KeyF')
    await page.waitForTimeout(300)
    await expect(findBar()).toHaveCount(0)
    await expect(settings()).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(settings()).toHaveCount(0)
  })

  test('⌘F in the command palette leaves the palette alone', async () => {
    await terminal().click()
    await press('Meta+KeyK')
    const palette = page.getByTestId('command-palette')
    await expect(palette).toBeVisible()
    await press('Meta+KeyF')
    await page.waitForTimeout(300)
    await expect(findBar()).toHaveCount(0)
    await expect(palette).toBeVisible()
    await page.keyboard.press('Escape')
  })

  test('the font size still steps from inside settings', async () => {
    await runMenuItem(['app', '设置…'])
    await expect(settings()).toBeVisible()
    await settings().focus()
    const start = await fontSize()
    expect(await press('Meta+Equal')).toBe('menu')
    await expect.poll(fontSize).toBe(start + 1)
    expect(await press('Meta+Digit0')).toBe('menu')
    await expect.poll(fontSize).toBe(13)
    await page.keyboard.press('Escape')
  })
})
