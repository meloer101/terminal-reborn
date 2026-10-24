// README screenshots of the real app (scripts/readme-shots/run.sh): the e2e fixtures with demoData() on top, pointed at
// the demo repos from make-demo.sh, so the graph, diffs and merge sheet are real git. The hero runs a live Claude Code
// (your login, a few cents of usage) in default permission mode and waits for its first edit prompt.
import { test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, setWindowSize } from '../../e2e/launch'

const OUT = process.env.SHOTS_DIR ?? join(process.cwd(), 'test-results', 'readme-shots')
// The demo repos from make-demo.sh; run.sh sets both.
const DEMO = process.env.DEMO_DIR ?? ''

let app: ElectronApplication
let page: Page

const minutesAgo = (m: number) => Date.now() - m * 60_000

function demoData() {
  const wt = (p: string) => join(DEMO, 'worktrees', p)
  return {
    projects: [
      { id: 'p-acme', name: 'acme-web', rootPath: join(DEMO, 'acme-web') },
      { id: 'p-billing', name: 'billing-api', rootPath: join(DEMO, 'billing-api') }
    ],
    worktrees: [
      { id: 'w-cookie', projectId: 'p-acme', branch: 'jacob/session-cookie', path: wt('acme-web/session-cookie'), isMain: false, baseBranch: 'main', added: 42, removed: 18 },
      { id: 'w-perf', projectId: 'p-acme', branch: 'jacob/checkout-perf', path: wt('acme-web/checkout-perf'), isMain: false, baseBranch: 'main', added: 128, removed: 35 },
      { id: 'w-nav', projectId: 'p-acme', branch: 'jacob/mobile-nav-jitter', path: wt('acme-web/mobile-nav-jitter'), isMain: false, baseBranch: 'main', added: 23, removed: 9 },
      { id: 'w-search', projectId: 'p-acme', branch: 'jacob/search-ranking', path: wt('acme-web/search-ranking'), isMain: false, baseBranch: 'main', added: 61, removed: 4 },
      { id: 'w-i18n', projectId: 'p-acme', branch: 'jacob/i18n-copy', path: wt('acme-web/i18n-copy'), isMain: false, baseBranch: 'main', added: 14, removed: 3 },
      { id: 'w-acme-main', projectId: 'p-acme', branch: 'main', path: join(DEMO, 'acme-web'), isMain: true },
      { id: 'w-retries', projectId: 'p-billing', branch: 'jacob/webhook-retries', path: wt('billing-api/webhook-retries'), isMain: false, baseBranch: 'main', added: 19, removed: 2 },
      { id: 'w-billing-main', projectId: 'p-billing', branch: 'main', path: join(DEMO, 'billing-api'), isMain: true }
    ],
    sessions: [
      { id: 's-cookie', worktreeId: 'w-cookie', kind: 'claude', title: 'Session cookie migration', status: 'running', currentAction: '编辑 src/auth/session.js', startedAt: minutesAgo(4), lastActivityAt: Date.now() },
      { id: 's-perf', worktreeId: 'w-perf', kind: 'codex', title: 'Checkout first paint under 2s', status: 'running', currentAction: '运行 npm test', startedAt: minutesAgo(12), lastActivityAt: minutesAgo(1) },
      { id: 's-nav', worktreeId: 'w-nav', kind: 'claude', title: 'Fix mobile nav jitter', status: 'done_unread', currentAction: '已完成，等你审阅', lastReply: 'Menu now animates grid rows; no layout shift on open.', startedAt: minutesAgo(9), lastActivityAt: minutesAgo(2), finishedAt: minutesAgo(2) },
      { id: 's-graph', worktreeId: 'w-search', kind: 'claude', title: 'Rank search results', status: 'error', currentAction: 'npm run build 失败 · 2 个错误', startedAt: minutesAgo(18), lastActivityAt: minutesAgo(3) },
      { id: 's-sidebar', worktreeId: 'w-i18n', kind: 'codex', title: 'Extract nav copy for i18n', status: 'running', currentAction: '编辑 src/i18n/de.json', startedAt: minutesAgo(6), lastActivityAt: Date.now() },
      { id: 's-acme-main', worktreeId: 'w-retries', kind: 'claude', title: 'Webhook retries with backoff', status: 'running', currentAction: '运行 npm test', startedAt: minutesAgo(7), lastActivityAt: Date.now() }
    ],
    activeSessionId: 's-cookie'
  }
}

const update = (patch: unknown) =>
  page.evaluate((p) => (globalThis as unknown as { tr: { settings: { update(p: unknown): Promise<unknown> } } }).tr.settings.update(p), patch)
const setTheme = (theme: 'dark' | 'light') => update({ appearance: { theme } })

test.beforeAll(async () => {
  mkdirSync(OUT, { recursive: true })
  // Runs inside another Wavi + Claude Code: drop their markers so hooks reach this app, not the outer one.
  const outer = Object.keys(process.env).filter((k) => /^(TR_|CLAUDE|WAVI)/.test(k))
  // Main trusts project roots from the saved workspace; the page shows demoData() on top of the fixtures.
  const profile = mkdtempSync(join(tmpdir(), 'tr-readme-'))
  const data = demoData()
  writeFileSync(join(profile, 'workspace.json'), JSON.stringify({ version: 2, projects: data.projects, worktrees: data.worktrees, sessions: [], activeSessionId: null, sidebarCollapsed: false, drafts: {} }))
  app = await launchApp(Object.fromEntries(outer.map((k) => [k, undefined])), { userDataDir: profile })
  page = await app.firstWindow()
  await page.addInitScript(() => {
    ;(globalThis as unknown as { __TR_E2E__: boolean }).__TR_E2E__ = true
  })
  await page.reload()
  await page.waitForFunction(() => Boolean((globalThis as unknown as { __trStatus?: unknown }).__trStatus))
  await setWindowSize(app, page, 1440, 900)
  await page.evaluate((data) => {
    // Fixtures skip loading the saved workspace; load it once so main trusts the demo project roots.
    ;(globalThis as unknown as { tr: { workspace: { loadSync(): unknown } } }).tr.workspace.loadSync()
    ;(globalThis as unknown as { __trWorkspace: { setState(s: unknown): void } }).__trWorkspace.setState(data)
  }, demoData())
})

test.afterAll(async () => {
  await app?.close()
})

const screen = (id: string) =>
  page.evaluate((s) => (globalThis as unknown as { __trTerminals: { readScreen(id: string, n?: number): string } }).__trTerminals.readScreen(s, 60), id)

async function waitScreen(id: string, re: RegExp, ms: number): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (re.test(await screen(id))) return true
    await page.waitForTimeout(1000)
  }
  return false
}

/** Both themes; `around` crops to that element plus a margin (dialogs). */
const shoot = async (name: string, around?: string) => {
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(theme)
    await page.waitForTimeout(600)
    let clip: { x: number; y: number; width: number; height: number } | undefined
    if (around) {
      const box = await page.locator(around).first().boundingBox()
      if (box) {
        const pad = 56
        clip = { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + 2 * pad, height: box.height + 2 * pad }
      }
    }
    await page.screenshot({ path: join(OUT, `${name}-${theme}.png`), clip })
  }
}

const sidebarRow = (id: string) => page.locator(`[data-region="sidebar"] [data-session-id="${id}"]`).first()
const panel = () => page.locator('[data-region="panel"]')
const switcher = () => page.getByRole('group', { name: '右侧栏' })

async function openGit() {
  if ((await panel().count()) === 0) await switcher().getByRole('button', { name: 'Git' }).click()
  await panel().waitFor()
}

test.describe.configure({ mode: 'serial' })

test('overview', async () => {
  await setTheme('dark')
  await page.locator('[data-region="sidebar"]').getByRole('button', { name: /^总览/ }).click()
  await page.waitForTimeout(1200)
  await shoot('overview')
  await sidebarRow('s-nav').click()
})

test('review', async () => {
  await setTheme('dark')
  await sidebarRow('s-nav').click()
  const term = page.locator('[data-region="terminal"] [data-session-id="s-nav"] .xterm')
  await term.click()
  await page.keyboard.type(`cd '${join(DEMO, 'worktrees', 'acme-web', 'mobile-nav-jitter')}' && clear && git --no-pager log --oneline -3 && npm test`)
  await page.keyboard.press('Enter')
  await openGit()
  await panel().getByRole('tab', { name: /^变更/ }).click()
  const file = panel().locator('[data-path="src/styles/nav.css"][data-group="committed"] button').first()
  await file.waitFor()
  if ((await file.getAttribute('aria-expanded')) !== 'true') await file.click()
  const line = (n: number) => panel().locator(`[data-owner="committed:src/styles/nav.css"][data-line="${n}"]`)
  await line(4).waitFor()
  await line(4).hover()
  await line(4).getByRole('button', { name: '评论第 4 行' }).click()
  await page.keyboard.type('Respect prefers-reduced-motion here: skip the transition when the user asks for less motion.')
  await page.keyboard.press('Meta+Enter')
  await page.waitForTimeout(800)
  await shoot('review')
})

test('merge', async () => {
  await setTheme('dark')
  await panel().getByRole('button', { name: /^合并到 main/ }).click()
  await page.waitForTimeout(3000)
  await shoot('merge', '[role="dialog"]')
  await page.keyboard.press('Escape')
})

test('new-session', async () => {
  await setTheme('dark')
  await page.locator('[data-region="terminal"]').first().click()
  await page.keyboard.press('Meta+n')
  const sheet = page.getByRole('dialog')
  await sheet.getByRole('radio', { name: '多个' }).click()
  await page.waitForTimeout(600)
  await page.keyboard.type('Get checkout first paint under 2s on a mid-range phone. Keep the cart behaviour unchanged.')
  await page.waitForTimeout(600)
  await shoot('new-session', '[role="dialog"]')
  await page.keyboard.press('Escape')
})

test('hero', async () => {
  test.setTimeout(300_000)
  await setTheme('dark')
  await sidebarRow('s-cookie').click()
  const term = page.locator('[data-region="terminal"] [data-session-id="s-cookie"] .xterm')
  await term.click()
  const cwd = join(DEMO, 'worktrees', 'acme-web', 'session-cookie')
  const prompt =
    'Move the session token out of localStorage into the HttpOnly cookie from src/auth/cookie.js: update src/auth/session.js and test/session.test.js, then run npm test.'
  await page.keyboard.type(`cd '${cwd}' && clear && claude --permission-mode default "${prompt}"`)
  await page.keyboard.press('Enter')
  // First run in a new folder: trust it.
  if (await waitScreen('s-cookie', /Yes, I trust/i, 20_000)) {
    await page.waitForTimeout(800)
    await page.keyboard.press('ArrowDown')
    await page.waitForTimeout(300)
    await page.keyboard.press('Enter')
  }
  console.log('permission prompt:', await waitScreen('s-cookie', /Do you want to/, 200_000))
  await page.waitForTimeout(2000)
  await openGit()
  await panel().getByRole('tab', { name: '图谱' }).click()
  await page.waitForTimeout(2000)
  await shoot('hero')
  console.log(await screen('s-cookie'))
})
