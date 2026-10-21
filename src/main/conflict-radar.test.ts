// Conflict radar against real git repositories in a temp folder: pairwise and base conflicts, uncommitted work
// (without touching the worktree's index), the merge cache, and what a merge into main does to the others.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { RadarReport } from '@shared/conflict-radar'

const base = realpathSync(mkdtempSync(join(tmpdir(), 'tr-radar-')))
const roots = new Set<string>()
vi.mock('./workspace-store', () => ({ isProjectRoot: (path: string) => roots.has(path) }))
vi.mock('electron', () => ({ app: { on: () => {} }, ipcMain: { handle: () => {}, on: () => {} } }))

const { checkRepo, radarMerges, radarSupported, reportsFor, unwatch, watchTargets } = await import('./conflict-radar')

const identity = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
Object.assign(process.env, identity, { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'commit.gpgsign', GIT_CONFIG_VALUE_0: 'false' })
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] }).toString()
const write = (cwd: string, file: string, text: string) => writeFileSync(join(cwd, file), text)
const commit = (cwd: string, file: string, text: string, message: string) => {
  write(cwd, file, text)
  git(cwd, 'add', '.')
  git(cwd, 'commit', '-q', '-m', message)
}

const FILE = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'].join('\n') + '\n'

let counter = 0
/** main with app.txt and notes.txt, and worktrees a, b, c, idle (all from main, base main). */
function setup(): { root: string; a: string; b: string; c: string; idle: string } {
  const root = join(base, `repo-${++counter}`)
  mkdirSync(root)
  git(root, 'init', '-q', '-b', 'main')
  write(root, 'notes.txt', 'notes\n')
  commit(root, 'app.txt', FILE, 'init')
  const paths = { a: join(base, `${counter}-a`), b: join(base, `${counter}-b`), c: join(base, `${counter}-c`), idle: join(base, `${counter}-idle`) }
  for (const [name, path] of Object.entries(paths)) {
    git(root, 'worktree', 'add', '-q', '-b', `jacob/${name}`, path)
    git(root, 'config', `branch.jacob/${name}.base`, 'main')
  }
  roots.add(root)
  return { root, ...paths }
}

const watcher = () => {
  const sent: RadarReport[] = []
  return { sent, send: (_channel: string, payload: unknown) => sent.push(payload as RadarReport), isDestroyed: () => false }
}

const targets = (root: string, paths: readonly string[], stamp = 0) => paths.map((worktree) => ({ root, worktree, stamp }))

afterAll(() => rmSync(base, { recursive: true, force: true }))

describe('conflict radar', () => {
  it('runs on this git', async () => {
    expect(await radarSupported()).toBe(true)
  })

  it('finds the pair that conflicts, leaves the clean one and the idle one out, and caches merges', async () => {
    const repo = setup()
    commit(repo.a, 'app.txt', FILE.replace('two', 'two from a'), 'a edits two')
    commit(repo.b, 'app.txt', FILE.replace('two', 'two from b'), 'b edits two')
    commit(repo.c, 'notes.txt', 'notes from c\n', 'c edits notes')
    const w = watcher()
    watchTargets(w, targets(repo.root, [repo.root, repo.a, repo.b, repo.c, repo.idle]))
    const report = (await checkRepo(repo.root))!
    expect(report.state).toBe('ok')
    // The main checkout and a worktree with nothing of its own are not reported.
    expect(report.worktrees.map((x) => x.worktree).sort()).toEqual([repo.a, repo.b, repo.c].sort())
    expect(report.pairs).toEqual([{ a: repo.a, b: repo.b, conflicts: [{ path: 'app.txt', type: 'content' }] }])
    expect(report.worktrees.every((x) => x.baseConflicts.length === 0 && x.behind === 0 && x.ahead === 1 && !x.baseMoved)).toBe(true)
    expect(w.sent.at(-1)).toEqual(report)
    expect(reportsFor(w)).toEqual([report])

    // Nothing changed: no merge runs again, and the same report is not sent twice.
    const merges = radarMerges()
    const sent = w.sent.length
    await checkRepo(repo.root)
    expect(radarMerges()).toBe(merges)
    expect(w.sent.length).toBe(sent)

    // A commit in c re-runs only c's merges: its base check and its two pairs.
    commit(repo.c, 'notes.txt', 'notes from c, again\n', 'c again')
    await checkRepo(repo.root)
    expect(radarMerges() - merges).toBe(3)
    unwatch(w)
  })

  it('counts uncommitted work after a turn ends, without touching the worktree or its index', async () => {
    const repo = setup()
    commit(repo.a, 'app.txt', FILE.replace('five', 'five from a'), 'a edits five')
    const w = watcher()
    watchTargets(w, targets(repo.root, [repo.a, repo.b]))
    expect((await checkRepo(repo.root))!.pairs).toEqual([])

    // b edits the same line and creates a file, uncommitted.
    write(repo.b, 'app.txt', FILE.replace('five', 'five from b'))
    write(repo.b, 'new.txt', 'new\n')
    // (status itself may refresh the index, so it runs before the index is looked at.)
    const statusBefore = git(repo.b, 'status', '--porcelain')
    const indexPath = join(repo.root, '.git', 'worktrees', `${counter}-b`, 'index')
    const indexBefore = readFileSync(indexPath)
    const mtimeBefore = statSync(indexPath).mtimeMs

    // Without a new stamp the radar does not look at uncommitted files…
    expect((await checkRepo(repo.root))!.pairs).toEqual([])
    // …after the turn ends it does.
    watchTargets(w, [...targets(repo.root, [repo.a]), ...targets(repo.root, [repo.b], 1000)])
    const report = (await checkRepo(repo.root))!
    expect(report.pairs).toEqual([{ a: repo.a, b: repo.b, conflicts: [{ path: 'app.txt', type: 'content' }] }])
    expect(report.worktrees.find((x) => x.worktree === repo.b)).toMatchObject({ uncommitted: true, ahead: 0 })

    expect(readFileSync(indexPath).equals(indexBefore)).toBe(true)
    expect(statSync(indexPath).mtimeMs).toBe(mtimeBefore)
    expect(git(repo.b, 'status', '--porcelain')).toBe(statusBefore)
    expect(git(repo.b, 'stash', 'list')).toBe('')
    expect(readFileSync(join(repo.b, 'app.txt'), 'utf8')).toBe(FILE.replace('five', 'five from b'))
    unwatch(w)
  })

  it('after a merge into main: the merged one drops out, the others are behind, and a conflict with main shows', async () => {
    const repo = setup()
    commit(repo.a, 'app.txt', FILE.replace('seven', 'seven from a'), 'a edits seven')
    commit(repo.b, 'app.txt', FILE.replace('seven', 'seven from b'), 'b edits seven')
    commit(repo.c, 'notes.txt', 'notes from c\n', 'c edits notes')
    const w = watcher()
    watchTargets(w, targets(repo.root, [repo.a, repo.b, repo.c]))
    expect((await checkRepo(repo.root))!.pairs.map((p) => [p.a, p.b])).toEqual([[repo.a, repo.b]])

    // Squash-merge a into main in the main checkout (what the merge sheet's squash does, by hand).
    git(repo.root, 'merge', '--squash', '-q', 'jacob/a')
    git(repo.root, 'commit', '-q', '-m', 'Squash a')

    const report = (await checkRepo(repo.root))!
    expect(report.worktrees.map((x) => x.worktree).sort()).toEqual([repo.b, repo.c].sort())
    expect(report.pairs).toEqual([])
    const b = report.worktrees.find((x) => x.worktree === repo.b)!
    const c = report.worktrees.find((x) => x.worktree === repo.c)!
    expect(b).toMatchObject({ behind: 1, baseMoved: true, baseConflicts: [{ path: 'app.txt', type: 'content' }] })
    expect(c).toMatchObject({ behind: 1, baseMoved: true, baseConflicts: [] })

    // c rebases onto main: level again, no longer flagged.
    git(repo.c, 'rebase', '-q', 'main')
    const after = (await checkRepo(repo.root))!
    expect(after.worktrees.find((x) => x.worktree === repo.c)).toMatchObject({ behind: 0, baseMoved: false })
    unwatch(w)
  })

  it('stays quick with 20 worktrees (190 pairs) and only re-runs one worktree’s merges after its commit', async () => {
    const root = join(base, `repo-${++counter}`)
    mkdirSync(root)
    git(root, 'init', '-q', '-b', 'main')
    commit(root, 'app.txt', FILE, 'init')
    const paths: string[] = []
    for (let i = 0; i < 20; i++) {
      const path = join(base, `${counter}-w${i}`)
      git(root, 'worktree', 'add', '-q', '-b', `w${i}`, path)
      commit(path, `file-${i}.txt`, `${i}\n`, `w${i}`)
      paths.push(path)
    }
    roots.add(root)
    const w = watcher()
    watchTargets(w, targets(root, paths))
    const started = Date.now()
    const merges = radarMerges()
    const report = (await checkRepo(root))!
    const took = Date.now() - started
    expect(report.worktrees).toHaveLength(20)
    expect(report.pairs).toEqual([])
    expect(radarMerges() - merges).toBe(20 + 190)
    expect(took).toBeLessThan(30_000)
    if (process.env.TR_RADAR_TIMING) console.log(`20 worktrees, first check: ${took} ms`)

    const again = radarMerges()
    commit(paths[3]!, 'file-3.txt', 'changed\n', 'w3 again')
    await checkRepo(root)
    expect(radarMerges() - again).toBe(20)
    unwatch(w)
  }, 60_000)
})
