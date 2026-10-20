// PR / CI status and 创建 PR (PRD F16) against real git repositories in a temp folder and a fake `gh` (a shell
// script first on the PATH) that answers from files and logs every call. origin's fetch URL says github.com/acme/widget
// (where gh would look); its push URL is a local bare repository, so pushes really happen.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const base = realpathSync(mkdtempSync(join(tmpdir(), 'tr-pr-')))
const bin = join(base, 'bin')
const ghDir = join(base, 'gh')
mkdirSync(bin)
mkdirSync(ghDir)

// Each call is logged as "---" then one argument per line.
writeFileSync(
  join(bin, 'gh'),
  `#!/bin/sh
d="$FAKE_GH_DIR"
printf '%s\\n' "---" "$@" >> "$d/calls"
case "$1 $2" in
  "auth status")
    if [ -f "$d/signed-out" ]; then echo "You are not logged into any GitHub hosts. To log in, run: gh auth login" >&2; exit 1; fi
    echo "github.com: Logged in"; exit 0 ;;
  "pr list")
    if [ -f "$d/rate-limit" ]; then echo "GraphQL: API rate limit exceeded for user ID 1." >&2; exit 1; fi
    cat "$d/pr-list.json" 2>/dev/null || echo '[]'; exit 0 ;;
  "pr create")
    [ -f "$d/after-create.json" ] && cp "$d/after-create.json" "$d/pr-list.json"
    echo "https://github.com/acme/widget/pull/7"; exit 0 ;;
  "run view")
    cat "$d/log-failed.txt"; exit 0 ;;
esac
echo "unknown command $*" >&2
exit 1
`
)
chmodSync(join(bin, 'gh'), 0o755)
process.env.FAKE_GH_DIR = ghDir

const roots = new Set<string>()
const confirmAnswer = vi.fn(async (_options: unknown, _parent?: unknown) => true)
vi.mock('./workspace-store', () => ({ isProjectRoot: (path: string) => roots.has(path) }))
vi.mock('./confirm', () => ({ confirm: (options: unknown, parent?: unknown) => confirmAnswer(options, parent) }))
vi.mock('./agents-installed', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./agents-installed')>()),
  userLoginPath: async () => `${bin}:/usr/bin:/bin`
}))
vi.mock('electron', () => ({
  app: { on: () => {} },
  ipcMain: { handle: () => {}, on: () => {} },
  BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null, fromWebContents: () => null }
}))

const { checkWorktree, ciFailure, createPullRequest, detectGh, statusesFor, unwatch, watchTargets } = await import('./pull-requests')

const identity = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
Object.assign(process.env, identity, { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'commit.gpgsign', GIT_CONFIG_VALUE_0: 'false' })
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] }).toString()
const commit = (cwd: string, file: string, text: string, message: string) => {
  writeFileSync(join(cwd, file), text)
  git(cwd, 'add', '.')
  git(cwd, 'commit', '-q', '-m', message)
}

let counter = 0
/** main (pushed) and a worktree on `feat` with two commits, not pushed. */
function setup(): { root: string; wt: string; bare: string } {
  const n = ++counter
  const root = join(base, `repo-${n}`)
  const bare = join(base, `bare-${n}.git`)
  mkdirSync(root)
  git(base, 'init', '-q', '--bare', '-b', 'main', bare)
  git(root, 'init', '-q', '-b', 'main')
  commit(root, 'a.txt', 'a\n', 'init')
  git(root, 'remote', 'add', 'origin', 'https://github.com/acme/widget.git')
  git(root, 'config', 'remote.origin.pushurl', bare)
  git(root, 'push', '-q', '-u', 'origin', 'main')
  roots.add(root)
  const wt = join(base, `wt-${n}`)
  git(root, 'worktree', 'add', '-q', '-b', 'feat', wt)
  git(root, 'config', 'branch.feat.base', 'main')
  commit(wt, 'b.txt', 'b\n', 'Make nav sticky')
  commit(wt, 'c.txt', 'c\n', 'Test nav')
  return { root, wt, bare }
}

/** Every logged gh call as its argument list. */
function calls(): string[][] {
  if (!existsSync(join(ghDir, 'calls'))) return []
  return readFileSync(join(ghDir, 'calls'), 'utf8')
    .split('---\n')
    .filter(Boolean)
    .map((call) => call.replace(/\n$/, '').split('\n'))
}
const ghCalls = (sub: string) => calls().filter((call) => `${call[0]} ${call[1]}` === sub)

const prJson = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify([
    {
      number: 7,
      state: 'OPEN',
      isDraft: false,
      url: 'https://github.com/acme/widget/pull/7',
      title: '导航吸顶',
      isCrossRepository: false,
      headRepositoryOwner: { login: 'acme' },
      statusCheckRollup: [
        { __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'https://github.com/acme/widget/actions/runs/11/job/22' },
        { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: 'https://github.com/acme/widget/actions/runs/11/job/23' }
      ],
      ...overrides
    }
  ])

function watcher() {
  const sent: unknown[] = []
  return { sent, send: (_channel: string, payload: unknown) => sent.push(payload), isDestroyed: () => false }
}

beforeEach(() => {
  for (const name of ['calls', 'signed-out', 'rate-limit', 'pr-list.json', 'after-create.json', 'log-failed.txt']) rmSync(join(ghDir, name), { force: true })
  confirmAnswer.mockReset()
  confirmAnswer.mockResolvedValue(true)
})

afterAll(() => rmSync(base, { recursive: true, force: true }))

describe('gh', () => {
  it('is ready when logged in, signed out when gh says so, missing when switched off', async () => {
    expect(await detectGh(true)).toBe('ready')
    expect(ghCalls('auth status')[0]).toEqual(['auth', 'status', '--active'])
    writeFileSync(join(ghDir, 'signed-out'), '')
    expect(await detectGh(true)).toBe('signed-out')
    process.env.TR_GH = 'off'
    expect(await detectGh(true)).toBe('missing')
    delete process.env.TR_GH
    rmSync(join(ghDir, 'signed-out'))
    expect(await detectGh(true)).toBe('ready')
  })
})

describe('status', () => {
  it('never asks gh about a branch without an upstream', async () => {
    const { root, wt } = setup()
    const w = watcher()
    watchTargets(w, [{ root, worktree: wt }])
    const status = await checkWorktree(wt)
    expect(status).toMatchObject({ worktree: wt, branch: 'feat', pr: null })
    expect(ghCalls('pr list')).toHaveLength(0)
    unwatch(w)
  })

  it('reads the PR of a pushed branch from its own repository, with its checks', async () => {
    const { root, wt } = setup()
    git(wt, 'push', '-q', '-u', 'origin', 'feat')
    writeFileSync(join(ghDir, 'pr-list.json'), prJson())
    const w = watcher()
    watchTargets(w, [{ root, worktree: wt }])
    const status = await checkWorktree(wt)
    expect(status?.pr).toMatchObject({ number: 7, state: 'open', checks: { state: 'failing', total: 2, passed: 1 } })
    expect(status?.pr?.checks.failing).toEqual([{ name: 'test', runId: 11, jobId: 22 }])
    const list = ghCalls('pr list')[0]!
    expect(list).toContain('--repo=github.com/acme/widget')
    expect(list).toContain('--head=feat')
    expect(list).toContain('--state=all')
    // The window got it, once: an unchanged answer is not sent again.
    expect(w.sent).toHaveLength(1)
    await checkWorktree(wt)
    expect(w.sent).toHaveLength(1)
    expect(statusesFor(w)).toHaveLength(1)
    unwatch(w)
  })

  it('does not ask about the base branch, and refuses worktrees of other projects', async () => {
    const { root } = setup()
    const other = setup()
    const w = watcher()
    watchTargets(w, [
      { root, worktree: root },
      { root, worktree: other.wt },
      { root: join(base, 'not-a-project'), worktree: other.wt }
    ])
    expect(await checkWorktree(root)).toMatchObject({ branch: 'main', pr: null })
    expect(await checkWorktree(other.wt)).toMatchObject({ branch: null, pr: null })
    expect(statusesFor(w).map((s) => s.worktree).sort()).toEqual([other.wt, root].sort())
    expect(ghCalls('pr list')).toHaveLength(0)
    unwatch(w)
  })
})

describe('创建 PR', () => {
  it('asks before pushing a branch that was never pushed, then pushes and creates the PR', async () => {
    const { root, wt, bare } = setup()
    writeFileSync(join(ghDir, 'after-create.json'), prJson({ statusCheckRollup: [] }))
    const w = watcher()
    watchTargets(w, [{ root, worktree: wt }])
    const result = await createPullRequest({ root, worktree: wt, title: '导航吸顶\n' })
    expect(result).toEqual({ ok: true, url: 'https://github.com/acme/widget/pull/7', number: 7, existed: false })
    expect(confirmAnswer).toHaveBeenCalledTimes(1)
    expect(confirmAnswer.mock.calls[0]?.[0]).toMatchObject({ message: '把分支 feat 推送到 origin？', confirmLabel: '推送并创建 PR' })
    expect(git(bare, 'rev-parse', 'refs/heads/feat').trim()).toBe(git(wt, 'rev-parse', 'HEAD').trim())
    expect(git(wt, 'rev-parse', '--abbrev-ref', '@{u}').trim()).toBe('origin/feat')
    const create = ghCalls('pr create')[0]!
    expect(create).toEqual(
      expect.arrayContaining(['--repo=github.com/acme/widget', '--head=feat', '--base=main', '--title=导航吸顶', '--body=- Make nav sticky'])
    )
    expect(create).toContain('- Test nav')
    // The new PR shows up without waiting for the next poll.
    expect(w.sent.at(-1)).toMatchObject({ worktree: wt, pr: { number: 7, checks: { state: 'none' } } })
    unwatch(w)
  })

  it('pushes nothing and creates nothing when the user says no', async () => {
    const { root, wt, bare } = setup()
    confirmAnswer.mockResolvedValue(false)
    const result = await createPullRequest({ root, worktree: wt, title: 't' })
    expect(result).toMatchObject({ ok: false, reason: 'declined' })
    expect(() => git(bare, 'rev-parse', '--verify', '--quiet', 'refs/heads/feat')).toThrow()
    expect(ghCalls('pr create')).toHaveLength(0)
  })

  it('pushes new commits to the upstream without asking, and returns the open PR the branch already has', async () => {
    const { root, wt, bare } = setup()
    git(wt, 'push', '-q', '-u', 'origin', 'feat')
    writeFileSync(join(ghDir, 'pr-list.json'), prJson())
    expect(await createPullRequest({ root, worktree: wt, title: 't' })).toMatchObject({ ok: true, number: 7, existed: true })
    expect(ghCalls('pr create')).toHaveLength(0)

    rmSync(join(ghDir, 'pr-list.json'))
    commit(wt, 'd.txt', 'd\n', 'One more')
    expect(await createPullRequest({ root, worktree: wt, title: 't' })).toMatchObject({ ok: true, existed: false })
    expect(confirmAnswer).not.toHaveBeenCalled()
    expect(git(bare, 'rev-parse', 'refs/heads/feat').trim()).toBe(git(wt, 'rev-parse', 'HEAD').trim())
  })

  it('refuses the base branch, a branch with nothing new, a missing gh and bad input', async () => {
    const { root, wt } = setup()
    expect(await createPullRequest({ root, worktree: root, title: 't' })).toMatchObject({ ok: false, reason: 'blocked', message: '这是基线分支本身，没有可以提 PR 的改动' })
    git(wt, 'reset', '-q', '--hard', 'main')
    expect(await createPullRequest({ root, worktree: wt, title: 't' })).toMatchObject({ ok: false, message: '分支没有比 main 新的提交' })
    expect(await createPullRequest({ root: join(base, 'elsewhere'), worktree: wt, title: 't' })).toMatchObject({ ok: false, message: '请求无效' })
    expect(await createPullRequest({ root, worktree: 'relative', title: 't' })).toMatchObject({ ok: false, message: '请求无效' })
    writeFileSync(join(ghDir, 'signed-out'), '')
    expect(await createPullRequest({ root, worktree: wt, title: 't' })).toMatchObject({ ok: false, message: 'gh 还没有登录：在终端运行 gh auth login' })
    rmSync(join(ghDir, 'signed-out'))
    await detectGh(true)
    expect(ghCalls('pr create')).toHaveLength(0)
  })
})

describe('让 agent 修复', () => {
  it("reads the failing job's log and gives back the check names and the cleaned tail", async () => {
    const { root, wt } = setup()
    git(wt, 'push', '-q', '-u', 'origin', 'feat')
    writeFileSync(join(ghDir, 'pr-list.json'), prJson())
    writeFileSync(join(ghDir, 'log-failed.txt'), 'check\tRun npm test\t2026-10-20T17:15:15.9535000Z expected 1 to be 2\ncheck\tRun npm test\t2026-10-20T17:15:16.0000000Z ##[error]Process completed with exit code 1.\n')
    const w = watcher()
    watchTargets(w, [{ root, worktree: wt }])
    await checkWorktree(wt)
    const failure = await ciFailure(wt)
    expect(failure).toEqual({ number: 7, checks: ['test'], log: 'expected 1 to be 2\n##[error]Process completed with exit code 1.' })
    expect(ghCalls('run view')[0]).toEqual(['run', 'view', '--repo=github.com/acme/widget', '--job=22', '--log-failed'])
    expect(await ciFailure(join(base, 'not-watched'))).toBeNull()
    unwatch(w)
  })
})

// Last: a rate limit pauses every gh call for a while.
describe('rate limits', () => {
  it('keeps the last answer, counts the error and stops asking gh for a while', async () => {
    const { root, wt } = setup()
    git(wt, 'push', '-q', '-u', 'origin', 'feat')
    writeFileSync(join(ghDir, 'pr-list.json'), prJson())
    const w = watcher()
    watchTargets(w, [{ root, worktree: wt }])
    await checkWorktree(wt)
    writeFileSync(join(ghDir, 'rate-limit'), '')
    const before = ghCalls('pr list').length
    expect((await checkWorktree(wt))?.pr?.number).toBe(7)
    expect(ghCalls('pr list')).toHaveLength(before + 1)
    await checkWorktree(wt)
    expect(ghCalls('pr list')).toHaveLength(before + 1)
    unwatch(w)
  })
})
