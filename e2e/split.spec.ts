// Main-area split (PRD F20 · Figma 21) over the fixture workspace: sessions dragged from the sidebar into the
// terminal area make 2 / 3 / 4 panes, panes swap and resize, × and ⌥⌘W close one, ⌘D / ⇧⌘D split with the session
// picker, ⌥⌘ arrows move the keyboard, typing reaches only the focused pane's PTY and the right panel follows it.
// Screenshots of every state in both themes (test-results/split). Restoring after a restart is in split-restore.spec.ts.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, setWindowSize } from './launch'

const SHOTS = join(process.cwd(), 'test-results', 'split')

interface Hook {
  readScreen(sessionId: string, scrollbackLines?: number): string
  info(sessionId: string): { fontSize: number } | null
}
interface SplitNode {
  type: 'pane' | 'split'
  id?: string
  dir?: 'row' | 'column'
  children?: SplitNode[]
  sizes?: number[]
}
interface WorkspaceHook {
  getState(): { activeSessionId: string | null; split: SplitNode | null; rightPanel: string | null; setActiveSession(id: string): void }
}

let app: ElectronApplication
let page: Page

const sidebarRow = (id: string) => page.locator(`[data-region="sidebar"] [data-session-id="${id}"]`)
const terminalOf = (id: string) => page.locator(`[data-region="terminal"] [data-session-id="${id}"]`)
const headerOf = (id: string) => page.locator(`[data-region="split"] [data-pane-id="${id}"]`)
const area = () => page.locator('[data-region="split"]')
const picker = () => page.locator('[data-pane-id="split:picker"]')
const dropTarget = () => page.locator('[data-region="split"] [data-zone]')

const workspace = () => page.evaluate(() => (globalThis as unknown as { __trWorkspace: WorkspaceHook }).__trWorkspace.getState())
const shape = async (): Promise<string> => {
  const draw = (node: SplitNode | null): string =>
    !node ? '∅' : node.type === 'pane' ? (node.id ?? '') : `${node.dir === 'row' ? 'row' : 'col'}(${(node.children ?? []).map(draw).join(' ')})`
  return draw((await workspace()).split)
}
const activeId = async () => (await workspace()).activeSessionId
const screen = (id: string) =>
  page.evaluate((sid) => (globalThis as unknown as { __trTerminals: Hook }).__trTerminals.readScreen(sid), id)
const fontOf = (id: string) =>
  page.evaluate((sid) => (globalThis as unknown as { __trTerminals: Hook }).__trTerminals.info(sid)?.fontSize ?? 0, id)
let baseFont = 0

const setTheme = (theme: 'dark' | 'light') =>
  page.evaluate((t) => {
    ;(globalThis as unknown as { document: { documentElement: { dataset: Record<string, string> } } }).document.documentElement.dataset.theme = t
  }, theme)
const shoot = async (name: string) => {
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(theme)
    await page.waitForTimeout(150)
    await page.screenshot({ path: join(SHOTS, `${name}-${theme}.png`) })
  }
  await setTheme('dark')
}

/** Presses on a sidebar row and moves (in steps, so the drag starts) to a point of the terminal area. */
async function dragRowTo(id: string, at: (box: { x: number; y: number; width: number; height: number }) => { x: number; y: number }, release = true) {
  // CI's screen caps the window's height below 900: the last rows sit under the fold until the sidebar scrolls.
  await sidebarRow(id).scrollIntoViewIfNeeded()
  const row = await sidebarRow(id).boundingBox()
  const target = await area().boundingBox()
  if (!row || !target) throw new Error('nothing to drag')
  await page.mouse.move(row.x + row.width / 2, row.y + row.height / 2)
  await page.mouse.down()
  const point = at(target)
  await page.mouse.move(point.x, point.y, { steps: 8 })
  if (release) await page.mouse.up()
}

/** A point in a pane: `fx`, `fy` as 0…1 across the whole pane (header included). */
async function inPane(id: string, fx: number, fy: number): Promise<{ x: number; y: number }> {
  const header = await headerOf(id).boundingBox()
  const term = await terminalOf(id).boundingBox()
  if (!header || !term) throw new Error(`no pane ${id}`)
  return { x: header.x + header.width * fx, y: header.y + (term.y + term.height - header.y) * fy }
}

async function run(id: string, command: string): Promise<void> {
  await terminalOf(id).click()
  await page.keyboard.type(command)
  await page.keyboard.press('Enter')
}

test.describe.configure({ mode: 'serial' })
test.setTimeout(60_000)

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true })
  app = await launchApp()
  page = await app.firstWindow()
  await page.addInitScript(() => {
    ;(globalThis as unknown as { __TR_E2E__: boolean }).__TR_E2E__ = true
  })
  await page.reload()
  await setWindowSize(app, page, 1440, 900)
  await expect(terminalOf('s-cookie')).toBeVisible()
  await expect.poll(() => screen('s-cookie'), { timeout: 20_000 }).not.toBe('')
})

test.afterAll(async () => {
  await app?.close()
})

test('dragging a sidebar session onto the right edge makes two panes side by side', async () => {
  await dragRowTo('s-perf', (box) => ({ x: box.x + box.width - 30, y: box.y + box.height / 2 }), false)
  // While dragging: the target half and its caption, the dragged row's ghost, never the file-drop frame.
  await expect(dropTarget()).toHaveAttribute('data-zone', 'right')
  await expect(dropTarget()).toContainText('松开在这里显示这个会话')
  await expect(page.locator('[data-file-drop="true"]')).toHaveCount(0)
  await shoot('21D1-drag-edge')
  await page.mouse.up()
  await expect.poll(shape).toBe('row(s-cookie s-perf)')
  await expect(terminalOf('s-perf')).toBeVisible()
  await expect(terminalOf('s-cookie')).toBeVisible()
  // The dropped session gets the keyboard; both are marked in the sidebar, the focused one strongest.
  await expect.poll(activeId).toBe('s-perf')
  await expect(sidebarRow('s-perf')).toHaveAttribute('data-selected', 'true')
  await expect(sidebarRow('s-cookie')).toHaveAttribute('data-shown', 'true')
  await expect.poll(() => screen('s-perf'), { timeout: 20_000 }).not.toBe('')
  await shoot('21A-two-panes')
})

test('a click on a sidebar row is still a click (no drag)', async () => {
  await sidebarRow('s-cookie').click()
  await expect.poll(activeId).toBe('s-cookie')
  await expect.poll(shape).toBe('row(s-cookie s-perf)')
})

test('dropping on the bottom edge of a pane stacks a third pane under it', async () => {
  const point = await inPane('s-perf', 0.5, 0.92)
  await dragRowTo('s-sidebar', () => point)
  await expect.poll(shape).toBe('row(s-cookie col(s-perf s-sidebar))')
  await expect(terminalOf('s-sidebar')).toBeVisible()
  await shoot('21B-three-panes')
})

test('a fourth pane, then an edge refuses a fifth while the middle replaces', async () => {
  const point = await inPane('s-cookie', 0.5, 0.92)
  await dragRowTo('s-graph', () => point)
  await expect.poll(shape).toBe('row(col(s-cookie s-graph) col(s-perf s-sidebar))')
  await shoot('21C-four-panes')
  const edge = await inPane('s-sidebar', 0.06, 0.6)
  await dragRowTo('s-nav', () => edge, false)
  await expect(page.locator('[data-region="split"] [data-refused="max"]')).toContainText('最多 4 格')
  await expect(dropTarget()).toHaveCount(0)
  await shoot('21E-four-max')
  await page.mouse.up()
  await expect.poll(shape).toBe('row(col(s-cookie s-graph) col(s-perf s-sidebar))')
  const middle = await inPane('s-sidebar', 0.5, 0.55)
  await dragRowTo('s-nav', () => middle, false)
  await expect(dropTarget()).toHaveAttribute('data-zone', 'center')
  await expect(dropTarget()).toContainText('松开换掉这一格')
  await shoot('21D2-drag-centre')
  await page.mouse.up()
  await expect.poll(shape).toBe('row(col(s-cookie s-graph) col(s-perf s-nav))')
})

test('dragging a pane by its title onto another pane swaps them', async () => {
  const title = headerOf('s-cookie').locator('h1')
  const from = await title.boundingBox()
  const to = await inPane('s-nav', 0.5, 0.55)
  if (!from) throw new Error('no title')
  await page.mouse.move(from.x + 10, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 8 })
  await expect(dropTarget()).toContainText('松开交换这两格')
  await page.mouse.up()
  await expect.poll(shape).toBe('row(col(s-nav s-graph) col(s-perf s-cookie))')
})

test('the hairline between panes drags to resize, and double-click evens them out', async () => {
  const handle = page.locator('[data-region="split"] [role="separator"][aria-orientation="vertical"]')
  const before = await terminalOf('s-nav').boundingBox()
  const box = await handle.boundingBox()
  if (!before || !box) throw new Error('no handle')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2, { steps: 6 })
  await page.mouse.up()
  await expect.poll(async () => (await terminalOf('s-nav').boundingBox())?.width ?? 0).toBeGreaterThan(before.width + 150)
  await handle.dblclick()
  await expect.poll(async () => Math.round((await terminalOf('s-nav').boundingBox())?.width ?? 0)).toBe(Math.round(before.width))
})

test('typing reaches only the focused pane, and the right panel follows the focused pane', async () => {
  await run('s-graph', 'echo only-in-graph')
  await expect.poll(() => screen('s-graph'), { timeout: 10_000 }).toMatch(/^only-in-graph$/m)
  await expect.poll(activeId).toBe('s-graph')
  for (const other of ['s-nav', 's-perf', 's-cookie']) expect(await screen(other)).not.toContain('only-in-graph')
  // The unfocused panes keep only … and × in their header.
  await expect(headerOf('s-perf').getByRole('button', { name: '添加文件或文件夹' })).toHaveCount(0)
  await expect(headerOf('s-graph').getByRole('button', { name: '添加文件或文件夹' })).toBeVisible()
  // ⌘F finds in the focused pane: the bar floats at that pane's top right.
  await page.keyboard.press('Meta+KeyF')
  const bar = await page.getByTestId('terminal-search').boundingBox()
  const graph = await terminalOf('s-graph').boundingBox()
  if (!bar || !graph) throw new Error('no find bar')
  expect(bar.x).toBeGreaterThan(graph.x)
  expect(bar.x + bar.width).toBeLessThanOrEqual(graph.x + graph.width)
  expect(bar.y).toBeGreaterThanOrEqual(graph.y)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('terminal-search')).toHaveCount(0)
  // Right panel: open Files from the focused header; clicking another pane switches it to that worktree.
  await headerOf('s-graph').getByRole('button', { name: '文件', exact: true }).click()
  const panel = page.locator('[data-region="panel"]')
  await expect(panel).toBeVisible()
  await expect(panel).toContainText('graph-layout')
  await terminalOf('s-perf').click()
  await expect.poll(activeId).toBe('s-perf')
  await expect(panel).toContainText('checkout-perf', { timeout: 2_000 })
  await shoot('21H-right-panel')
  await page.keyboard.press('Meta+Shift+KeyB')
  await expect(panel).toBeHidden()
})

test('⌥⌘ arrows move the keyboard between panes', async () => {
  await terminalOf('s-nav').click()
  await expect.poll(activeId).toBe('s-nav')
  await page.keyboard.press('Alt+Meta+ArrowRight')
  await expect.poll(activeId).toBe('s-perf')
  await page.keyboard.press('Alt+Meta+ArrowDown')
  await expect.poll(activeId).toBe('s-cookie')
  await page.keyboard.press('Alt+Meta+ArrowLeft')
  await expect.poll(activeId).toBe('s-graph')
  await page.keyboard.press('Alt+Meta+ArrowUp')
  await expect.poll(activeId).toBe('s-nav')
  await expect(page.locator(`[data-region="terminal"] [data-session-id="s-nav"] .xterm-helper-textarea`)).toBeFocused()
})

test('⌘+ / ⌘- in a split size only the focused pane; ⌘0 brings back the setting', async () => {
  baseFont = await fontOf('s-perf')
  await terminalOf('s-nav').click()
  await page.keyboard.press('Meta+Equal')
  await expect.poll(() => fontOf('s-nav')).toBe(baseFont + 1)
  expect(await fontOf('s-perf')).toBe(baseFont)
  await page.keyboard.press('Meta+Minus')
  await page.keyboard.press('Meta+Minus')
  await expect.poll(() => fontOf('s-nav')).toBe(baseFont - 1)
  await page.keyboard.press('Meta+Digit0')
  await expect.poll(() => fontOf('s-nav')).toBe(baseFont)
  // Left one step bigger: the end of the split brings it back (below).
  await page.keyboard.press('Meta+Equal')
  await expect.poll(() => fontOf('s-nav')).toBe(baseFont + 1)
  // The setting itself did not change.
  const setting = await page.evaluate(async () => (await (globalThis as unknown as { tr: { settings: { get(): Promise<{ appearance: { fontSize: number } }> } } }).tr.settings.get()).appearance.fontSize)
  expect(setting).toBe(baseFont)
})

test('switching to a session already shown focuses its pane; another one replaces the focused pane', async () => {
  await sidebarRow('s-cookie').click()
  await expect.poll(activeId).toBe('s-cookie')
  await expect.poll(shape).toBe('row(col(s-nav s-graph) col(s-perf s-cookie))')
  await sidebarRow('s-acme-main').click()
  await expect.poll(shape).toBe('row(col(s-nav s-graph) col(s-perf s-acme-main))')
  await expect.poll(activeId).toBe('s-acme-main')
})

test('× closes only that pane and ⌥⌘W the focused one; the sessions keep running', async () => {
  await headerOf('s-graph').getByRole('button', { name: '关掉这一格' }).click()
  await expect.poll(shape).toBe('row(s-nav col(s-perf s-acme-main))')
  await expect(sidebarRow('s-graph')).toBeVisible()
  await terminalOf('s-perf').click()
  await page.keyboard.press('Alt+Meta+KeyW')
  await expect.poll(shape).toBe('row(s-nav s-acme-main)')
  await expect.poll(activeId).not.toBe('s-perf')
  // Each session still has its terminal: it just is not shown.
  expect(await screen('s-perf')).not.toBe('')
  await headerOf('s-acme-main').getByRole('button', { name: '关掉这一格' }).click()
  await expect.poll(() => workspace().then((s) => s.split)).toBeNull()
  await expect.poll(activeId).toBe('s-nav')
  // One pane left: no ×, the plain session view again, at the setting's font size.
  await expect(headerOf('s-nav').getByRole('button', { name: '关掉这一格' })).toHaveCount(0)
  await expect.poll(() => fontOf('s-nav')).toBe(baseFont)
})

test('⌘D splits right with the session picker; ↵ picks, Esc cancels', async () => {
  await terminalOf('s-nav').click()
  await page.keyboard.press('Meta+KeyD')
  await expect(picker()).toBeVisible()
  await expect(picker().locator('input')).toBeFocused()
  // The picker has the keyboard: the session pane steps back (Figma 21G).
  await expect(headerOf('s-nav')).toHaveAttribute('data-focused', 'false')
  // Every session not shown, in sidebar order.
  await expect(picker().locator('[data-pick-id]')).toHaveCount(5)
  await shoot('21G-picker')
  await page.keyboard.type('结算')
  await expect(picker().locator('[data-pick-id]')).toHaveCount(1)
  await page.keyboard.press('Enter')
  await expect.poll(shape).toBe('row(s-nav s-perf)')
  await expect.poll(activeId).toBe('s-perf')
  await expect(page.locator(`[data-region="terminal"] [data-session-id="s-perf"] .xterm-helper-textarea`)).toBeFocused()
  await expect(headerOf('s-perf')).toHaveAttribute('data-focused', 'true')
  // ⇧⌘D: down; Esc takes the new pane away and gives the keyboard back.
  await page.keyboard.press('Meta+Shift+KeyD')
  await expect(picker()).toBeVisible()
  await expect.poll(shape).toBe('row(s-nav col(s-perf split:picker))')
  await page.keyboard.press('Escape')
  await expect(picker()).toHaveCount(0)
  await expect.poll(shape).toBe('row(s-nav s-perf)')
  await expect(page.locator(`[data-region="terminal"] [data-session-id="s-perf"] .xterm-helper-textarea`)).toBeFocused()
})

test('the overview takes the whole terminal area; the split comes back after', async () => {
  await page.keyboard.press('Meta+Shift+KeyA')
  await expect(page.locator('[data-region="overview"]')).toBeVisible()
  await expect(area()).toBeHidden()
  await page.keyboard.press('Escape')
  await expect(area()).toBeVisible()
  await expect.poll(shape).toBe('row(s-nav s-perf)')
  await expect(terminalOf('s-nav')).toBeVisible()
})

test('closing a shown session closes its pane and the rest fill the area', async () => {
  await page.evaluate(() => (globalThis as unknown as { __trWorkspace: { getState(): { closeSession(id: string): void } } }).__trWorkspace.getState().closeSession('s-perf'))
  await expect.poll(() => workspace().then((s) => s.split)).toBeNull()
  await expect.poll(activeId).toBe('s-nav')
  const full = await area().boundingBox()
  const nav = await terminalOf('s-nav').boundingBox()
  // The one card keeps --card-gap (6) from the window's right edge; beside the sidebar it starts at the area's left.
  expect(Math.round(nav?.width ?? 0)).toBe(Math.round(full?.width ?? -1) - 6)
})
