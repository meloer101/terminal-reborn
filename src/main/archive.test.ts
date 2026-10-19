// Archive IPC on real repositories (PRD F15): capture refuses the main checkout and paths git does not list;
// restore leaves an existing folder alone and recreates a removed one — branch, uncommitted and untracked files —
// from the private ref, which is then dropped.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

const base = realpathSync(mkdtempSync(join(tmpdir(), 'tr-archive-')))
const roots = new Set<string>()
vi.mock('./workspace-store', () => ({ isProjectRoot: (path: string) => roots.has(path) }))
vi.mock('electron', () => ({ ipcMain: { handle: () => {} } }))

const { captureArchive, restoreArchive } = await import('./archive')

Object.assign(process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' })
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] }).toString()

function project(name: string): { root: string; wt: string } {
  const root = join(base, name)
  execFileSync('git', ['init', '-q', '-b', 'main', root])
  writeFileSync(join(root, 'a.txt'), 'one\n')
  git(root, 'add', '.')
  git(root, 'commit', '-q', '-m', 'init')
  const wt = join(base, `${name}-wt`)
  git(root, 'worktree', 'add', '-q', '-b', 'jacob/nav', wt)
  writeFileSync(join(wt, 'nav.ts'), 'export const nav = 1\n')
  git(wt, 'add', '.')
  git(wt, 'commit', '-q', '-m', 'nav')
  roots.add(root)
  return { root, wt }
}

afterAll(() => rmSync(base, { recursive: true, force: true }))

describe('captureArchive', () => {
  it('refuses a root that is not a project, the main checkout and an unknown path', async () => {
    const { root, wt } = project('refuse')
    expect(await captureArchive('/nope', wt, 'a1')).toMatchObject({ ok: false })
    expect(await captureArchive(root, root, 'a1')).toEqual({ ok: false, message: '项目主目录不能归档' })
    expect(await captureArchive(root, join(base, 'elsewhere'), 'a1')).toEqual({ ok: false, message: '它已经不在 git worktree 列表里' })
    expect(await captureArchive(root, wt, '../heads/main')).toMatchObject({ ok: false, message: 'invalid archive id' })
  })

  it('says whether there was uncommitted work and leaves the files alone', async () => {
    const { root, wt } = project('dirty')
    expect(await captureArchive(root, wt, 'clean')).toMatchObject({ ok: true, dirty: false })
    writeFileSync(join(wt, 'nav.ts'), 'export const nav = 2\n')
    const saved = await captureArchive(root, wt, 'dirty')
    expect(saved).toMatchObject({ ok: true, dirty: true })
    expect(readFileSync(join(wt, 'nav.ts'), 'utf8')).toBe('export const nav = 2\n')
    expect(git(root, 'for-each-ref', '--format=%(refname)', 'refs/wavi/archive')).toBe('refs/wavi/archive/clean\nrefs/wavi/archive/dirty\n')
  })
})

describe('restoreArchive', () => {
  it('leaves a folder that is still there as it is, and drops the ref', async () => {
    const { root, wt } = project('kept')
    writeFileSync(join(wt, 'nav.ts'), 'archived\n')
    await captureArchive(root, wt, 'k1')
    writeFileSync(join(wt, 'nav.ts'), 'edited later\n')
    expect(await restoreArchive({ root, worktree: wt, branch: 'jacob/nav', id: 'k1' })).toEqual({ ok: true, recreated: false })
    expect(readFileSync(join(wt, 'nav.ts'), 'utf8')).toBe('edited later\n')
    expect(git(root, 'for-each-ref', 'refs/wavi/archive')).toBe('')
  })

  it('recreates a removed folder on its branch with the uncommitted and untracked files', async () => {
    const { root, wt } = project('gone')
    writeFileSync(join(wt, 'nav.ts'), 'export const nav = 3\n')
    writeFileSync(join(wt, 'notes.md'), 'todo\n')
    await captureArchive(root, wt, 'g1')
    git(root, 'worktree', 'remove', '--force', wt)
    expect(existsSync(wt)).toBe(false)
    expect(await restoreArchive({ root, worktree: wt, branch: 'jacob/nav', id: 'g1' })).toEqual({ ok: true, recreated: true })
    expect(git(wt, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('jacob/nav')
    expect(readFileSync(join(wt, 'nav.ts'), 'utf8')).toBe('export const nav = 3\n')
    expect(readFileSync(join(wt, 'notes.md'), 'utf8')).toBe('todo\n')
    expect(git(root, 'for-each-ref', 'refs/wavi/archive')).toBe('')
  })

  it('recreates the branch too when it was deleted', async () => {
    const { root, wt } = project('branch')
    const head = git(wt, 'rev-parse', 'HEAD').trim()
    await captureArchive(root, wt, 'b1')
    git(root, 'worktree', 'remove', '--force', wt)
    git(root, 'branch', '-D', 'jacob/nav')
    expect(await restoreArchive({ root, worktree: wt, branch: 'jacob/nav', id: 'b1' })).toEqual({ ok: true, recreated: true })
    expect(git(wt, 'rev-parse', 'HEAD').trim()).toBe(head)
  })

  it('fails when the folder is gone and so is the ref', async () => {
    const { root, wt } = project('lost')
    git(root, 'worktree', 'remove', '--force', wt)
    expect(await restoreArchive({ root, worktree: wt, branch: 'jacob/nav', id: 'none' })).toEqual({ ok: false, message: '文件夹已经不在了，归档时的记录也找不到' })
    expect(await restoreArchive({ root, worktree: 'relative', branch: 'x', id: 'none' })).toMatchObject({ ok: false })
  })
})
