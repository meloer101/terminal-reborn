// The main-area split survives a restart (PRD F20): layout, sessions and sizes are saved in workspace.json and come
// back on the next launch, each pane with its session's terminal. Seeded on disk like persistence.spec.ts (the
// fixture flag would switch persistence off); plain shells with an empty zsh profile, so no rc file slows them down.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, setWindowSize } from './launch'

interface SplitNode {
  type: 'pane' | 'split'
  id?: string
  dir?: 'row' | 'column'
  children?: SplitNode[]
  sizes?: number[]
}

const draw = (node: SplitNode | undefined | null): string =>
  !node ? '∅' : node.type === 'pane' ? (node.id ?? '') : `${node.dir === 'row' ? 'row' : 'col'}(${(node.children ?? []).map(draw).join(' ')})`

test.describe.configure({ mode: 'serial' })
test.setTimeout(90_000)

test.describe('split persistence', () => {
  const profile = mkdtempSync(join(tmpdir(), 'tr-e2e-split-'))
  const project = mkdtempSync(join(tmpdir(), 'tr-e2e-split-project-'))
  const zdot = mkdtempSync(join(tmpdir(), 'tr-e2e-split-zdot-'))
  const workspaceFile = join(profile, 'workspace.json')
  const env = { ZDOTDIR: zdot, SHELL: '/bin/zsh' }
  let app: ElectronApplication
  let page: Page

  const terminalOf = (id: string) => page.locator(`[data-region="terminal"] [data-session-id="${id}"]`)
  const headerOf = (id: string) => page.locator(`[data-region="split"] [data-pane-id="${id}"]`)
  const saved = (): { split?: SplitNode; activeSessionId: string | null } => JSON.parse(readFileSync(workspaceFile, 'utf8')) as { split?: SplitNode; activeSessionId: string | null }

  const launch = async () => {
    app = await launchApp(env, { userDataDir: profile })
    page = await app.firstWindow()
    await setWindowSize(app, page, 1440, 900)
    await expect(page.locator('[data-region="sidebar"]')).toBeVisible()
  }

  test.beforeAll(() => {
    mkdirSync(profile, { recursive: true })
    writeFileSync(join(zdot, '.zshrc'), 'PS1="$ "\n')
    const session = (id: string, title: string) => ({ id, worktreeId: 'w1', kind: 'shell', title, startedAt: 1, lastActivityAt: 1 })
    writeFileSync(
      workspaceFile,
      JSON.stringify({
        version: 2,
        projects: [{ id: 'p1', name: 'split-proj', rootPath: project }],
        worktrees: [{ id: 'w1', projectId: 'p1', branch: '', path: project, isMain: true }],
        sessions: [session('s-a', 'Pane A'), session('s-b', 'Pane B'), session('s-c', 'Pane C')],
        activeSessionId: 's-b',
        sidebarCollapsed: false,
        rightPanel: null,
        collapsedProjectIds: [],
        drafts: {},
        split: {
          type: 'split',
          dir: 'row',
          sizes: [0.6, 0.4],
          children: [
            { type: 'pane', id: 's-a' },
            { type: 'split', dir: 'column', sizes: [0.5, 0.5], children: [{ type: 'pane', id: 's-b' }, { type: 'pane', id: 's-c' }] }
          ]
        }
      })
    )
  })

  test.afterAll(async () => {
    await app?.close()
  })

  test('a saved split comes back with every pane and its size', async () => {
    await launch()
    for (const id of ['s-a', 's-b', 's-c']) await expect(terminalOf(id)).toBeVisible({ timeout: 20_000 })
    // 60 / 40 across the area.
    const a = await headerOf('s-a').boundingBox()
    const b = await headerOf('s-b').boundingBox()
    if (!a || !b) throw new Error('no panes')
    expect(a.width / (a.width + b.width)).toBeCloseTo(0.6, 1)
    // The keyboard is where it was.
    await expect(headerOf('s-b')).toHaveAttribute('data-focused', 'true')
    await expect(page.locator(`[data-region="terminal"] [data-session-id="s-b"] .xterm-helper-textarea`)).toBeFocused({ timeout: 10_000 })
  })

  test('a changed split is saved and restored after a restart', async () => {
    // Close C's pane, then move B to the left of A by its title.
    await headerOf('s-c').getByRole('button', { name: '关掉这一格' }).click()
    const title = await headerOf('s-b').locator('h1').boundingBox()
    const target = await headerOf('s-a').boundingBox()
    const terminal = await terminalOf('s-a').boundingBox()
    if (!title || !target || !terminal) throw new Error('no panes')
    await page.mouse.move(title.x + 8, title.y + title.height / 2)
    await page.mouse.down()
    await page.mouse.move(target.x + 24, terminal.y + terminal.height / 2, { steps: 8 })
    await page.mouse.up()
    await expect.poll(() => draw(saved().split), { timeout: 5_000 }).toBe('row(s-b s-a)')
    await app.close()

    await launch()
    await expect(terminalOf('s-b')).toBeVisible({ timeout: 20_000 })
    await expect(terminalOf('s-a')).toBeVisible()
    await expect(terminalOf('s-c')).toBeHidden()
    const b = await headerOf('s-b').boundingBox()
    const a = await headerOf('s-a').boundingBox()
    expect((b?.x ?? 1) < (a?.x ?? 0)).toBe(true)
    await page.screenshot({ path: 'test-results/split/restored.png' })
  })

  test('closing panes down to one ends the split, and that is saved too', async () => {
    await headerOf('s-a').getByRole('button', { name: '关掉这一格' }).click()
    await expect(terminalOf('s-a')).toBeHidden()
    await expect(terminalOf('s-b')).toBeVisible()
    await expect.poll(() => saved().split, { timeout: 5_000 }).toBeUndefined()
    expect(saved().activeSessionId).toBe('s-b')
  })
})
