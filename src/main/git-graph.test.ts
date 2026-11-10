// Runs the Git view's main-process functions against throwaway repos.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), on: vi.fn() } }))

const { changes, fileDiff, logPage, reviewDiff } = await import('./git-graph')
const { sshCommandFor } = await import('./git/run')
const { parseUnifiedDiffFiles } = await import('@shared/background-review')

function repo(): { dir: string; git(...args: string[]): string; write(path: string, text: string): void; commit(message: string): void } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'tr-git-graph-')))
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd: dir }).toString()
  const write = (path: string, text: string) => {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  git('init', '-q', '-b', 'main')
  return {
    dir,
    git,
    write,
    commit: (message) => {
      git('add', '-A')
      git('commit', '-q', '--allow-empty', '-m', message)
    }
  }
}

const logRequest = (root: string) => ({ root, skip: 0, limit: 200, scope: 'all', remotes: true, known: [] })

describe('fileDiff', () => {
  const r = repo()
  beforeAll(() => {
    r.write('app/[id]/page.tsx', 'a\n')
    r.write('app/i/page.tsx', 'b\n')
    r.commit('init')
    r.write('app/[id]/page.tsx', 'a2\n')
    r.write('app/i/page.tsx', 'b2\n')
  })

  it('treats paths literally: a Next.js [id] route does not glob its neighbours', async () => {
    const diff = await fileDiff({ root: r.dir, path: 'app/[id]/page.tsx', scope: 'uncommitted' })
    expect(diff).toContain('app/[id]/page.tsx')
    expect(diff).not.toContain('app/i/page.tsx')
  })

  it('only diffs untracked files git lists, and never through a symlink out of the worktree', async () => {
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'tr-git-graph-outside-')))
    writeFileSync(join(outside, 'secret'), 'top secret\n')
    symlinkSync(outside, join(r.dir, 'linkdir'))
    r.write('notes.md', 'todo\n')
    await expect(fileDiff({ root: r.dir, path: 'linkdir/secret', scope: 'uncommitted', untracked: true })).rejects.toThrow()
    await expect(fileDiff({ root: r.dir, path: 'app/i/page.tsx', scope: 'uncommitted', untracked: true })).rejects.toThrow()
    expect(await fileDiff({ root: r.dir, path: 'notes.md', scope: 'uncommitted', untracked: true })).toContain('+todo')
  })

  it('rejects bases that are not full branch refs', async () => {
    await expect(fileDiff({ root: r.dir, path: 'x', scope: 'committed', baseRef: '--output=/tmp/x' })).rejects.toThrow('invalid base')
    await expect(fileDiff({ root: r.dir, path: 'x', scope: 'committed', baseRef: 'main' })).rejects.toThrow('invalid base')
  })
})

describe('logPage', () => {
  it('keeps every commit when log.showSignature is on', async () => {
    const r = repo()
    r.commit('one')
    r.commit('two')
    r.git('config', 'log.showSignature', 'true')
    const page = await logPage(logRequest(r.dir))
    expect(page?.commits.map((c) => c.subject)).toEqual(['two', 'one'])
    expect(page?.head).toBe(page?.commits[0]?.hash)
  })

  it('hides remote-tracking branches on request', async () => {
    const r = repo()
    r.commit('one')
    r.git('update-ref', 'refs/remotes/origin/main', 'HEAD')
    r.git('update-ref', 'refs/remotes/origin/old', 'HEAD')
    expect((await logPage(logRequest(r.dir)))?.refs.map((x) => x.name)).toEqual(['main', 'origin/main', 'origin/old'])
    expect((await logPage({ ...logRequest(r.dir), remotes: false }))?.refs.map((x) => x.name)).toEqual(['main'])
  })
})

describe('changes', () => {
  it('compares against a base whose name git accepts but looks unusual', async () => {
    const r = repo()
    r.commit('init')
    r.git('branch', 'feature/登录')
    r.git('checkout', '-q', '-b', 'work')
    r.write('a.txt', 'a\n')
    r.commit('work')
    const result = await changes(r.dir, 'feature/登录')
    expect(result).toMatchObject({ branch: 'work', base: 'feature/登录', baseRef: 'refs/heads/feature/登录', ahead: 1, behind: 0 })
    expect(result?.committed.map((c) => c.path)).toEqual(['a.txt'])
  })

  it('skips a base that is unusable instead of failing', async () => {
    const r = repo()
    r.commit('init')
    r.git('checkout', '-q', '--orphan', 'unrelated')
    r.commit('elsewhere')
    r.git('checkout', '-q', '-b', 'work', 'main')
    r.write('a.txt', 'a\n')
    r.commit('work')
    // No shared history with `unrelated`, `-x` is no branch name: both fall through to the default branch.
    expect(await changes(r.dir, 'unrelated')).toMatchObject({ base: 'main', ahead: 1 })
    expect(await changes(r.dir, '-x')).toMatchObject({ base: 'main', ahead: 1 })
    expect(await changes(r.dir, 'no-such-branch')).toMatchObject({ base: 'main' })
  })

  it('prefers origin/<base> when the local base is behind it', async () => {
    const r = repo()
    r.commit('init')
    r.commit('upstream work')
    r.git('update-ref', 'refs/remotes/origin/main', 'HEAD')
    r.git('reset', '-q', '--hard', 'HEAD~1')
    r.git('checkout', '-q', '-b', 'work', 'refs/remotes/origin/main')
    r.commit('mine')
    expect(await changes(r.dir, 'main')).toMatchObject({ base: 'origin/main', baseRef: 'refs/remotes/origin/main', ahead: 1, behind: 0 })
  })

  it('lists untracked files with line counts and a nested repo as one entry without a diff', async () => {
    const r = repo()
    r.write('tracked.txt', 'x\n')
    r.commit('init')
    r.write('tracked.txt', 'y\nz\n')
    r.write('new/file.ts', 'one\ntwo\nthree')
    mkdirSync(join(r.dir, 'nested'))
    execFileSync('git', ['init', '-q'], { cwd: join(r.dir, 'nested') })
    writeFileSync(join(r.dir, 'nested', 'inner.txt'), 'inner\n')
    const result = await changes(r.dir, undefined)
    expect(result?.uncommitted.map(({ stamp: _stamp, ...rest }) => rest)).toEqual([
      { path: 'nested', status: 'A', added: null, removed: null, untracked: true, nested: true },
      { path: 'new/file.ts', status: 'A', added: 3, removed: 0, untracked: true },
      { path: 'tracked.txt', status: 'M', added: 2, removed: 1 }
    ])
    expect(result).toMatchObject({ base: null, untrackedOmitted: 0 })
  })
})

describe('changes · review stamps (合入链路 v2)', () => {
  const stamps = async (dir: string, base?: string) => {
    const result = await changes(dir, base)
    const of = (rows: readonly { path: string; stamp?: string }[]) => Object.fromEntries(rows.map((c) => [c.path, c.stamp]))
    return { uncommitted: of(result?.uncommitted ?? []), committed: of(result?.committed ?? []) }
  }

  it('stamps each changed file with its status, counts, size and mtime: an edit changes it, an untouched file keeps it', async () => {
    const r = repo()
    r.write('a.txt', 'a\n')
    r.write('b.txt', 'b\n')
    r.write('gone.txt', 'g\n')
    r.commit('init')
    r.write('a.txt', 'a2\n')
    r.write('b.txt', 'b2\n')
    r.write('new.txt', 'n\n')
    r.git('rm', '-q', 'gone.txt')
    const old = new Date('2026-01-01T00:00:00Z')
    for (const path of ['a.txt', 'b.txt', 'new.txt']) utimesSync(join(r.dir, path), old, old)
    const before = await stamps(r.dir)
    expect(before.uncommitted['a.txt']).toBe(`M:1:1:3:${old.getTime()}`)
    expect(before.uncommitted['new.txt']).toBe(`A:1:0:2:${old.getTime()}`)
    // A deleted file has no size or mtime.
    expect(before.uncommitted['gone.txt']).toBe('D:0:1:-:-')

    // Same size and line counts: only the mtime tells the edit.
    r.write('a.txt', 'a3\n')
    const after = await stamps(r.dir)
    expect(after.uncommitted['a.txt']).not.toBe(before.uncommitted['a.txt'])
    expect(after.uncommitted['b.txt']).toBe(before.uncommitted['b.txt'])
    expect(after.uncommitted['new.txt']).toBe(before.uncommitted['new.txt'])
    expect(after.uncommitted['gone.txt']).toBe(before.uncommitted['gone.txt'])
  })

  it('stamps committed files by their diff against the base alone, not the working file', async () => {
    const r = repo()
    r.write('a.txt', 'a\n')
    r.commit('init')
    r.git('switch', '-q', '-c', 'feat')
    r.write('a.txt', 'a\nb\n')
    r.commit('feat')
    const before = await stamps(r.dir, 'main')
    expect(before.committed['a.txt']).toBe('M:1:0:-:-')
    r.write('a.txt', 'a\nb\nc\n')
    expect((await stamps(r.dir, 'main')).committed['a.txt']).toBe(before.committed['a.txt'])
  })
})

describe('reviewDiff', () => {
  it('names files with non-ASCII paths as they are (git quotes them by default)', async () => {
    const r = repo()
    r.write('中文.ts', 'a\n')
    r.write('ascii.ts', 'a\n')
    r.commit('init')
    r.write('中文.ts', 'b\n')
    r.write('ascii.ts', 'b\n')
    r.write('新文件.ts', 'c\n')
    const diff = await reviewDiff(r.dir, null)
    expect(parseUnifiedDiffFiles(diff!.text).map((f) => f.path).sort()).toEqual(['ascii.ts', '中文.ts', '新文件.ts'].sort())
  })
})

describe('sshCommandFor', () => {
  it('adds BatchMode to the user’s own ssh command instead of replacing it', () => {
    expect(sshCommandFor({}, '')).toBe('ssh -o BatchMode=yes')
    expect(sshCommandFor({}, 'ssh -i ~/.ssh/work')).toBe('ssh -i ~/.ssh/work -o BatchMode=yes')
    expect(sshCommandFor({ GIT_SSH_COMMAND: 'ssh -F cfg' }, 'ssh -i x')).toBe('ssh -F cfg -o BatchMode=yes')
    expect(sshCommandFor({ GIT_SSH: '/usr/local/bin/myssh' }, '')).toBeNull()
  })
})
