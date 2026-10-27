// PR / CI status and 创建 PR (PRD F16) against real git repositories in a temp folder and a fake `gh` (a shell
// script first on the PATH) that answers from files and logs every call. origin's fetch URL says github.com/acme/widget
// (where gh would look); its push URL is a local bare repository, so pushes really happen.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
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
  "pr merge")
    if [ -f "$d/merge-fail" ]; then cat "$d/merge-fail" >&2; exit 1; fi
    [ -f "$d/after-merge.json" ] && cp "$d/after-merge.json" "$d/pr-list.json"
    exit 0 ;;
  "api graphql")
    case "$*" in
      *"--input -"*)
        n=$(ls "$d" | grep -c '^input-')
        cat > "$d/input-$n"
        if [ -f "$d/mutation-fail" ] && grep -qF '"threads":[{' "$d/input-$n"; then cat "$d/mutation-fail" >&2; exit 1; fi
        echo '{"data":{}}'; exit 0 ;;
    esac
    cat "$d/graphql.json" 2>/dev/null || echo '{"data":null}'; exit 0 ;;
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

const { cancelMerge, catchUpBase, checkWorktree, ciFailure, commitWorktree, createPullRequest, detectGh, mergePullRequest, prDraft, pushBranch, statusesFor, unwatch, watchTargets } =
  await import('./pull-requests')

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

/** What PR_DETAILS_QUERY returns for PR #7. */
const detailsJson = (o: { headOid: string; autoMergeAllowed?: boolean; requiredState?: string; threads?: unknown[]; inMergeQueue?: boolean }) =>
  JSON.stringify({
    data: {
      viewer: { login: 'jacob' },
      repository: {
        autoMergeAllowed: o.autoMergeAllowed ?? false,
        deleteBranchOnMerge: false,
        squashMergeAllowed: true,
        mergeCommitAllowed: true,
        rebaseMergeAllowed: false,
        viewerDefaultMergeMethod: 'SQUASH',
        pullRequest: {
          id: 'PR_kw7',
          headRefOid: o.headOid,
          reviewDecision: 'REVIEW_REQUIRED',
          mergeStateStatus: 'BLOCKED',
          isInMergeQueue: o.inMergeQueue ?? false,
          autoMergeRequest: null,
          commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [{ __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: o.requiredState ?? 'SUCCESS', isRequired: true }] } } } }] },
          reviewThreads: { nodes: o.threads ?? [] },
          comments: { nodes: [] },
          reviews: { nodes: [] }
        }
      }
    }
  })

const thread = (id: string, path = 'b.txt') => ({
  id,
  isResolved: false,
  isOutdated: false,
  path,
  line: 1,
  startLine: null,
  diffSide: 'RIGHT',
  comments: { nodes: [{ author: { login: 'coderabbitai', __typename: 'Bot' }, body: 'Rename this', url: 'https://github.com/acme/widget/pull/7#r1', createdAt: '2026-10-21T01:00:00Z' }] }
})

/** A worktree whose branch is pushed and has open PR #7 with passing checks; fetches never reach the network. */
function pushedWithPr(details: Partial<Parameters<typeof detailsJson>[0]> = {}) {
  const made = setup()
  git(made.wt, 'push', '-q', '-u', 'origin', 'feat')
  git(made.root, 'config', 'protocol.https.allow', 'never')
  const head = git(made.wt, 'rev-parse', 'HEAD').trim()
  writeFileSync(join(ghDir, 'pr-list.json'), prJson({ statusCheckRollup: [{ __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }] }))
  writeFileSync(join(ghDir, 'graphql.json'), detailsJson({ headOid: head, ...details }))
  const w = watcher()
  watchTargets(w, [{ root: made.root, worktree: made.wt }])
  return { ...made, head, w }
}

beforeEach(() => {
  for (const name of ['calls', 'signed-out', 'rate-limit', 'pr-list.json', 'after-create.json', 'log-failed.txt', 'graphql.json', 'merge-fail', 'after-merge.json', 'mutation-fail'])
    rmSync(join(ghDir, name), { force: true })
  for (const name of readdirSync(ghDir)) if (name.startsWith('input-')) rmSync(join(ghDir, name), { force: true })
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

  it('never pushes to main when the branch was started from origin/main and tracks it', async () => {
    const { root, wt, bare } = setup()
    // As `git switch -c feat origin/main` leaves it: upstream origin/main.
    git(root, 'config', 'branch.feat.remote', 'origin')
    git(root, 'config', 'branch.feat.merge', 'refs/heads/main')
    const mainBefore = git(bare, 'rev-parse', 'refs/heads/main').trim()
    writeFileSync(join(ghDir, 'after-create.json'), prJson({ statusCheckRollup: [] }))
    expect(await prDraft({ root, worktree: wt })).toMatchObject({ ok: true, pushed: false })
    expect(await createPullRequest({ root, worktree: wt, title: 't' })).toMatchObject({ ok: true })
    expect(git(bare, 'rev-parse', 'refs/heads/main').trim()).toBe(mainBefore)
    expect(git(bare, 'rev-parse', 'refs/heads/feat').trim()).toBe(git(wt, 'rev-parse', 'HEAD').trim())
    expect(ghCalls('pr create')[0]).toContain('--head=feat')
    expect(git(wt, 'rev-parse', '--abbrev-ref', '@{u}').trim()).toBe('origin/feat')
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

describe('PR details (PRD F16 v1.63)', () => {
  it('reads unresolved threads, review state and merge options of an open PR in one GraphQL call', async () => {
    const { wt, w } = pushedWithPr({ threads: [thread('T1'), { ...thread('T2'), isResolved: true }] })
    const status = await checkWorktree(wt)
    expect(status?.pr?.details).toMatchObject({
      reviewDecision: 'review-required',
      mergeState: 'blocked',
      required: { total: 1, failing: [], pending: 0 },
      repo: { methods: ['squash', 'merge'], defaultMethod: 'squash', autoMergeAllowed: false },
      viewer: 'jacob'
    })
    expect(status?.pr?.details?.threads.map((t) => t.id)).toEqual(['T1'])
    expect(status?.pr?.details?.threads[0]?.comments[0]?.author).toEqual({ login: 'coderabbitai', bot: true })
    const query = ghCalls('api graphql')[0]!
    expect(query).toEqual(expect.arrayContaining(['--hostname=github.com', 'owner=acme', 'name=widget', 'number=7']))
    unwatch(w)
  })
})

describe('合并 PR (PRD F16 v1.63)', () => {
  it('merges now, pinned to the head Wavi checked, never with --admin or --delete-branch', async () => {
    const { root, wt, head, bare, w } = pushedWithPr()
    writeFileSync(join(ghDir, 'after-merge.json'), prJson({ state: 'MERGED' }))
    const result = await mergePullRequest({ root, worktree: wt, method: 'squash', when: 'now', deleteRemoteBranch: true })
    expect(result).toMatchObject({ ok: true, outcome: 'merged', message: '已合并 PR #7' })
    const merge = ghCalls('pr merge')[0]!
    expect(merge).toEqual(['pr', 'merge', '7', '--repo=github.com/acme/widget', '--squash', `--match-head-commit=${head}`])
    expect(merge).toEqual(expect.arrayContaining(['7', '--squash', `--match-head-commit=${head}`]))
    expect(merge).not.toContain('--admin')
    expect(merge).not.toContain('--delete-branch')
    expect(merge).not.toContain('--auto')
    // The remote branch went; the local one stays.
    expect(() => git(bare, 'rev-parse', '--verify', '--quiet', 'refs/heads/feat')).toThrow()
    expect(git(wt, 'rev-parse', 'HEAD').trim()).toBe(head)
    unwatch(w)
  })

  it('refuses when the PR has commits that are not local, a disallowed method, failing required checks or a draft', async () => {
    const { root, wt, w } = pushedWithPr()
    writeFileSync(join(ghDir, 'graphql.json'), detailsJson({ headOid: 'f'.repeat(40) }))
    expect(await mergePullRequest({ root, worktree: wt, method: 'squash', when: 'now', deleteRemoteBranch: false })).toMatchObject({ ok: false, reason: 'blocked', message: expect.stringContaining('先拉取') })
    const head = git(wt, 'rev-parse', 'HEAD').trim()
    writeFileSync(join(ghDir, 'graphql.json'), detailsJson({ headOid: head, requiredState: 'FAILURE' }))
    expect(await mergePullRequest({ root, worktree: wt, method: 'rebase', when: 'now', deleteRemoteBranch: false })).toMatchObject({
      ok: false,
      message: '必需的检查没通过：test；这个仓库不允许这种合并方式'
    })
    writeFileSync(join(ghDir, 'graphql.json'), detailsJson({ headOid: head }))
    writeFileSync(join(ghDir, 'pr-list.json'), prJson({ isDraft: true }))
    expect(await mergePullRequest({ root, worktree: wt, method: 'squash', when: 'now', deleteRemoteBranch: false })).toMatchObject({ ok: false, message: expect.stringContaining('草稿') })
    expect(ghCalls('pr merge')).toHaveLength(0)
    expect(await mergePullRequest({ root, worktree: wt, method: 'nope', when: 'now', deleteRemoteBranch: false })).toMatchObject({ message: '请求无效' })
    unwatch(w)
  })

  it('turns on GitHub auto-merge when the repository allows it, and can turn it off again', async () => {
    const { root, wt, head, w } = pushedWithPr({ autoMergeAllowed: true })
    expect(await mergePullRequest({ root, worktree: wt, method: 'merge', when: 'when-ready', deleteRemoteBranch: false })).toMatchObject({ ok: true, outcome: 'auto-merge' })
    expect(ghCalls('pr merge')[0]).toEqual(expect.arrayContaining(['--merge', `--match-head-commit=${head}`, '--auto']))
    expect(await cancelMerge({ root, worktree: wt })).toMatchObject({ ok: true, outcome: 'cancelled' })
    expect(ghCalls('pr merge')[1]).toEqual(expect.arrayContaining(['--disable-auto']))
    unwatch(w)
  })

  it('without auto-merge, 通过后合并 is refused with a message and nothing reaches GitHub', async () => {
    const { root, wt, w } = pushedWithPr({ requiredState: 'IN_PROGRESS' })
    expect(await mergePullRequest({ root, worktree: wt, method: 'squash', when: 'when-ready', deleteRemoteBranch: false })).toEqual({
      ok: false,
      reason: 'blocked',
      message: '仓库没开 auto-merge：在 GitHub 设置里打开后才能检查通过后合并'
    })
    expect(ghCalls('pr merge')).toHaveLength(0)
    unwatch(w)
  })

  it('does not push local commits when their checks could only be waited for by Wavi', async () => {
    const { root, wt, bare, head, w } = pushedWithPr()
    commit(wt, 'e.txt', 'e\n', 'Late fix')
    expect(await mergePullRequest({ root, worktree: wt, method: 'squash', when: 'now', deleteRemoteBranch: false })).toMatchObject({ ok: false, reason: 'blocked', message: expect.stringContaining('auto-merge') })
    expect(git(bare, 'rev-parse', 'refs/heads/feat').trim()).toBe(head)
    expect(ghCalls('pr merge')).toHaveLength(0)
    unwatch(w)
  })

  it('pushes local commits first and then turns on auto-merge pinned to the new head instead of merging the old one', async () => {
    const { root, wt, bare, w } = pushedWithPr({ autoMergeAllowed: true })
    commit(wt, 'e.txt', 'e\n', 'Late fix')
    const local = git(wt, 'rev-parse', 'HEAD').trim()
    expect(await mergePullRequest({ root, worktree: wt, method: 'squash', when: 'now', deleteRemoteBranch: false })).toMatchObject({ ok: true, outcome: 'auto-merge' })
    expect(git(bare, 'rev-parse', 'refs/heads/feat').trim()).toBe(local)
    expect(ghCalls('pr merge')).toHaveLength(1)
    expect(ghCalls('pr merge')[0]).toEqual(expect.arrayContaining(['--squash', `--match-head-commit=${local}`, '--auto']))
    unwatch(w)
  })
})

describe('创建 PR 面板 (PRD F16 v1.63)', () => {
  it('starts from the commit subjects, or the repository PR template when there is one', async () => {
    const { root, wt } = setup()
    expect(await prDraft({ root, worktree: wt })).toEqual({
      ok: true,
      branch: 'feat',
      base: 'main',
      remote: 'origin',
      pushed: false,
      body: '- Make nav sticky\n- Test nav',
      fromTemplate: false,
      subjects: ['Make nav sticky', 'Test nav'],
      files: [],
      filesOmitted: 0,
      unpushed: null,
      remoteAhead: 0
    })
    mkdirSync(join(wt, '.github'))
    writeFileSync(join(wt, '.github', 'PULL_REQUEST_TEMPLATE.md'), '## 改了什么\n\n## 怎么测\n')
    git(wt, 'add', '.')
    git(wt, 'commit', '-q', '-m', 'template')
    expect(await prDraft({ root, worktree: wt })).toMatchObject({ ok: true, body: '## 改了什么\n\n## 怎么测\n', fromTemplate: true })
    expect(await prDraft({ root, worktree: root })).toEqual({ ok: false, message: '这是基线分支本身，没有可以提 PR 的改动' })
    expect(await prDraft({ root: join(base, 'nope'), worktree: wt })).toEqual({ ok: false, message: '请求无效' })
  })

  it('creates with the sheet body and draft flag, without asking again before the first push', async () => {
    const { root, wt, bare } = setup()
    writeFileSync(join(ghDir, 'after-create.json'), prJson({ statusCheckRollup: [] }))
    const result = await createPullRequest({ root, worktree: wt, title: '导航', body: '正文\n\n<!-- wavi -->\n检查\n<!-- /wavi -->', draft: true, pushApproved: true })
    expect(result).toMatchObject({ ok: true, number: 7 })
    expect(confirmAnswer).not.toHaveBeenCalled()
    expect(git(bare, 'rev-parse', 'refs/heads/feat').trim()).toBe(git(wt, 'rev-parse', 'HEAD').trim())
    const create = ghCalls('pr create')[0]!
    expect(create).toContain('--draft')
    expect(create.join('\n')).toContain('--body=正文\n\n<!-- wavi -->')
  })
})

describe('提交 / 推送 (PRD F16 v1.68)', () => {
  it('lists the uncommitted files and what is not pushed yet', async () => {
    const { root, wt } = setup()
    git(wt, 'push', '-q', '-u', 'origin', 'feat')
    commit(wt, 'd.txt', 'd\n', 'Not pushed')
    writeFileSync(join(wt, 'b.txt'), 'b2\n')
    writeFileSync(join(wt, 'new.txt'), 'n\n')
    git(wt, 'mv', 'c.txt', 'moved.txt')
    rmSync(join(wt, 'a.txt'))
    expect(await prDraft({ root, worktree: wt })).toMatchObject({
      ok: true,
      pushed: true,
      unpushed: 1,
      remoteAhead: 0,
      subjects: ['Make nav sticky', 'Test nav', 'Not pushed'],
      files: [
        { path: 'a.txt', status: 'D' },
        { path: 'b.txt', status: 'M' },
        { path: 'moved.txt', status: 'R', oldPath: 'c.txt' },
        { path: 'new.txt', status: 'A', untracked: true }
      ]
    })
  })

  it('commits exactly the ticked files with the message, and leaves the rest as they were', async () => {
    const { root, wt } = setup()
    writeFileSync(join(wt, 'b.txt'), 'b2\n')
    writeFileSync(join(wt, 'new.txt'), 'n\n')
    git(wt, 'mv', 'c.txt', 'moved.txt')
    rmSync(join(wt, 'a.txt'))
    // Staged by the agent, not ticked: stays staged and out of the commit.
    writeFileSync(join(wt, 'staged.txt'), 's\n')
    git(wt, 'add', 'staged.txt')
    const result = await commitWorktree({ root, worktree: wt, message: '  Sticky nav, take two\r\n\nWith a body\u0007  \n', paths: ['a.txt', 'b.txt', 'moved.txt', 'new.txt'] })
    expect(result).toEqual({ ok: true, commit: git(wt, 'rev-parse', '--short', 'HEAD').trim(), subject: 'Sticky nav, take two' })
    expect(git(wt, 'log', '-1', '--format=%B').trim()).toBe('Sticky nav, take two\n\nWith a body')
    expect(git(wt, 'show', '--name-status', '--format=', 'HEAD').trim().split('\n').sort()).toEqual(['A\tnew.txt', 'D\ta.txt', 'M\tb.txt', 'R100\tc.txt\tmoved.txt'].sort())
    expect(git(wt, 'status', '--porcelain=v1').trim()).toBe('A  staged.txt')
  })

  it("runs the repository's hooks and gives back their output when one fails", async () => {
    const { root, wt } = setup()
    const hooks = join(base, `hooks-${counter}`)
    mkdirSync(hooks)
    writeFileSync(join(hooks, 'pre-commit'), '#!/bin/sh\necho "lint: 2 problems in b.txt" >&2\nexit 1\n')
    chmodSync(join(hooks, 'pre-commit'), 0o755)
    git(root, 'config', 'core.hooksPath', hooks)
    writeFileSync(join(wt, 'b.txt'), 'b2\n')
    const head = git(wt, 'rev-parse', 'HEAD').trim()
    expect(await commitWorktree({ root, worktree: wt, message: 'x', paths: ['b.txt'] })).toMatchObject({ ok: false, reason: 'failed', output: 'lint: 2 problems in b.txt' })
    expect(git(wt, 'rev-parse', 'HEAD').trim()).toBe(head)
  })

  it('refuses the base branch, a detached HEAD, conflicts, files with no changes and bad input', async () => {
    const { root, wt } = setup()
    writeFileSync(join(root, 'a.txt'), 'a2\n')
    expect(await commitWorktree({ root, worktree: root, message: 'x', paths: ['a.txt'] })).toMatchObject({ ok: false, message: '这是基线分支本身：在会话的 worktree 里提交' })
    expect(await commitWorktree({ root, worktree: wt, message: 'x', paths: ['nothing.txt'] })).toMatchObject({ ok: false, message: '勾选的文件已经没有改动了' })
    for (const bad of [{ message: '  \n', paths: ['b.txt'] }, { message: 'x', paths: [] }, { message: 'x', paths: ['../a.txt'] }, { message: 'x', paths: ['/etc/hosts'] }]) {
      expect(await commitWorktree({ root, worktree: wt, ...bad })).toMatchObject({ ok: false, message: '请求无效' })
    }
    // A conflict anywhere in the worktree: nothing is committed until it is resolved.
    git(wt, 'switch', '-q', '-c', 'side', 'HEAD~1')
    commit(wt, 'c.txt', 'other\n', 'Other c')
    git(wt, 'switch', '-q', 'feat')
    try {
      git(wt, 'merge', '-q', 'side')
    } catch {
      // the conflict is the point
    }
    writeFileSync(join(wt, 'b.txt'), 'b2\n')
    expect(await commitWorktree({ root, worktree: wt, message: 'x', paths: ['b.txt'] })).toMatchObject({ ok: false, message: '有没解决的冲突：先解决再提交' })
    git(wt, 'merge', '--abort')
    git(wt, 'switch', '-q', '--detach')
    expect(await commitWorktree({ root, worktree: wt, message: 'x', paths: ['b.txt'] })).toMatchObject({ ok: false, message: '处于分离 HEAD：先切到一个分支再提交' })
  })

  it('pushes a pushed branch to its upstream, and refuses one that was never pushed', async () => {
    const { root, wt, bare } = pushedWithPr()
    expect(await pushBranch({ root, worktree: wt })).toEqual({ ok: true, outcome: 'pushed', message: '没有要推送的提交' })
    commit(wt, 'd.txt', 'd\n', 'One more')
    expect(await pushBranch({ root, worktree: wt })).toMatchObject({ ok: true, outcome: 'pushed', message: '已推送到 origin/feat' })
    expect(git(bare, 'rev-parse', 'refs/heads/feat').trim()).toBe(git(wt, 'rev-parse', 'HEAD').trim())
    expect(await pushBranch({ root, worktree: root })).toMatchObject({ ok: false, message: '这是基线分支本身：Wavi 不往基线分支推送' })
    const fresh = setup()
    expect(await pushBranch({ root: fresh.root, worktree: fresh.wt })).toMatchObject({ ok: false, message: '分支还没有推送过：用「创建 PR」推送' })
    // Someone else pushed to the branch: git refuses, and Wavi says what to do instead of git's words.
    const other = join(base, `other-${counter}`)
    git(base, 'clone', '-q', '-b', 'feat', bare, other)
    commit(other, 'e.txt', 'e\n', 'From elsewhere')
    git(other, 'push', '-q', 'origin', 'feat')
    commit(wt, 'f.txt', 'f\n', 'Mine')
    expect(await pushBranch({ root, worktree: wt })).toMatchObject({ ok: false, message: 'origin 上的分支有本地没有的提交：先拉取或 rebase，再推送' })
  })
})

describe('status · local head (PRD F16 v1.63)', () => {
  it('says whether the PR is the local branch', async () => {
    const { wt, head, w } = pushedWithPr({ requiredState: 'IN_PROGRESS' })
    expect((await checkWorktree(wt))?.local).toEqual({ head, remoteAhead: false })
    writeFileSync(join(ghDir, 'graphql.json'), detailsJson({ headOid: 'f'.repeat(40) }))
    expect((await checkWorktree(wt))?.local).toEqual({ head, remoteAhead: true })
    unwatch(w)
  })
})

describe('catching up the base after a merge (v1.65)', () => {
  it('fetches the base and fast-forwards a clean checkout, and leaves a dirty one alone', async () => {
    const { root, bare } = setup()
    git(root, 'remote', 'set-url', 'origin', bare)
    const other = join(base, `clone-${Date.now()}`)
    git(base, 'clone', '-q', bare, other)
    commit(other, 'merged.txt', 'm\n', 'Merge pull request #7')
    git(other, 'push', '-q', 'origin', 'main')
    await catchUpBase(root, 'origin', 'main')
    expect(git(root, 'rev-parse', 'main').trim()).toBe(git(bare, 'rev-parse', 'main').trim())

    commit(other, 'more.txt', 'x\n', 'Another merge')
    git(other, 'push', '-q', 'origin', 'main')
    writeFileSync(join(root, 'a.txt'), 'local edit\n')
    const before = git(root, 'rev-parse', 'main').trim()
    await catchUpBase(root, 'origin', 'main')
    expect(git(root, 'rev-parse', 'main').trim()).toBe(before)
    expect(git(root, 'rev-parse', 'origin/main').trim()).toBe(git(bare, 'rev-parse', 'main').trim())
  })
})

// Last: a rate limit pauses every gh call for a while.
describe('让 agent 修复 when the two calls disagree (v1.65)', () => {
  it('asks again when the details already see a required check fail that the list still has running', async () => {
    const { wt, w } = pushedWithPr({ requiredState: 'FAILURE' })
    writeFileSync(join(ghDir, 'pr-list.json'), prJson({ statusCheckRollup: [{ __typename: 'CheckRun', name: 'test', status: 'IN_PROGRESS', conclusion: null }] }))
    writeFileSync(join(ghDir, 'log-failed.txt'), 'test\tRun\t2026-10-21T00:00:00Z expected 1 to be 2\n')
    await checkWorktree(wt)
    // GitHub's list catches up a moment later; the throttle would otherwise keep the stale answer.
    writeFileSync(join(ghDir, 'pr-list.json'), prJson())
    expect(await ciFailure(wt)).toEqual({ number: 7, checks: ['test'], log: 'expected 1 to be 2' })
    unwatch(w)
  })
})

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
