// App menu and shortcuts (B8): Chinese menus, menu commands reach the renderer, font size steps, shortcut hints.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp } from './launch'

let app: ElectronApplication
let page: Page

interface TrWindow {
  tr: { settings: { get(): Promise<{ appearance: { fontSize: number } }> } }
}

const sidebar = () => page.locator('[data-region="sidebar"]')
const fontSize = () => page.evaluate(async () => (await (globalThis as unknown as TrWindow).tr.settings.get()).appearance.fontSize)

/** Clicks `menu › item` in the application menu, as a mouse click on it would. */
const clickMenu = (menu: string, item: string) =>
  app.evaluate(
    ({ Menu }, [m, i]) => {
      const entry = Menu.getApplicationMenu()
        ?.items.find((x) => x.label === m)
        ?.submenu?.items.find((x) => x.label === i && x.visible)
      if (!entry) throw new Error(`no menu item ${m} › ${i}`)
      entry.click()
    },
    [menu, item]
  )

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  app = await launchApp()
  page = await app.firstWindow()
  await page.addInitScript(() => {
    ;(globalThis as unknown as { __TR_E2E__: boolean }).__TR_E2E__ = true
  })
  await page.reload()
  await expect(sidebar()).toBeVisible()
})

test.afterAll(async () => {
  await app.close()
})

test('the menus are in Chinese and show their shortcuts', async () => {
  const menus = await app.evaluate(({ Menu }) =>
    (Menu.getApplicationMenu()?.items ?? []).map((m) => ({
      label: m.label,
      items: (m.submenu?.items ?? []).filter((i) => i.visible && i.type !== 'separator').map((i) => [i.label, i.accelerator ?? ''])
    }))
  )
  expect(menus.slice(1).map((m) => m.label)).toEqual(['文件', '编辑', '会话', '显示', '窗口'])
  const items = (label: string) => menus.find((m) => m.label === label)?.items ?? []
  expect(items('文件')).toEqual([
    ['新建会话', 'CmdOrCtrl+N'],
    ['打开项目…', 'CmdOrCtrl+O'],
    ['关闭会话', 'CmdOrCtrl+W']
  ])
  expect(items('编辑').map(([l]) => l)).toEqual(['撤销', '重做', '剪切', '拷贝', '粘贴', '全选', '在终端中查找…'])
  expect(items('显示')).toContainEqual(['显示 / 隐藏侧栏', 'CmdOrCtrl+B'])
  expect(items('显示')).toContainEqual(['显示 / 隐藏右侧栏', 'Shift+CmdOrCtrl+B'])
  // Nothing English is left at the top level or in the items we own.
  for (const menu of menus.slice(1)) for (const [label] of menu.items) expect(label).toMatch(/[一-鿿]/)
})

test('menu commands reach the renderer: sidebar, find, rename, overview', async () => {
  await clickMenu('显示', '显示 / 隐藏侧栏')
  await expect(sidebar()).toHaveCount(0)
  await clickMenu('显示', '显示 / 隐藏侧栏')
  await expect(sidebar()).toBeVisible()

  await clickMenu('编辑', '在终端中查找…')
  await expect(page.getByTestId('terminal-search')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('terminal-search')).toHaveCount(0)

  await clickMenu('会话', '重命名会话')
  await expect(page.locator('header input')).toBeFocused()
  await page.keyboard.press('Escape')

  await clickMenu('会话', '总览')
  await expect(page.locator('[data-region="overview"]')).toBeVisible()
  await clickMenu('会话', '总览')
  await expect(page.locator('[data-region="overview"]')).toHaveCount(0)
})

test('⌘B toggles the sidebar and ⇧⌘B the right panel, exactly once, also from the terminal', async () => {
  await page.locator('[data-region="terminal"] [data-active="true"]').click()
  await page.keyboard.press('Meta+B')
  await expect(sidebar()).toHaveCount(0)
  await page.waitForTimeout(400)
  await expect(sidebar()).toHaveCount(0)
  await page.keyboard.press('Meta+B')
  await expect(sidebar()).toBeVisible()
  const panel = page.locator('[data-region="panel"]')
  const open = (await panel.count()) > 0
  await page.keyboard.press('Meta+Shift+B')
  await expect(panel).toHaveCount(open ? 0 : 1)
  await page.waitForTimeout(400)
  await expect(panel).toHaveCount(open ? 0 : 1)
  await page.keyboard.press('Meta+Shift+B')
  await expect(panel).toHaveCount(open ? 1 : 0)
})

test('放大 / 缩小 / 实际大小 step the terminal font size', async () => {
  const start = await fontSize()
  await clickMenu('显示', '放大')
  await expect.poll(fontSize).toBe(start + 1)
  await clickMenu('显示', '缩小')
  await clickMenu('显示', '缩小')
  await expect.poll(fontSize).toBe(start - 1)
  await clickMenu('显示', '实际大小')
  await expect.poll(fontSize).toBe(13)
})

test('⌘K rows carry the same shortcuts', async () => {
  await page.keyboard.press('Meta+k')
  const palette = page.getByTestId('command-palette')
  await expect(palette.getByRole('option', { name: /打开总览/ })).toContainText('⇧⌘A')
  await expect(palette.getByRole('option', { name: /切换侧栏/ })).toContainText('⌘B')
  await expect(palette.getByRole('option', { name: /右侧栏/ })).toContainText('⇧⌘B')
  await page.keyboard.press('Escape')
})
