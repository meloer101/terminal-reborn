// PRD F6 target: the Git · 图谱 first screen of a 5000-commit repo in < 300 ms. The fixture is built with
// `git fast-import` (200 feature branches, each merged back with --no-ff, a few left open) and has no commit-graph
// file, so `git log --topo-order` has to walk the whole history: the realistic slow case. The measured times are
// printed and written to test-results/git-panel/perf.json.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './launch'

const RESULTS = join(process.cwd(), 'test-results', 'git-panel')
const BRANCHES = 200
const PER_BRANCH = 12
/** Each block: PER_BRANCH feature commits, PER_BRANCH main commits, one merge. */
const COMMITS = 1 + BRANCHES * (PER_BRANCH * 2 + 1)
const TARGET_MS = 300

function makeBigRepo(): string {
  const project = join(realpathSync(mkdtempSync(join(tmpdir(), 'tr-e2e-git-perf-'))), 'big')
  mkdirSync(project)
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: project })
  const out: string[] = []
  let mark = 0
  let time = 1_700_000_000
  const commit = (ref: string, message: string, from: number | null, merge?: number) => {
    mark++
    time += 60
    out.push(`commit ${ref}`, `mark :${mark}`, `committer e2e <e2e@example.com> ${time} +0000`, `data ${Buffer.byteLength(message)}`, message)
    if (from !== null) out.push(`from :${from}`)
    if (merge !== undefined) out.push(`merge :${merge}`)
    out.push(`M 644 inline file.txt`, `data ${String(mark).length + 1}`, `${mark}`, '')
    return mark
  }
  let main = commit('refs/heads/main', 'Initial commit', null)
  for (let b = 0; b < BRANCHES; b++) {
    let feature = main
    for (let i = 0; i < PER_BRANCH; i++) feature = commit(`refs/heads/feature-${b}`, `Feature ${b} step ${i}`, feature)
    for (let i = 0; i < PER_BRANCH; i++) main = commit('refs/heads/main', `Main work ${b}.${i}`, main)
    // The last few branches stay open; the rest are merged back.
    if (b < BRANCHES - 4) main = commit('refs/heads/main', `Merge branch 'feature-${b}'`, main, feature)
    else main = commit('refs/heads/main', `More main work ${b}`, main)
  }
  execFileSync('git', ['fast-import', '--quiet'], { cwd: project, input: `${out.join('\n')}\n` })
  execFileSync('git', ['reset', '-q', '--hard', 'main'], { cwd: project })
  return project
}

test.setTimeout(120_000)

test.describe('F6 graph performance', () => {
  const profile = mkdtempSync(join(tmpdir(), 'tr-e2e-git-perf-profile-'))
  const project = makeBigRepo()
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async () => {
    writeFileSync(
      join(profile, 'workspace.json'),
      JSON.stringify({
        version: 2,
        projects: [{ id: 'p1', name: 'big', rootPath: project }],
        worktrees: [{ id: 'w1', projectId: 'p1', branch: 'main', path: project, isMain: true }],
        sessions: [{ id: 's1', worktreeId: 'w1', kind: 'shell', title: '大仓库', startedAt: 1, lastActivityAt: 1 }],
        activeSessionId: 's1',
        sidebarCollapsed: false,
        rightPanel: null,
        drafts: {}
      })
    )
    app = await launchApp({}, { userDataDir: profile })
    page = await app.firstWindow()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 900))
    await expect(page.locator('[data-region="terminal"] .xterm').first()).toBeVisible({ timeout: 20_000 })
  })

  test.afterAll(async () => {
    await app?.close().catch(() => {})
  })

  test(`first screen of a ${COMMITS}-commit repo`, async () => {
    const count = Number(execFileSync('git', ['rev-list', '--all', '--count'], { cwd: project }).toString())
    expect(count).toBe(COMMITS)
    /** Clicks the Git icon and resolves with the ms until the first commit row is in the DOM (timed in the page). */
    const openGit = () =>
      page.evaluate(
        () =>
          new Promise<number>((resolve) => {
            const button = document.querySelector<HTMLButtonElement>('header [role="group"][aria-label="右侧栏"] button[aria-label="Git"]')!
            const found = () => document.querySelector('[data-region="panel"] [role="list"][aria-label="提交"] [role="listitem"]')
            const started = performance.now()
            const observer = new MutationObserver(() => {
              if (!found()) return
              observer.disconnect()
              resolve(performance.now() - started)
            })
            observer.observe(document.body, { childList: true, subtree: true })
            button.click()
          })
      )
    const times: number[] = []
    for (let run = 0; run < 3; run++) {
      // Each run opens the Git view from a fresh page, so git is read again.
      times.push(await openGit())
      // Close it (the open view is remembered across reloads), then reload. Use the panel's own close button: on a
      // narrow screen (CI's is 1024 wide) the panel floats over the header and covers the Git icon.
      await page.locator('[data-region="panel"]').getByRole('button', { name: '关闭右侧栏' }).click()
      await expect(page.locator('[data-region="panel"]')).toHaveCount(0)
      await page.reload()
      await expect(page.locator('[data-region="terminal"] .xterm').first()).toBeVisible({ timeout: 20_000 })
      // Let the reloaded page finish restoring (terminal attach, workspace save) before the next timed click.
      await page.waitForTimeout(1000)
      await expect(page.locator('header').getByRole('group', { name: '右侧栏' }).getByRole('button', { name: 'Git' })).toHaveAttribute('aria-pressed', 'false')
    }
    // Scrolling to the end pages through the whole history (timed in the page, scrolling every frame).
    await openGit()
    const pagingMs = await page.evaluate(
      () =>
        new Promise<number>((resolve, reject) => {
          const list = document.querySelector<HTMLElement>('[data-region="panel"] [role="list"][aria-label="提交"]')!
          const started = performance.now()
          const step = () => {
            list.scrollTop = list.scrollHeight
            const last = [...list.querySelectorAll('[role="listitem"]')].some((row) => row.textContent?.includes('Initial commit'))
            if (last) resolve(performance.now() - started)
            else if (performance.now() - started > 60_000) reject(new Error('paging timed out'))
            else requestAnimationFrame(step)
          }
          step()
        })
    )
    const best = Math.min(...times)
    const result = { commits: COMMITS, firstScreenMs: times.map(Math.round), bestMs: Math.round(best), targetMs: TARGET_MS, pageThroughMs: Math.round(pagingMs) }
    mkdirSync(RESULTS, { recursive: true })
    writeFileSync(join(RESULTS, 'perf.json'), JSON.stringify(result, null, 2))
    console.log('git graph perf', result)
    expect(best, `first screen ${times.map(Math.round).join(' / ')} ms (target ${TARGET_MS} ms)`).toBeLessThan(TARGET_MS)
  })
})
