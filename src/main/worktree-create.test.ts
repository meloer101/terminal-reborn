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
  })
})
