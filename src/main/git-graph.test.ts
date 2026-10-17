// Runs the Git view's main-process functions against throwaway repos.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), on: vi.fn() } }))

const { changes, fileDiff, logPage, sshCommandFor } = await import('./git-graph')

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
    expect(result?.uncommitted).toEqual([
      { path: 'nested', status: 'A', added: null, removed: null, untracked: true, nested: true },
      { path: 'new/file.ts', status: 'A', added: 3, removed: 0, untracked: true },
      { path: 'tracked.txt', status: 'M', added: 2, removed: 1 }
    ])
    expect(result).toMatchObject({ base: null, untrackedOmitted: 0 })
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
