// Real git repositories in a temp folder: the merge precheck and the three merge methods (PRD F4).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

const base = realpathSync(mkdtempSync(join(tmpdir(), 'tr-git-merge-')))

const roots = new Set<string>()
vi.mock('./workspace-store', () => ({ isProjectRoot: (path: string) => roots.has(path) }))
vi.mock('electron', () => ({ ipcMain: { handle: () => {}, on: () => {} } }))

const { mergePrecheck, mergeWorktree } = await import('./git-merge')

const identity = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
Object.assign(process.env, identity, { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'commit.gpgsign', GIT_CONFIG_VALUE_0: 'false' })
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] }).toString()
const commit = (cwd: string, file: string, text: string, message: string) => {
  mkdirSync(join(cwd, file, '..'), { recursive: true })
  writeFileSync(join(cwd, file), text)
  git(cwd, 'add', '.')
  git(cwd, 'commit', '-q', '-m', message)
}
const sha = (cwd: string, ref: string) => git(cwd, 'rev-parse', ref).trim()

let counter = 0
/** A repo on main with a linked worktree on `feat` (base recorded as Wavi does). */
function setup(): { root: string; wt: string } {
  const root = join(base, `repo-${++counter}`)
  mkdirSync(root)
  git(root, 'init', '-q', '-b', 'main')
  commit(root, 'a.txt', 'one\ntwo\nthree\n', 'init')
  roots.add(root)
  const wt = join(base, `wt-${counter}`)
  git(root, 'worktree', 'add', '-q', '-b', 'feat', wt)
  git(root, 'config', 'branch.feat.base', 'main')
  return { root, wt }
}

afterAll(() => rmSync(base, { recursive: true, force: true }))

describe('mergePrecheck', () => {
  it('refuses folders that are not workspace projects or not its worktrees', async () => {
    const { root } = setup()
    await expect(mergePrecheck(join(base, 'elsewhere'), root)).rejects.toThrow()
    await expect(mergePrecheck(root, join(base, 'nope'))).rejects.toThrow()
    await expect(mergePrecheck(root, 'relative')).rejects.toThrow()
  })

  it('says there is nothing to merge before the branch has commits', async () => {
    const { root, wt } = setup()
    const check = await mergePrecheck(root, wt)
    expect(check).toMatchObject({ branch: 'feat', base: 'main', ahead: 0, blocker: { kind: 'nothing' } })
  })

  it('reports ahead, behind, uncommitted files and a clean merge', async () => {
    const { root, wt } = setup()
    commit(wt, 'b.txt', 'b\n', 'add b')
    commit(wt, 'c.txt', 'c\n', 'add c')
    commit(root, 'd.txt', 'd\n', 'add d on main')
    writeFileSync(join(wt, 'scratch.txt'), 'not committed')
    const check = await mergePrecheck(root, wt)
    expect(check).toMatchObject({
      branch: 'feat',
      base: 'main',
      ahead: 2,
      behind: 1,
      conflicts: [],
      uncommitted: 1,
      baseCheckout: root,
      hasOrigin: false,
      blocker: null
    })
    expect(check.head).toBe(sha(root, 'feat'))
    expect(check.baseHead).toBe(sha(root, 'main'))
  })

  it('lists conflicting files with their conflict type', async () => {
    const { root, wt } = setup()
    commit(wt, 'a.txt', 'one\nFEAT\nthree\n', 'feat edits a')
    commit(root, 'a.txt', 'one\nMAIN\nthree\n', 'main edits a')
    const check = await mergePrecheck(root, wt)
    expect(check.blocker).toBeNull()
    expect(check.conflicts).toEqual([{ path: 'a.txt', type: 'content' }])
  })

  it('blocks when the base checkout has uncommitted changes the merge would touch', async () => {
    const { root, wt } = setup()
    commit(wt, 'a.txt', 'one\nFEAT\nthree\n', 'feat edits a')
    writeFileSync(join(root, 'a.txt'), 'local edit\n')
    expect((await mergePrecheck(root, wt)).blocker).toEqual({ kind: 'base-dirty', path: root, files: ['a.txt'] })
    git(root, 'checkout', '--', 'a.txt')
    writeFileSync(join(root, 'README.md'), 'unrelated\n')
    expect((await mergePrecheck(root, wt)).blocker).toBeNull()
  })

  it('blocks the main checkout and a worktree in the middle of a rebase', async () => {
    const { root, wt } = setup()
    expect((await mergePrecheck(root, root)).blocker).toEqual({ kind: 'main' })
    commit(wt, 'a.txt', 'one\nFEAT\nthree\n', 'feat edits a')
    commit(root, 'a.txt', 'one\nMAIN\nthree\n', 'main edits a')
    expect(() => git(wt, 'rebase', 'main')).toThrow()
    expect((await mergePrecheck(root, wt)).blocker).toEqual({ kind: 'busy', where: 'worktree', operation: 'rebase' })
    git(wt, 'rebase', '--abort')
  })
})

describe('mergeWorktree', () => {
  const request = async (root: string, wt: string, method: 'squash' | 'merge' | 'rebase', extra: Record<string, unknown> = {}) => {
    const check = await mergePrecheck(root, wt)
    return { root, worktree: wt, method, head: check.head, baseHead: check.baseHead, push: false, ...extra }
  }

  it('merge: a merge commit with both parents, and the base checkout follows', async () => {
    const { root, wt } = setup()
    commit(wt, 'b.txt', 'b\n', 'add b')
    commit(root, 'd.txt', 'd\n', 'add d on main')
    const before = sha(root, 'main')
    const result = await mergeWorktree(await request(root, wt, 'merge'))
    expect(result).toMatchObject({ ok: true, push: null })
    const parents = git(root, 'log', '-1', '--format=%P', 'main').trim().split(' ')
    expect(parents).toEqual([before, sha(root, 'feat')])
    expect(git(root, 'log', '-1', '--format=%s', 'main').trim()).toBe("Merge branch 'feat'")
    expect(readFileSync(join(root, 'b.txt'), 'utf8')).toBe('b\n')
    expect(git(root, 'status', '--porcelain')).toBe('')
  })

  it('squash: one commit on the base with the title and the subjects', async () => {
    const { root, wt } = setup()
    commit(wt, 'b.txt', 'b\n', 'add b')
    commit(wt, 'c.txt', 'c\n', 'add c')
    const before = sha(root, 'main')
    const result = await mergeWorktree(await request(root, wt, 'squash', { title: '修复导航\n抖动' }))
    expect(result.ok).toBe(true)
    expect(git(root, 'log', '-1', '--format=%P', 'main').trim()).toBe(before)
    expect(git(root, 'log', '-1', '--format=%B', 'main').trim()).toBe('修复导航 抖动\n\n- add b\n- add c')
    expect(existsSync(join(root, 'c.txt'))).toBe(true)
  })

  it('squash: an agent-written message wins over the title and keeps its body', async () => {
    const { root, wt } = setup()
    commit(wt, 'b.txt', 'b\n', 'add b')
    commit(wt, 'c.txt', 'c\n', 'add c')
    const result = await mergeWorktree(await request(root, wt, 'squash', { title: 'ignored', message: 'feat(nav): sticky header\n\nWhy: it jumped.' }))
    expect(result.ok).toBe(true)
    expect(git(root, 'log', '-1', '--format=%B', 'main').trim()).toBe('feat(nav): sticky header\n\nWhy: it jumped.')
  })

  it('rebase: replays the branch onto the base and fast-forwards the base to it', async () => {
    const { root, wt } = setup()
    commit(wt, 'b.txt', 'b\n', 'add b')
    commit(root, 'd.txt', 'd\n', 'add d on main')
    const result = await mergeWorktree(await request(root, wt, 'rebase'))
    expect(result.ok).toBe(true)
    expect(sha(root, 'main')).toBe(sha(root, 'feat'))
    expect(git(root, 'log', '--format=%s', 'main').trim().split('\n')).toEqual(['add b', 'add d on main', 'init'])
  })

  it('moves a base that no checkout has with a compare-and-swap', async () => {
    const { root, wt } = setup()
    git(root, 'checkout', '-q', '--detach')
    commit(wt, 'b.txt', 'b\n', 'add b')
    const result = await mergeWorktree(await request(root, wt, 'merge'))
    expect(result.ok).toBe(true)
    expect(git(root, 'log', '-1', '--format=%s', 'main').trim()).toBe("Merge branch 'feat'")
  })

  it('refuses a conflicting merge and changes nothing', async () => {
    const { root, wt } = setup()
    commit(wt, 'a.txt', 'one\nFEAT\nthree\n', 'feat edits a')
    commit(root, 'a.txt', 'one\nMAIN\nthree\n', 'main edits a')
    const before = sha(root, 'main')
    const result = await mergeWorktree(await request(root, wt, 'merge'))
    expect(result).toMatchObject({ ok: false, reason: 'conflict', conflicts: [{ path: 'a.txt', type: 'content' }] })
    expect(sha(root, 'main')).toBe(before)
    expect(git(root, 'status', '--porcelain')).toBe('')
  })

  it('refuses when the branch or the base moved since the precheck', async () => {
    const { root, wt } = setup()
    commit(wt, 'b.txt', 'b\n', 'add b')
    const stale = await request(root, wt, 'merge')
    commit(wt, 'c.txt', 'c\n', 'add c')
    expect(await mergeWorktree(stale)).toMatchObject({ ok: false, reason: 'stale' })
  })

  it('refuses a rebase with uncommitted changes in the worktree', async () => {
    const { root, wt } = setup()
    commit(wt, 'b.txt', 'b\n', 'add b')
    writeFileSync(join(wt, 'scratch.txt'), 'x')
    expect(await mergeWorktree(await request(root, wt, 'rebase'))).toMatchObject({ ok: false, reason: 'blocked', blocker: { kind: 'worktree-dirty' } })
  })

  it('rebase stopped by a conflict in an earlier commit is aborted', async () => {
    const { root, wt } = setup()
    commit(wt, 'a.txt', 'one\nFEAT\nthree\n', 'feat edits a')
    commit(wt, 'a.txt', 'one\ntwo\nthree\n', 'feat reverts a')
    commit(root, 'a.txt', 'one\nMAIN\nthree\n', 'main edits a')
    const check = await mergePrecheck(root, wt)
    expect(check.conflicts).toEqual([])
    const head = sha(root, 'feat')
    const result = await mergeWorktree(await request(root, wt, 'rebase'))
    expect(result).toMatchObject({ ok: false, reason: 'conflict' })
    expect(sha(root, 'feat')).toBe(head)
    expect(git(wt, 'status', '--porcelain')).toBe('')
  })

  it('pushes the base to origin when asked', async () => {
    const { root, wt } = setup()
    const remote = join(base, `remote-${counter}.git`)
    git(base, 'init', '-q', '--bare', remote)
    git(root, 'remote', 'add', 'origin', remote)
    git(root, 'push', '-q', 'origin', 'main')
    commit(wt, 'b.txt', 'b\n', 'add b')
    const result = await mergeWorktree(await request(root, wt, 'merge', { push: true }))
    expect(result).toMatchObject({ ok: true, push: '' })
    expect(git(remote, 'rev-parse', 'main').trim()).toBe(sha(root, 'main'))
  })

  it('rejects malformed requests', async () => {
    const { root, wt } = setup()
    expect(await mergeWorktree({ root, worktree: wt, method: 'octopus', head: 'x', baseHead: 'y', push: false })).toMatchObject({ ok: false, reason: 'invalid' })
    expect(await mergeWorktree(null)).toMatchObject({ ok: false, reason: 'invalid' })
  })
})
