// F5 并排 diff in Git · 变更 on a real repository (PRD F5, Figma 17F / 17G / 17H). A worktree commit replaces two lines
// with six: 并排 pairs them base-left / new-right with fillers, comments go on the new side, a narrow panel turns 并排
// off (and says why) and widening it brings the choice back. Screenshots in both themes go to test-results/diff-split/.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fakeClaude } from './fake-claude'
import { launchApp, setWindowSize } from './launch'

const SHOTS = join(process.cwd(), 'test-results', 'diff-split')

const BEFORE = [
  'export function MobileNav() {',
  '  const ref = useRef<HTMLElement>(null)',
  '  const [offset, setOffset] = useState(0)',
  '',
  '  useEffect(() => {',
  '    const onScroll = () => setOffset(scrollY)',
  "    addEventListener('scroll', onScroll, { passive: true })",
  "    return () => removeEventListener('scroll', onScroll)",
  '  }, [])',
  '}',
  ''
].join('\n')

const AFTER = [
  'export function MobileNav() {',
  '  const ref = useRef<HTMLElement>(null)',
  '  const [hidden, setHidden] = useState(false)',
  '',
  '  useEffect(() => {',
  '    const max = document.body.scrollHeight - innerHeight',
  '    const onScroll = () => {',
  '      const y = Math.min(Math.max(scrollY, 0), max)',
  '      setHidden(y > lastY.current); lastY.current = y',
  '    }',
  "    addEventListener('scroll', onScroll, { passive: true })",
  "    return () => removeEventListener('scroll', onScroll)",
  '  }, [])',
  '}',
  ''
].join('\n')

function setup() {
  const fake = fakeClaude('tr-e2e-split-')
  const project = join(fake.root, 'demo')
  const linked = join(fake.root, 'wt-nav')
  mkdirSync(project)
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.email=e2e@example.com', '-c', 'user.name=e2e', '-c', 'commit.gpgsign=false', ...args], { cwd }).toString()
  writeFileSync(join(project, 'MobileNav.tsx'), BEFORE)
  git(project, 'init', '-q', '-b', 'main')
  git(project, 'add', '.')
  git(project, 'commit', '-q', '-m', 'init')
  git(project, 'worktree', 'add', '-q', '-b', 'jacob/mobile-nav-jitter', linked)
  git(project, 'config', 'branch.jacob/mobile-nav-jitter.base', 'main')
  writeFileSync(join(linked, 'MobileNav.tsx'), AFTER)
  git(linked, 'add', '.')
  git(linked, 'commit', '-q', '-m', 'Clamp scrollY')
  return { ...fake, project, linked }
}

test.describe.configure({ mode: 'serial' })
test.setTimeout(90_000)

test.describe('F5 并排 diff', () => {
  const profile = mkdtempSync(join(tmpdir(), 'tr-e2e-split-profile-'))
  const repo = setup()
  let app: ElectronApplication
  let page: Page

  const panel = () => page.locator('[data-region="panel"]')
  const owner = '[data-owner="committed:MobileNav.tsx"]'
  const rows = () => panel().locator(`${owner}[data-line]`)
  const layout = () => panel().getByRole('radiogroup', { name: 'diff 布局' })
  const files = () => panel().getByRole('list', { name: '改动的文件' })
  const setTheme = async (theme: 'dark' | 'light') => {
    await page.evaluate(
      (t) => (globalThis as unknown as { tr: { settings: { update(p: unknown): Promise<unknown> } } }).tr.settings.update({ appearance: { theme: t } }),
      theme
    )
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme)
  }
  const shoot = async (name: string) => {
    mkdirSync(SHOTS, { recursive: true })
    for (const theme of ['dark', 'light'] as const) {
      await setTheme(theme)
      await page.waitForTimeout(200)
      await page.screenshot({ path: join(SHOTS, `${name}-${theme}.png`) }).catch(() => undefined)
    }
    await setTheme('dark')
  }
  const dragPanelTo = async (width: number) => {
    const handle = panel().getByRole('separator', { name: '调整右侧栏宽度' })
    const box = (await handle.boundingBox())!
    const current = await panel().evaluate((el) => el.getBoundingClientRect().width)
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x - (width - current), y, { steps: 8 })
    await page.mouse.up()
  }

  test.beforeAll(async () => {
    writeFileSync(
      join(profile, 'workspace.json'),
      JSON.stringify({
        version: 2,
        projects: [{ id: 'p1', name: 'acme-web', rootPath: repo.project }],
        worktrees: [
          { id: 'w-main', projectId: 'p1', branch: 'main', path: repo.project, isMain: true },
          { id: 'w-nav', projectId: 'p1', branch: 'jacob/mobile-nav-jitter', path: repo.linked, isMain: false, baseBranch: 'main' }
        ],
        sessions: [{ id: 's-nav', worktreeId: 'w-nav', kind: 'claude', title: '修复移动端导航抖动', startedAt: 1, lastActivityAt: 1 }],
        activeSessionId: 's-nav',
        sidebarCollapsed: true,
        rightPanel: 'git',
        rightPanelWidth: 870,
        drafts: {}
      })
    )
    app = await launchApp(repo.env, { userDataDir: profile })
    page = await app.firstWindow()
    await setWindowSize(app, page, 1440, 900)
    await expect(page.locator('[data-region="terminal"] .xterm').first()).toBeVisible({ timeout: 20_000 })
    await panel().getByRole('tab', { name: /^变更/ }).click()
    const file = panel().locator('[data-path="MobileNav.tsx"][data-group="committed"] button')
    if ((await file.getAttribute('aria-expanded')) !== 'true') await file.click()
    await expect(rows().first()).toBeVisible()
  })

  test.afterAll(async () => {
    await app?.close().catch(() => {})
  })

  test('并排 pairs base and new lines, filling the side without a counterpart', async () => {
    await expect(layout().getByRole('radio', { name: '统一' })).toBeChecked()
    await expect(files()).toHaveAttribute('data-layout', 'unified')
    await layout().getByRole('radio', { name: '并排' }).click()
    await expect(files()).toHaveAttribute('data-layout', 'split')

    // Line 3 changed in place: removed on the left, added on the right of the same row.
    const changed = panel().locator(`${owner}[data-line="3"]`)
    await expect(changed.locator('[data-side="old"]')).toHaveAttribute('data-kind', 'del')
    await expect(changed.locator('[data-side="old"]')).toContainText('setOffset')
    await expect(changed.locator('[data-side="new"]')).toHaveAttribute('data-kind', 'add')
    await expect(changed.locator('[data-side="new"]')).toContainText('setHidden')
    // Two removed lines became six added ones: the last added lines have an empty base side.
    const extra = panel().locator(`${owner}[data-line="9"]`)
    await expect(extra.locator('[data-side="old"]')).toHaveAttribute('data-kind', 'empty')
    await expect(extra.locator('[data-side="new"]')).toHaveAttribute('data-kind', 'add')
    // Context lines are on both sides with their own numbers.
    const context = panel().locator(`${owner}[data-line="11"]`)
    await expect(context.locator('[data-side="old"]')).toHaveAttribute('data-line', '7')
    await expect(context.locator('[data-side="new"]')).toHaveAttribute('data-line', '11')
  })

  test('comments attach to the new side and sit on the right half', async () => {
    const line = panel().locator(`${owner}[data-line="6"]`)
    await line.hover()
    await expect(line.getByRole('button', { name: /^评论第/ })).toHaveCount(1)
    await line.getByRole('button', { name: '评论第 6 行' }).click()
    await page.keyboard.type('窗口尺寸变化后 max 不会更新，改用 ResizeObserver 计算')
    await page.keyboard.press('Meta+Enter')
    const note = panel().getByRole('note')
    await expect(note).toHaveCount(1)
    await expect(note).toHaveAttribute('data-split', 'true')
    const [noteBox, filesBox] = await Promise.all([note.boundingBox(), files().boundingBox()])
    expect(noteBox!.x).toBeGreaterThan(filesBox!.x + filesBox!.width / 2 - 2)
    await panel().locator(`${owner}[data-line="8"]`).hover()
    await shoot('17F-split')
  })

  test('a narrow panel turns 并排 off and says why; widening brings it back', async () => {
    await panel().getByRole('separator', { name: '调整右侧栏宽度' }).dblclick()
    await expect.poll(() => panel().evaluate((el) => Math.round(el.getBoundingClientRect().width))).toBeLessThan(720)
    await expect(files()).toHaveAttribute('data-layout', 'unified')
    await expect(layout().getByRole('radio', { name: '并排' })).toBeDisabled()
    await expect(layout().getByRole('radio', { name: '统一' })).toBeChecked()
    await layout().hover()
    await expect(page.getByTestId('diff-layout-hint')).toHaveAttribute('data-shown', 'true')
    await expect(page.getByTestId('diff-layout-hint')).toHaveText('右侧栏宽 720 以上才能并排')
    await shoot('17H-narrow')

    await dragPanelTo(880)
    await expect(files()).toHaveAttribute('data-layout', 'split')
    await expect(layout().getByRole('radio', { name: '并排' })).toBeChecked()
  })

  test('the choice survives a reload', async () => {
    await page.waitForTimeout(600)
    await page.reload()
    await expect(page.locator('[data-region="terminal"] .xterm').first()).toBeVisible({ timeout: 20_000 })
    await panel().getByRole('tab', { name: /^变更/ }).click()
    await expect(layout().getByRole('radio', { name: '并排' })).toBeChecked()
  })
})
