// Real git repositories in a temp folder: what the Worktree view lists and what removal refuses.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const roots = new Set<string>()
vi.mock('./workspace-store', () => ({ isProjectRoot: (path: string) => roots.has(path) }))

const { listWorktrees, removeWorktree } = await import('./git-worktrees')

const base = realpathSync(mkdtempSync(join(tmpdir(), 'tr-git-worktrees-')))
const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd, env }).toString()

/** A repo (main) with `n` commits, registered as a project. */
function repo(name: string): string {
  const dir = join(base, name)
  mkdirSync(dir)
  writeFileSync(join(dir, 'README.md'), '# r\n')
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', 'init')
  roots.add(dir)
  return dir
}

const byPath = async (root: string, path: string) => (await listWorktrees(root, []))!.worktrees.find((w) => w.path === path)!

afterAll(() => rmSync(base, { recursive: true, force: true }))

describe('listWorktrees / removeWorktree on real repositories', () => {
  let root: string
  beforeAll(() => {
    root = repo('main-repo')
  })

  it('refuses a folder that is not one of the workspace projects', async () => {
    await expect(listWorktrees(join(base, 'elsewhere'), [])).rejects.toThrow()
    await expect(removeWorktree('/tmp', join(root, 'x'), false)).rejects.toThrow()
  })

  it('a fresh worktree whose base moved on is 无新提交, not merged; a committed and merged one is merged', async () => {
    const fresh = join(base, 'fresh')
    const done = join(base, 'done')
    git(root, 'worktree', 'add', '-q', '-b', 'fresh', fresh)
    git(root, 'worktree', 'add', '-q', '-b', 'done', done)
    writeFileSync(join(done, 'done.ts'), 'x\n')
    git(done, 'add', '.')
    git(done, 'commit', '-q', '-m', 'done')
    git(root, 'merge', '-q', '--no-ff', '-m', 'merge done', 'done')
    const freshInfo = await byPath(root, fresh)
    expect(freshInfo).toMatchObject({ branch: 'fresh', ahead: 0, behind: 2, merged: false, dirtyCount: 0 })
    expect(await byPath(root, done)).toMatchObject({ branch: 'done', ahead: 0, merged: true })
  })

  it('reports git failures as unknown and refuses to remove (even with force)', async () => {
    const broken = join(base, 'broken')
    git(root, 'worktree', 'add', '-q', '-b', 'broken', broken)
    writeFileSync(join(broken, 'work.ts'), 'unsaved work\n')
    // `git status` inside now fails; the repository still lists the worktree.
    writeFileSync(join(broken, '.git'), 'gitdir: /nonexistent\n')
    const info = await byPath(root, broken)
    expect(info.dirtyCount).toBeNull()
    expect(await removeWorktree(root, broken, false)).toMatchObject({ ok: false, reason: 'unverified' })
    expect(await removeWorktree(root, broken, true)).toMatchObject({ ok: false, reason: 'unverified' })
    expect(existsSync(join(broken, 'work.ts'))).toBe(true)
  })

  it('refuses a detached worktree with commits no branch has', async () => {
    const detached = join(base, 'detached')
    git(root, 'worktree', 'add', '-q', '--detach', detached)
    git(detached, 'commit', '-q', '--allow-empty', '-m', 'only here')
    expect(await byPath(root, detached)).toMatchObject({ branch: null, unreachableCommits: 1, dirtyCount: 0 })
    expect(await removeWorktree(root, detached, false)).toMatchObject({ ok: false, reason: 'unreachable-commits', message: '1' })
    expect(existsSync(detached)).toBe(true)
    // Once a branch holds the commit, removal is safe.
    git(detached, 'branch', 'keep')
    expect(await removeWorktree(root, detached, false)).toEqual({ ok: true })
  })

  it('refuses uncommitted changes, the main checkout, and force without submodules', async () => {
    const dirty = join(base, 'dirty')
    git(root, 'worktree', 'add', '-q', '-b', 'dirty', dirty)
    writeFileSync(join(dirty, 'new.ts'), 'untracked\n')
    expect(await removeWorktree(root, dirty, false)).toEqual({ ok: false, reason: 'dirty' })
    expect(await removeWorktree(root, root, false)).toEqual({ ok: false, reason: 'main' })
    rmSync(join(dirty, 'new.ts'))
    expect(await removeWorktree(root, dirty, true)).toMatchObject({ ok: false, reason: 'git' })
    expect(await removeWorktree(root, dirty, false)).toEqual({ ok: true })
    expect(git(root, 'branch', '--list', 'dirty')).toContain('dirty')
  })

  it('removes a worktree whose folder is gone by path, leaving other stale entries alone', async () => {
    const goneA = join(base, 'gone-a')
    const goneB = join(base, 'gone-b')
    git(root, 'worktree', 'add', '-q', '-b', 'gone-a', goneA)
    git(root, 'worktree', 'add', '-q', '-b', 'gone-b', goneB)
    rmSync(goneA, { recursive: true })
    rmSync(goneB, { recursive: true })
    expect((await byPath(root, goneA)).prunable).toMatch(/gitdir/)
    expect(await removeWorktree(root, goneA, false)).toEqual({ ok: true })
    const listed = (await listWorktrees(root, []))!.worktrees.map((w) => w.path)
    expect(listed).not.toContain(goneA)
    expect(listed).toContain(goneB)
  })

  it('details only the worktrees asked for', async () => {
    const listing = (await listWorktrees(root, [], [root]))!
    expect(listing.worktrees.find((w) => w.path === root)?.detailed).toBe(true)
    expect(listing.worktrees.filter((w) => w.path !== root).every((w) => !w.detailed)).toBe(true)
  })
})

describe('a bare repository with worktrees', () => {
  it('has no main checkout: no linked worktree is taken for 主目录', async () => {
    const source = repo('bare-source')
    const bare = join(base, 'bare.git')
    git(base, 'clone', '-q', '--bare', source, bare)
    const first = join(base, 'bare-first')
    const second = join(base, 'bare-second')
    git(bare, 'worktree', 'add', '-q', first, 'main')
    git(bare, 'worktree', 'add', '-q', '-b', 'second', second)
    roots.add(first)
    const listing = (await listWorktrees(first, []))!
    expect(listing.worktrees.map((w) => [w.path, w.isMain])).toEqual([
      [first, false],
      [second, false]
    ])
    // The project folder itself is still never removed from under the project.
    expect(await removeWorktree(first, first, false)).toEqual({ ok: false, reason: 'main' })
    expect(await removeWorktree(first, second, false)).toEqual({ ok: true })
  })
})
