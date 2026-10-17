import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp } from './launch'

// Lifecycle: closing hides instead of killing, quitting and closing ask before destroying agents,
// and a dead pty-host is restarted with a card that respawns the lost sessions.
// Confirmation dialogs are recorded in main (TR_E2E_DIALOGS, set by launchApp), not shown.

interface TerminalsHook {
  readScreen(sessionId: string, scrollbackLines?: number): string
}
interface WorkspaceHook {
  getState(): { activeSessionId: string | null; sessions: { id: string; status: string }[] }
}
interface DialogHook {
  requests: { message: string; confirmLabel: string; destructive?: boolean }[]
  answer: boolean
  activity(): { active: number }
}

const COOKIE = 's-cookie'
const PERF = 's-perf'

let app: ElectronApplication
let page: Page

const pane = (id: string) => page.locator(`[data-region="terminal"] [data-session-id="${id}"]`)
const screen = (id: string, scrollback = 0) =>
  page.evaluate(([sid, n]) => (globalThis as unknown as { __trTerminals: TerminalsHook }).__trTerminals.readScreen(sid as string, n as number), [id, scrollback])
const sessionIds = () =>
  page.evaluate(() => (globalThis as unknown as { __trWorkspace: WorkspaceHook }).__trWorkspace.getState().sessions.map((s) => s.id))
const activeId = () =>
  page.evaluate(() => (globalThis as unknown as { __trWorkspace: WorkspaceHook }).__trWorkspace.getState().activeSessionId)
const dialogRequests = () =>
  app.evaluate(() => (globalThis as unknown as { __trDialogs: DialogHook }).__trDialogs.requests)
const setDialogAnswer = (answer: boolean) =>
  app.evaluate((_electron, value) => {
    ;(globalThis as unknown as { __trDialogs: DialogHook }).__trDialogs.answer = value
  }, answer)
const reportedActive = () =>
  app.evaluate(() => (globalThis as unknown as { __trDialogs: DialogHook }).__trDialogs.activity().active)
const isVisible = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false)

async function run(id: string, command: string): Promise<void> {
  await pane(id).click()
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
  await expect(pane(COOKIE)).toBeVisible()
  await expect.poll(() => screen(COOKIE), { timeout: 20_000 }).not.toBe('')
})

test.afterAll(async () => {
  await app.close()
})

test('closing the window hides it; the terminals keep running and come back on activate', async () => {
  await run(COOKIE, 'echo pid-$$')
  await expect.poll(() => screen(COOKIE), { timeout: 10_000 }).toMatch(/^pid-\d+$/m)
  const pid = /^pid-(\d+)$/m.exec(await screen(COOKIE))?.[1]

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
  await expect.poll(isVisible).toBe(false)
  // Hidden, not destroyed.
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)

  await app.evaluate(({ app: electronApp }) => electronApp.emit('activate'))
  await expect.poll(isVisible).toBe(true)
  await expect(pane(COOKIE)).toBeVisible()

  // The very same shell process answers.
  await run(COOKIE, 'clear; echo again-$$')
  await expect.poll(() => screen(COOKIE), { timeout: 10_000 }).toContain(`again-${pid}`)
})

test('the renderer reports running + waiting sessions to main', async () => {
  const expected = await page.evaluate(
    () =>
      (globalThis as unknown as { __trWorkspace: WorkspaceHook }).__trWorkspace
        .getState()
        .sessions.filter((s) => s.status === 'running' || s.status === 'needs_you').length
  )
  expect(expected).toBeGreaterThan(0)
  await expect.poll(reportedActive).toBe(expected)
})

test('⌘W on a running session asks first; cancelling keeps it, confirming closes it', async () => {
  expect(await activeId()).toBe(COOKIE)
  await setDialogAnswer(false)
  await pane(COOKIE).click()
  await page.keyboard.press('Meta+w')
  await expect.poll(async () => (await dialogRequests()).length).toBe(1)
  const [request] = await dialogRequests()
  expect(request?.message).toContain('Cookie 会话迁移')
  expect(request?.confirmLabel).toBe('关闭会话')
  expect(request?.destructive).toBe(true)
  expect(await sessionIds()).toContain(COOKIE)

  await setDialogAnswer(true)
  await page.keyboard.press('Meta+w')
  await expect.poll(sessionIds).not.toContain(COOKIE)
  expect((await dialogRequests()).length).toBe(2)
})

test('⌘W on a finished session closes it without asking', async () => {
  await page.locator('[data-region="sidebar"] [data-session-id="s-acme-main"]').click()
  expect(await activeId()).toBe('s-acme-main')
  const before = (await dialogRequests()).length
  await page.keyboard.press('Meta+w')
  await expect.poll(sessionIds).not.toContain('s-acme-main')
  expect((await dialogRequests()).length).toBe(before)
})

test('quitting with running sessions asks first and stays open when cancelled', async () => {
  const before = (await dialogRequests()).length
  const active = await reportedActive()
  expect(active).toBeGreaterThan(0)
  await setDialogAnswer(false)
  await app.evaluate(({ app: electronApp }) => electronApp.quit())
  await expect.poll(async () => (await dialogRequests()).length).toBe(before + 1)
  const request = (await dialogRequests())[before]
  expect(request?.message).toBe(`有 ${active} 个会话正在运行或等你处理，退出会中断它们。`)
  expect(request?.confirmLabel).toBe('退出')
  // Still running, window intact.
  await expect(page.locator('[data-region="main"]')).toBeVisible()
  expect(await isVisible()).toBe(true)
  await setDialogAnswer(true)
})

test('a dead pty daemon is restarted; the card recovers the lost sessions', async () => {
  // Make sure the active session has a live terminal.
  const id = (await activeId()) ?? PERF
  await expect.poll(() => screen(id), { timeout: 20_000 }).not.toBe('')

  const userData = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))
  const hostPid = (): number | null => {
    try {
      return (JSON.parse(readFileSync(join(userData, 'daemon', 'daemon.json'), 'utf8')) as { pid: number }).pid
    } catch {
      return null
    }
  }
  const oldPid = hostPid()
  expect(oldPid).not.toBeNull()
  process.kill(oldPid as number, 'SIGKILL')

  const card = page.getByTestId('engine-restarted')
  await expect(card).toBeVisible()
  await expect(card).toContainText('终端进程意外退出，已自动重启')
  await expect(card).toContainText('个会话需要恢复')
  await page.screenshot({ path: 'test-results/lifecycle-engine-restarted.png' })

  // Main brought a new host up.
  await expect.poll(() => {
    const pid = hostPid()
    return pid !== null && pid !== oldPid
  }).toBe(true)

  await card.getByRole('button', { name: '全部恢复' }).click()
  await expect(card).toBeHidden()
  await run(id, 'clear; echo recovered-$((20+2))')
  await expect.poll(() => screen(id), { timeout: 20_000 }).toMatch(/^recovered-22$/m)
})
