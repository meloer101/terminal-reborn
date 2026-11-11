// Real git repositories in a temp folder: what the new-session sheet is told and what creating a worktree does.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const base = realpathSync(mkdtempSync(join(tmpdir(), 'tr-worktree-create-')))
const home = join(base, 'home')

const roots = new Set<string>()
vi.mock('./workspace-store', () => ({ isProjectRoot: (path: string) => roots.has(path) }))
vi.mock('node:os', async (importOriginal) => {
  const os = await importOriginal<typeof import('node:os')>()
  return { ...os, homedir: () => home, userInfo: () => ({ ...os.userInfo(), username: 'tester' }) }
})

const { createWorktree, newSessionInfo } = await import('./worktree-create')

const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd, env }).toString()

function repo(name: string): string {
  const dir = join(base, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'README.md'), '# r\n')
  writeFileSync(join(dir, '.gitignore'), '.env*\nnode_modules/\nbuild/\n')
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.name', 'Jacob Yu')
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', 'init')
  roots.add(dir)
  return dir
}

afterAll(() => rmSync(base, { recursive: true, force: true }))

describe('newSessionInfo', () => {
  let root: string
  beforeAll(() => {
    root = repo('info-repo')
    git(root, 'branch', 'release/1.4')
    git(root, 'worktree', 'add', '-q', '-b', 'jacob/busy', join(base, 'busy'))
  })

  it('refuses a folder that is not a workspace project', async () => {
    await expect(newSessionInfo(join(base, 'elsewhere'))).rejects.toThrow()
    await expect(newSessionInfo('relative')).rejects.toThrow()
  })

  it('lists branches with the worktree that has each one out', async () => {
    const info = await newSessionInfo(root)
    expect(info.repo).toBe(true)
    expect(info.currentBranch).toBe('main')
    expect(info.defaultBranch).toBe('main')
    expect(info.prefix).toBe('jacob')
    expect(info.worktreesDir).toBe(join(home, '.tr', 'worktrees', 'info-repo'))
    const byName = Object.fromEntries(info.branches.map((b) => [b.name, b]))
    expect(byName.main).toMatchObject({ remote: false, inMainCheckout: true })
    expect(byName['jacob/busy']).toMatchObject({ worktreePath: realpathSync(join(base, 'busy')), inMainCheckout: false })
    expect(byName['release/1.4']).toMatchObject({ worktreePath: null })
  })

  it('says when the folder is not a git repository', async () => {
    const plain = join(base, 'plain')
    mkdirSync(plain)
    roots.add(plain)
    expect((await newSessionInfo(plain)).repo).toBe(false)
  })
})

describe('createWorktree', () => {
  let root: string
  beforeAll(() => {
    root = repo('create-repo')
    writeFileSync(join(root, '.worktreeinclude'), '.env.local\nnode_modules/\n')
    writeFileSync(join(root, '.env.local'), 'SECRET=1\n')
    writeFileSync(join(root, '.env.other'), 'NOT=copied\n')
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(join(root, 'node_modules', 'pkg', 'index.js'), 'x\n')
  })

  it('lists the ignored files .worktreeinclude asks for', async () => {
    const info = await newSessionInfo(root)
    expect(info.includeFiles.sort()).toEqual(['.env.local', 'node_modules/'])
    expect(info.includeCount).toBe(2)
  })

  it('creates the branch and worktree, records the base and copies the included files', async () => {
    const result = await createWorktree({ root, branch: 'jacob/swift-otter', base: 'main', folder: 'swift-otter', prepare: true })
    const path = join(home, '.tr', 'worktrees', 'create-repo', 'swift-otter')
    expect(result).toEqual({ ok: true, path, copyFailures: 0 })
    expect(git(path, 'branch', '--show-current').trim()).toBe('jacob/swift-otter')
    expect(git(root, 'config', '--get', 'branch.jacob/swift-otter.base').trim()).toBe('main')
    expect(readFileSync(join(path, '.env.local'), 'utf8')).toBe('SECRET=1\n')
    expect(existsSync(join(path, 'node_modules', 'pkg', 'index.js'))).toBe(true)
    expect(existsSync(join(path, '.env.other'))).toBe(false)
  })

  it('skips the copy when 准备 is off', async () => {
    const result = await createWorktree({ root, branch: 'jacob/bare', base: 'main', folder: 'bare', prepare: false })
    expect(result.ok).toBe(true)
    expect(existsSync(join(home, '.tr', 'worktrees', 'create-repo', 'bare', '.env.local'))).toBe(false)
  })

  it('refuses an existing branch, an existing folder, a missing base and malformed payloads', async () => {
    expect(await createWorktree({ root, branch: 'main', base: 'main', folder: 'x1', prepare: false })).toEqual({ ok: false, reason: 'branch-exists' })
    expect(await createWorktree({ root, branch: 'jacob/new', base: 'main', folder: 'swift-otter', prepare: false })).toEqual({
      ok: false,
      reason: 'folder-exists'
    })
    expect(await createWorktree({ root, branch: 'jacob/new', base: 'nope', folder: 'x2', prepare: false })).toEqual({ ok: false, reason: 'base-missing' })
    expect(await createWorktree({ root, branch: '--force', base: 'main', folder: 'x3', prepare: false })).toEqual({ ok: false, reason: 'invalid' })
    expect(await createWorktree({ root, branch: 'a', base: 'main', folder: '../escape', prepare: false })).toEqual({ ok: false, reason: 'invalid' })
    await expect(createWorktree({ root: join(base, 'elsewhere'), branch: 'a', base: 'main', folder: 'a', prepare: false })).rejects.toThrow()
  })

  it('starts from the upstream when the local base is only behind it', async () => {
    const upstream = repo('upstream-repo')
    const clone = join(base, 'clone-repo')
    git(base, 'clone', '-q', upstream, clone)
    roots.add(clone)
    writeFileSync(join(upstream, 'new.txt'), 'n\n')
    git(upstream, 'add', '.')
    git(upstream, 'commit', '-q', '-m', 'newer')
    const result = await createWorktree({ root: clone, branch: 'jacob/fresh', base: 'main', folder: 'fresh', prepare: false })
    expect(result.ok).toBe(true)
    if (result.ok) expect(existsSync(join(result.path, 'new.txt'))).toBe(true)
    expect(result).not.toHaveProperty('fetchFailed')
  })

  it('says when the fetch before branching off failed, and still starts from the local base', async () => {
    const origin = repo('gone-origin')
    const clone = join(base, 'offline-clone')
    git(base, 'clone', '-q', origin, clone)
    roots.add(clone)
    rmSync(origin, { recursive: true, force: true })
    const result = await createWorktree({ root: clone, branch: 'jacob/offline', base: 'main', folder: 'offline', prepare: false })
    expect(result).toMatchObject({ ok: true, fetchFailed: '没有远程仓库，没法拉取' })
    if (result.ok) expect(git(result.path, 'rev-parse', 'HEAD').trim()).toBe(git(clone, 'rev-parse', 'main').trim())
  })

  // M6: the server's reason comes before its banner and git's own closing lines; the class is read from all of them.
  it('names a fetch that needs a login although a long server message follows the reason', async () => {
    const origin = repo('login-origin')
    const clone = join(base, 'login-clone')
    git(base, 'clone', '-q', origin, clone)
    roots.add(clone)
    const uploadPack = join(base, 'login-upload-pack')
    writeFileSync(uploadPack, '#!/bin/sh\necho "remote: Authentication failed for this repository" >&2\nfor i in 1 2 3 4 5 6 7 8 9 10; do echo "banner line $i" >&2; done\nexit 1\n', { mode: 0o755 })
    git(clone, 'config', 'remote.origin.uploadpack', uploadPack)
    const result = await createWorktree({ root: clone, branch: 'jacob/login', base: 'main', folder: 'login', prepare: false })
    expect(result).toMatchObject({ ok: true, fetchFailed: '拉取需要登录：在终端里运行一次 git fetch' })
  })

  it('says when the base could not be recorded', async () => {
    const lockRepo = repo('locked-config')
    writeFileSync(join(lockRepo, '.git', 'config.lock'), '')
    const result = await createWorktree({ root: lockRepo, branch: 'jacob/unsaved', base: 'main', folder: 'unsaved', prepare: false })
    rmSync(join(lockRepo, '.git', 'config.lock'))
    expect(result).toMatchObject({ ok: true, baseNotSaved: expect.stringMatching(/^没能记下基线分支 main：.*lock/) })
    expect(() => git(lockRepo, 'config', '--get', 'branch.jacob/unsaved.base')).toThrow()
  })
})

describe('createWorktree · snapshot (PRD F21 --base snapshot)', () => {
  it('copies the working tree as it is, uncommitted and untracked files included, without touching it', async () => {
    const root = repo('snapshot-repo')
    writeFileSync(join(root, 'README.md'), '# changed, not staged\n')
    writeFileSync(join(root, 'staged.txt'), 'staged\n')
    git(root, 'add', 'staged.txt')
    writeFileSync(join(root, 'untracked.txt'), 'new\n')
    mkdirSync(join(root, 'node_modules'))
    writeFileSync(join(root, 'node_modules', 'ignored.js'), 'x\n')
    const statusBefore = git(root, 'status', '--porcelain')
    const result = await createWorktree({ root, branch: '', base: 'main', folder: 'snapshot-review', prepare: false, snapshotOf: root })
    const path = join(home, '.tr', 'worktrees', 'snapshot-repo', 'snapshot-review')
    expect(result).toEqual({ ok: true, path, copyFailures: 0 })
    expect(readFileSync(join(path, 'README.md'), 'utf8')).toBe('# changed, not staged\n')
    expect(readFileSync(join(path, 'staged.txt'), 'utf8')).toBe('staged\n')
    expect(readFileSync(join(path, 'untracked.txt'), 'utf8')).toBe('new\n')
    expect(existsSync(join(path, 'node_modules', 'ignored.js'))).toBe(false)
    expect(git(path, 'branch', '--show-current').trim()).toBe('')
    expect(git(path, 'status', '--porcelain')).toBe('')
    // The dispatcher's own checkout and index are as they were.
    expect(git(root, 'status', '--porcelain')).toBe(statusBefore)
  })

  it('keeps tracked files an ignore pattern matches (force-added)', async () => {
    const root = repo('snapshot-forced')
    mkdirSync(join(root, 'build'))
    writeFileSync(join(root, 'build', 'fixture.json'), '{}\n')
    git(root, 'add', '-f', 'build/fixture.json')
    git(root, 'commit', '-q', '-m', 'fixture')
    const result = await createWorktree({ root, branch: '', base: 'main', folder: 'snap', prepare: false, snapshotOf: root })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(readFileSync(join(result.path, 'build', 'fixture.json'), 'utf8')).toBe('{}\n')
    expect(git(result.path, 'status', '--porcelain')).toBe('')
  })

  it('refuses a checkout of another repository and a snapshot with a branch name', async () => {
    const root = repo('snapshot-a')
    const other = repo('snapshot-b')
    expect(await createWorktree({ root, branch: '', base: 'main', folder: 'x', prepare: false, snapshotOf: other })).toEqual({ ok: false, reason: 'invalid' })
    expect(await createWorktree({ root, branch: 'jacob/x', base: 'main', folder: 'x', prepare: false, snapshotOf: root })).toEqual({ ok: false, reason: 'invalid' })
  })
})
