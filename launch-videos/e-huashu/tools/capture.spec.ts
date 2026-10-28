// Captures for the launch film: the real app over the demo repos (same fixtures as scripts/readme-shots/app.spec.ts),
// in the states the film needs: a four-pane split with live output, and the appearance settings in several themes.
import { test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, setWindowSize } from '../../../e2e/launch'

const OUT = process.env.SHOTS_DIR ?? join(process.cwd(), 'test-results', 'launch-shots')
const DEMO = process.env.DEMO_DIR ?? ''
let app: ElectronApplication
let page: Page
const minutesAgo = (m: number) => Date.now() - m * 60_000
const wt = (p: string) => join(DEMO, 'worktrees', p)

function demoData() {
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

const pane = (id: string) => ({ type: 'pane', id })
const SPLIT = {
  type: 'split',
  dir: 'row',
  sizes: [0.5, 0.5],
  children: [
    { type: 'split', dir: 'column', sizes: [0.5, 0.5], children: [pane('s-cookie'), pane('s-nav')] },
    { type: 'split', dir: 'column', sizes: [0.5, 0.5], children: [pane('s-perf'), pane('s-sidebar')] }
  ]
}

const update = (patch: unknown) =>
  page.evaluate((p) => (globalThis as unknown as { tr: { settings: { update(p: unknown): Promise<unknown> } } }).tr.settings.update(p), patch)

// Imported-theme palettes (the "导入主题" feature): Dracula and Nord, both MIT.
const DRACULA = {
  foreground: '#f8f8f2', cursor: '#f8f8f2', selection: '#44475a',
  ansi: ['#21222c', '#ff5555', '#50fa7b', '#f1fa8c', '#bd93f9', '#ff79c6', '#8be9fd', '#f8f8f2', '#6272a4', '#ff6e6e', '#69ff94', '#ffffa5', '#d6acff', '#ff92df', '#a4ffff', '#ffffff']
}
const NORD = {
  foreground: '#d8dee9', cursor: '#d8dee9', selection: '#434c5e',
  ansi: ['#3b4252', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#88c0d0', '#e5e9f0', '#4c566a', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#8fbcbb', '#eceff4']
}

test.beforeAll(async () => {
  mkdirSync(OUT, { recursive: true })
  const outer = Object.keys(process.env).filter((k) => /^(TR_|CLAUDE|WAVI)/.test(k))
  const profile = mkdtempSync(join(tmpdir(), 'tr-launch-'))
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
  await page.evaluate((d) => {
    ;(globalThis as unknown as { tr: { workspace: { loadSync(): unknown } } }).tr.workspace.loadSync()
    ;(globalThis as unknown as { __trWorkspace: { setState(s: unknown): void } }).__trWorkspace.setState(d)
  }, { ...demoData(), split: SPLIT })
})

test.afterAll(async () => {
  await app?.close()
})

async function run(id: string, command: string) {
  const term = page.locator(`[data-region="terminal"] [data-session-id="${id}"] .xterm`)
  await term.click()
  await page.keyboard.type(command)
  await page.keyboard.press('Enter')
}

test.describe.configure({ mode: 'serial' })

test('split with live output', async () => {
  await update({ appearance: { theme: 'dark' } })
  await page.waitForTimeout(800)
  const color = 'git -c color.ui=always --no-pager'
  await run('s-cookie', `cd '${wt('acme-web/session-cookie')}' && clear && ${color} log --graph --oneline --all -14`)
  await run('s-nav', `cd '${wt('acme-web/mobile-nav-jitter')}' && clear && ${color} log --oneline -3 && npm test`)
  await run('s-perf', `cd '${wt('acme-web/checkout-perf')}' && clear && ${color} diff --stat main && ${color} diff main -- src | head -30`)
  await run('s-sidebar', `cd '${wt('acme-web/i18n-copy')}' && clear && ${color} log --oneline -3 && npm test`)
  await page.waitForTimeout(3500)
  await page.screenshot({ path: join(OUT, 'split-dark.png') })
})

test('split in light and imported themes', async () => {
  await update({ appearance: { theme: 'light' } })
  await page.waitForTimeout(800)
  await page.screenshot({ path: join(OUT, 'split-light.png') })
  for (const [name, colors, bg] of [['dracula', DRACULA, '#282a36'], ['nord', NORD, '#2e3440']] as const) {
    await update({ appearance: { theme: 'dark', terminalColors: colors, terminalBackground: { mode: 'custom', color: bg } } })
    await page.waitForTimeout(1000)
    await page.screenshot({ path: join(OUT, `split-${name}.png`) })
  }
  await update({ appearance: { theme: 'dark', terminalColors: null, terminalBackground: { mode: 'theme', color: '#0a0a0a' } } })
})

test('appearance settings', async () => {
  await update({ appearance: { theme: 'dark', terminalColors: null, terminalBackground: { mode: 'theme', color: '#0a0a0a' } } })
  await page.waitForTimeout(800)
  await page.locator('[data-region="sidebar"]').getByRole('button', { name: /^设置/ }).click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  await dialog.getByText('外观', { exact: true }).first().click()
  await page.waitForTimeout(800)
  await page.screenshot({ path: join(OUT, 'settings-appearance-dark.png') })
  await update({ appearance: { theme: 'light' } })
  await page.waitForTimeout(800)
  await page.screenshot({ path: join(OUT, 'settings-appearance-light.png') })
  await page.keyboard.press('Escape')
})

test('agents and automation settings', async () => {
  await update({ appearance: { theme: 'dark', terminalColors: null, terminalBackground: { mode: 'theme', color: '#0a0a0a' } } })
  await page.locator('[data-region="sidebar"]').getByRole('button', { name: /^设置/ }).click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  for (const [label, file] of [['智能体', 'settings-agents'], ['自动化', 'settings-automation']] as const) {
    await dialog.getByText(label, { exact: true }).first().click()
    await page.waitForTimeout(900)
    await page.screenshot({ path: join(OUT, `${file}-dark.png`) })
  }
  await page.keyboard.press('Escape')
})
