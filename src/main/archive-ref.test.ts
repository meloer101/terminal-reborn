// A worktree's uncommitted state, including untracked files, round-trips through refs/wavi/archive/<id>
// without moving the branch, writing git config, or publishing the ref.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { archiveRefName } from '@shared/archive'
import { captureWorktreeArchive, restoreWorktreeArchive } from './archive-ref'

const base = realpathSync(mkdtempSync(join(tmpdir(), 'tr-archive-ref-')))
const identity = [
  '-c',
  'user.name=t',
  '-c',
  'user.email=t@t',
  '-c',
  'commit.gpgsign=false'
]
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', [...identity, ...args], { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] }).toString()

function setup(): string {
  const dir = join(base, `repo-${Math.random().toString(16).slice(2)}`)
  execFileSync('git', ['init', '-q', '-b', 'main', dir])
  writeFileSync(join(dir, 'a.txt'), 'one\n')
  git(dir, 'add', 'a.txt')
  git(dir, 'commit', '-q', '-m', 'init')
  return dir
}

afterAll(() => rmSync(base, { recursive: true, force: true }))

describe('captureWorktreeArchive', () => {
  it('stores staged, unstaged and untracked files on a private ref and leaves the branch alone', async () => {
    const dir = setup()
    const head = git(dir, 'rev-parse', 'HEAD').trim()
    writeFileSync(join(dir, 'a.txt'), 'one\ntwo\n')
    writeFileSync(join(dir, 'b.txt'), 'staged\n')
    git(dir, 'add', 'b.txt')
    writeFileSync(join(dir, 'c.txt'), 'untracked\n')
    writeFileSync(join(dir, 'secret.txt'), 'nope\n')
    writeFileSync(join(dir, '.gitignore'), 'secret.txt\n')
    git(dir, 'add', '.gitignore')

    const saved = await captureWorktreeArchive(dir, 'w-abc12345')

    expect(saved.ref).toBe('refs/wavi/archive/w-abc12345')
    expect(saved.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(git(dir, 'rev-parse', saved.ref).trim()).toBe(saved.commit)
    expect(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('main')
    expect(git(dir, 'rev-parse', 'HEAD').trim()).toBe(head)
    expect(git(dir, 'show-ref')).not.toContain('refs/stash')
    expect(git(dir, 'config', '--local', '--list')).not.toMatch(/^user\./m)
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('one\ntwo\n')
    expect(readFileSync(join(dir, 'c.txt'), 'utf8')).toBe('untracked\n')
  })

  it('points a clean worktree at HEAD', async () => {
    const dir = setup()
    const head = git(dir, 'rev-parse', 'HEAD').trim()
    const saved = await captureWorktreeArchive(dir, 'w-clean')
    expect(saved.commit).toBe(head)
    expect(git(dir, 'rev-parse', 'refs/wavi/archive/w-clean').trim()).toBe(head)
  })

  it('rejects an id that is not a safe ref name', async () => {
    const dir = setup()
    await expect(captureWorktreeArchive(dir, '../heads/main')).rejects.toThrow(/archive id/)
  })
})

describe('restoreWorktreeArchive', () => {
  it('puts the archived uncommitted state back without moving the branch', async () => {
    const dir = setup()
    const head = git(dir, 'rev-parse', 'HEAD').trim()
    writeFileSync(join(dir, 'a.txt'), 'one\ntwo\n')
    writeFileSync(join(dir, 'b.txt'), 'staged\n')
    git(dir, 'add', 'b.txt')
    writeFileSync(join(dir, 'c.txt'), 'untracked\n')
    await captureWorktreeArchive(dir, 'w-back')

    git(dir, 'reset', '-q', '--hard', 'HEAD')
    git(dir, 'clean', '-fdq')
    writeFileSync(join(dir, 'later.txt'), 'later\n')

    await restoreWorktreeArchive(dir, 'w-back')

    expect(git(dir, 'rev-parse', 'HEAD').trim()).toBe(head)
    expect(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('main')
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('one\ntwo\n')
    expect(readFileSync(join(dir, 'b.txt'), 'utf8')).toBe('staged\n')
    expect(readFileSync(join(dir, 'c.txt'), 'utf8')).toBe('untracked\n')
    expect(git(dir, 'status', '--porcelain')).toBe(' M a.txt\nA  b.txt\n?? c.txt\n')
  })
})

describe('archiveRefName', () => {
  it('builds the private ref and refuses path tricks', () => {
    expect(archiveRefName('w-abc')).toBe('refs/wavi/archive/w-abc')
    expect(archiveRefName('refs/heads/main')).toBeNull()
    expect(archiveRefName('a/b')).toBeNull()
    expect(archiveRefName('..')).toBeNull()
  })
})
