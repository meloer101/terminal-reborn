// The merge chain's mechanical side (PRD F16 v1.78) against real git repositories in a temp folder, a local bare
// repository as the remote, and a fake `gh` (a shell script first on the PATH) that answers from files and logs every
// call. A "GitHub" repository's fetch URL says github.com/acme/widget (where gh would look; https is switched off so
// nothing reaches the network) while its push URL is the bare repository, so pushes really happen.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BaseCi } from '@shared/ship'

const base = realpathSync(mkdtempSync(join(tmpdir(), 'tr-ship-')))
const bin = join(base, 'bin')
const ghDir = join(base, 'gh')
mkdirSync(bin)
mkdirSync(ghDir)

// Each call is logged as "---" then one argument per line.
writeFileSync(
  join(bin, 'gh'),
  `#!/bin/sh
d="$FAKE_GH_DIR"
printf '%s\\n' "$@" > "$d/call-$$"
case "$1 $2" in
  "auth status")
    if [ -f "$d/signed-out" ]; then echo "You are not logged into any GitHub hosts. To log in, run: gh auth login" >&2; exit 1; fi
    echo "github.com"; echo "  ✓ Logged in to github.com account t (keyring)"
    [ -f "$d/hosts" ] && while read h; do echo "$h"; echo "  ✓ Logged in to $h account t (keyring)"; done < "$d/hosts"
    exit 0 ;;
  "pr list")
    cat "$d/pr-list.json" 2>/dev/null || echo '[]'; exit 0 ;;
  "run view")
    cat "$d/log-failed.txt"; exit 0 ;;
  "api graphql")
    cat "$d/graphql.json" 2>/dev/null || echo '{"data":null}'; exit 0 ;;
esac
if [ "$1" = "api" ]; then
  if [ -f "$d/api-fail" ]; then cat "$d/api-fail" >&2; exit 1; fi
  case "$2" in
    repos/*/protection)
      code=$(cat "$d/protection" 2>/dev/null || echo 404)
      if [ "$code" = 200 ]; then echo '{"url":"x"}'; exit 0; fi
      echo "gh: Branch not protected (HTTP $code)" >&2; exit 1 ;;
    repos/*/check-runs*)
      sha=$(echo "$2" | sed 's#.*/commits/\\([^/?]*\\)/.*#\\1#')
      f="$d/check-runs-$sha.json"; [ -f "$f" ] || f="$d/check-runs.json"
      cat "$f" 2>/dev/null || echo '{"total_count":0,"check_runs":[]}'; exit 0 ;;
    repos/*/status*)
      sha=$(echo "$2" | sed 's#.*/commits/\\([^/?]*\\)/.*#\\1#')
      f="$d/status-$sha.json"; [ -f "$f" ] || f="$d/status.json"
      cat "$f" 2>/dev/null || echo '{"state":"pending","statuses":[]}'; exit 0 ;;
  esac
fi
echo "unknown command $*" >&2
exit 1
`
)
chmodSync(join(bin, 'gh'), 0o755)
process.env.FAKE_GH_DIR = ghDir

const roots = new Set<string>()
const sent: { channel: string; payload: unknown }[] = []
const fakeWindow = { isDestroyed: () => false, webContents: { send: (channel: string, payload: unknown) => sent.push({ channel, payload }) } }
const seenDiffs: string[] = []
vi.mock('./workspace-store', () => ({ isProjectRoot: (path: string) => roots.has(path) }))
vi.mock('./confirm', () => ({ confirm: async () => true }))
vi.mock('./agents-installed', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./agents-installed')>()),
  userLoginPath: async () => `${bin}:/usr/bin:/bin`
}))
vi.mock('electron', () => ({
  app: { on: () => {} },
  ipcMain: { handle: () => {}, on: () => {} },
  BrowserWindow: { getAllWindows: () => [fakeWindow], getFocusedWindow: () => null, fromWebContents: () => null }
}))
vi.mock('@shared/risk-markers', () => ({
  riskMarkers: (diff: string) => {
    seenDiffs.push(diff)
    return [{ kind: 'ci-config', path: '.github/workflows/ci.yml', count: 1 }]
  }
}))

const { detectGh, checkWorktree, pushBranch, watchTargets, unwatch } = await import('./pull-requests')
const { changes } = await import('./git-graph')
const { baseCi, baseFailing, baseFailure, checkBaseCi, commitRollup, diffSince, diffSinceWithCut, discardSince, handoffSlot, pullWorktree, pushBaseAgain, pushFailure, readHandoffText, resetShip, shipOperation, shipPreflight, shipRisks, shipToMain, syncWorktree } = await import('./ship')

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
/**
 * main (pushed to a bare remote) and a worktree on `feat` with one commit, not pushed. `github`: the remote's fetch
 * URL names GitHub; `remote: false`: no remote at all.
 */
function setup(options: { github?: boolean; remote?: boolean; url?: string } = {}): { root: string; wt: string; bare: string } {
  const n = ++counter
  const root = join(base, `repo-${n}`)
  const bare = join(base, `bare-${n}.git`)
  mkdirSync(root)
  git(base, 'init', '-q', '--bare', '-b', 'main', bare)
  git(root, 'init', '-q', '-b', 'main')
  commit(root, 'a.txt', 'one\ntwo\nthree\n', 'init')
  if (options.remote !== false) {
    if (options.github !== false) {
      git(root, 'remote', 'add', 'origin', options.url ?? 'https://github.com/acme/widget.git')
      git(root, 'config', 'remote.origin.pushurl', bare)
      git(root, 'config', 'protocol.https.allow', 'never')
    } else {
      git(root, 'remote', 'add', 'origin', bare)
    }
    git(root, 'push', '-q', '-u', 'origin', 'main')
  }
  roots.add(root)
  const wt = join(base, `wt-${n}`)
  git(root, 'worktree', 'add', '-q', '-b', 'feat', wt)
  git(root, 'config', 'branch.feat.base', 'main')
  commit(wt, 'b.txt', 'b\n', 'Make nav sticky')
  return { root, wt, bare }
}

/** Another clone of the bare remote, to push upstream work from. */
function cloneOf(bare: string): string {
  const dir = join(base, `clone-${++counter}`)
  git(base, 'clone', '-q', bare, dir)
  return dir
}

/** Every logged gh call as its argument list (one file per call, oldest first). */
function calls(): string[][] {
  return readdirSync(ghDir)
    .filter((name) => name.startsWith('call-'))
    .map((name) => ({ name, at: statSync(join(ghDir, name)).mtimeMs }))
    .sort((a, b) => a.at - b.at || a.name.localeCompare(b.name))
    .map(({ name }) => readFileSync(join(ghDir, name), 'utf8').replace(/\n$/, '').split('\n'))
}
const apiCalls = (suffix: string) => calls().filter((call) => call[0] === 'api' && (call[1] ?? '').includes(suffix))

const checkRuns = (...items: { name: string; status: string; conclusion?: string | null; job?: number }[]) =>
  JSON.stringify({
    total_count: items.length,
    check_runs: items.map((item) => ({
      name: item.name,
      status: item.status,
      conclusion: item.conclusion ?? null,
      details_url: `https://github.com/acme/widget/actions/runs/11/job/${item.job ?? 22}`
    }))
  })
const writeGh = (name: string, text: string) => writeFileSync(join(ghDir, name), text)

beforeEach(async () => {
  for (const name of readdirSync(ghDir)) rmSync(join(ghDir, name), { force: true })
  sent.length = 0
  seenDiffs.length = 0
  resetShip()
  await detectGh(true)
})

afterEach(() => resetShip())

afterAll(() => rmSync(base, { recursive: true, force: true }))

describe('preflight', () => {
  it('refuses folders that are not workspace projects, not their worktrees, or the base itself', async () => {
    const { root, wt } = setup()
    expect(await shipPreflight({ root: join(base, 'elsewhere'), worktree: wt })).toMatchObject({ ok: false })
    expect(await shipPreflight({ root, worktree: join(base, 'nope') })).toMatchObject({ ok: false, message: '不是这个项目的 worktree' })
    expect(await shipPreflight({ root, worktree: 'relative' })).toEqual({ ok: false, message: '请求无效', operation: null })
    expect(await shipPreflight(null)).toEqual({ ok: false, message: '请求无效', operation: null })
    expect(await shipPreflight({ root, worktree: root })).toMatchObject({ ok: false, message: '这是基线分支本身，没有可以合并的改动' })
    git(wt, 'checkout', '-q', '--detach')
    expect(await shipPreflight({ root, worktree: wt })).toMatchObject({ ok: false, message: '处于分离 HEAD，没有分支可以合并' })
  })

  it('reports the branch, base, remote and the counts', async () => {
    const { root, wt } = setup({ github: false })
    commit(wt, 'c.txt', 'c\n', 'Test nav')
    writeFileSync(join(wt, 'dirty.txt'), 'x')
    writeFileSync(join(wt, 'b.txt'), 'changed\n')
    expect(await shipPreflight({ root, worktree: wt })).toEqual({
      ok: true,
      branch: 'feat',
      base: 'main',
      remote: 'origin',
      baseProtected: null,
      suggested: 'main',
      uncommitted: 2,
      ahead: 2,
      merged: false,
      baseAheadOfUpstream: 0,
      baseBehindUpstream: 0,
      openPr: null,
      mergeMethods: null,
      head: sha(wt, 'HEAD'),
      gh: 'ready',
      // The remote is a local bare repository: no GitHub repository to make PRs in.
      remoteOnGitHub: false,
      operation: null,
      behindBase: 0,
      baseConflicts: [],
      pushed: false,
      upstream: null,
      baseRemote: 'origin',
      pullFrom: null
    })
  })

  // R60 / R71 / R25: where exit A pushes the base (the base's own remote), and what 拉取 fetches (the upstream's own name).
  it('names where the base is pushed and the remote branch 拉取 fetches', async () => {
    const { root, wt, bare } = setup({ github: false })
    git(root, 'remote', 'add', 'fork', bare)
    git(wt, 'push', '-q', 'fork', 'feat:refs/heads/jacoy/feat')
    git(wt, 'fetch', '-q', 'fork')
    git(wt, 'branch', '-q', '--set-upstream-to=fork/jacoy/feat')
    expect(await shipPreflight({ root, worktree: wt })).toMatchObject({ ok: true, remote: 'fork', baseRemote: 'origin', pullFrom: 'fork/jacoy/feat' })
  })

  it('reads the merge methods the GitHub repository allows and its default, cached for a while', async () => {
    const { root, wt } = setup()
    const repository = { squashMergeAllowed: true, mergeCommitAllowed: true, rebaseMergeAllowed: false, viewerDefaultMergeMethod: 'MERGE' }
    writeGh('graphql.json', JSON.stringify({ data: { repository } }))
    expect(await shipPreflight({ root, worktree: wt })).toMatchObject({ ok: true, mergeMethods: { methods: ['squash', 'merge'], defaultMethod: 'merge' } })
    const graphql = () => calls().filter((call) => call[0] === 'api' && call[1] === 'graphql')
    expect(graphql()).toHaveLength(1)
    expect(graphql()[0]).toEqual(expect.arrayContaining(['--hostname=github.com', 'owner=acme', 'name=widget']))
    writeGh('graphql.json', JSON.stringify({ data: { repository: { ...repository, viewerDefaultMergeMethod: 'SQUASH' } } }))
    expect(await shipPreflight({ root, worktree: wt })).toMatchObject({ mergeMethods: { defaultMethod: 'merge' } })
    expect(graphql()).toHaveLength(1)

    resetShip()
    expect(await shipPreflight({ root, worktree: wt })).toMatchObject({ mergeMethods: { methods: ['squash', 'merge'], defaultMethod: 'squash' } })
    // Nothing to go by: GitHub answers nothing usable, or gh is signed out.
    resetShip()
    writeGh('graphql.json', JSON.stringify({ data: null }))
    expect(await shipPreflight({ root, worktree: wt })).toMatchObject({ ok: true, mergeMethods: null })
    // A miss is trusted for a minute: the next git change does not ask again.
    const asked = graphql().length
    writeGh('graphql.json', JSON.stringify({ data: { repository } }))
    expect(await shipPreflight({ root, worktree: wt })).toMatchObject({ ok: true, mergeMethods: null })
    expect(graphql()).toHaveLength(asked)
    const later = Date.now() + 61_000
    const clock = vi.spyOn(Date, 'now').mockReturnValue(later)
    try {
      expect(await shipPreflight({ root, worktree: wt })).toMatchObject({ mergeMethods: { methods: ['squash', 'merge'] } })
      expect(graphql()).toHaveLength(asked + 1)
    } finally {
      clock.mockRestore()
    }
    resetShip()
    writeGh('graphql.json', JSON.stringify({ data: { repository } }))
    writeGh('signed-out', '')
    await detectGh(true)
    expect(await shipPreflight({ root, worktree: wt })).toMatchObject({ ok: true, mergeMethods: null })
  })

  it('counts the base against its upstream both ways, and has no remote without one', async () => {
    const { root, wt, bare } = setup({ github: false })
    commit(root, 'local.txt', 'l\n', 'unpushed on main')
    const other = cloneOf(bare)
    commit(other, 'up.txt', 'u\n', 'upstream one')
    commit(other, 'up2.txt', 'u\n', 'upstream two')
    git(other, 'push', '-q', 'origin', 'main')
    git(root, 'fetch', '-q')
    expect(await shipPreflight({ root, worktree: wt })).toMatchObject({ ok: true, baseAheadOfUpstream: 1, baseBehindUpstream: 2, remote: 'origin' })

    const bare0 = setup({ remote: false })
    expect(await shipPreflight({ root: bare0.root, worktree: bare0.wt })).toMatchObject({ ok: true, remote: null, baseProtected: null, baseAheadOfUpstream: 0, baseBehindUpstream: 0 })
  })

  it('reads branch protection from GitHub: 200 protected, 404 not, anything else unknown, cached for a while', async () => {
    const { root, wt } = setup()
    writeGh('protection', '200')
    expect(await shipPreflight({ root, worktree: wt })).toMatchObject({ ok: true, baseProtected: true, suggested: 'pr' })
    expect(apiCalls('/protection')[0]).toEqual(['api', 'repos/acme/widget/branches/main/protection', '--hostname=github.com'])
    writeGh('protection', '404')
    expect(await shipPreflight({ root, worktree: wt })).toMatchObject({ baseProtected: true })
    expect(apiCalls('/protection')).toHaveLength(1)

    resetShip()
    expect(await shipPreflight({ root, worktree: wt })).toMatchObject({ baseProtected: false, suggested: 'main' })
    resetShip()
    writeGh('protection', '403')
    expect(await shipPreflight({ root, worktree: wt })).toMatchObject({ baseProtected: null, suggested: 'main' })

    resetShip()
    writeGh('protection', '200')
    writeGh('signed-out', '')
    await detectGh(true)
    expect(await shipPreflight({ root, worktree: wt })).toMatchObject({ baseProtected: null, suggested: 'main' })
  })

  it('knows the open PR of a watched worktree', async () => {
    const { root, wt } = setup()
    git(wt, 'push', '-q', '-u', 'origin', 'feat')
    writeGh(
      'pr-list.json',
      JSON.stringify([{ number: 7, state: 'OPEN', isDraft: false, url: 'https://github.com/acme/widget/pull/7', title: 'Nav', isCrossRepository: false, headRepositoryOwner: { login: 'acme' }, statusCheckRollup: [] }])
    )
    const watcher = { send: () => {}, isDestroyed: () => false }
    watchTargets(watcher, [{ root, worktree: wt }])
    await checkWorktree(wt)
    expect(await shipPreflight({ root, worktree: wt })).toMatchObject({ ok: true, openPr: 7 })
    unwatch(watcher)
  })
})

describe('handoff', () => {
  it('clears the old file and answers the path inside the worktree git dir', async () => {
    const { root, wt } = setup()
    const gitDir = git(wt, 'rev-parse', '--absolute-git-dir').trim()
    mkdirSync(join(gitDir, 'wavi'), { recursive: true })
    writeFileSync(join(gitDir, 'wavi', 'commit.md'), 'old')
    writeFileSync(join(gitDir, 'wavi', 'pr.md'), 'keep')
    expect(await handoffSlot({ root, worktree: wt, kind: 'commit' })).toEqual({ ok: true, path: join(gitDir, 'wavi', 'commit.md') })
    expect(existsSync(join(gitDir, 'wavi', 'commit.md'))).toBe(false)
    expect(readFileSync(join(gitDir, 'wavi', 'pr.md'), 'utf8')).toBe('keep')
    // The directory is made when it is missing.
    rmSync(join(gitDir, 'wavi'), { recursive: true })
    expect(await handoffSlot({ root, worktree: wt, kind: 'fix' })).toEqual({ ok: true, path: join(gitDir, 'wavi', 'fix.md') })
    expect(existsSync(join(gitDir, 'wavi'))).toBe(true)
  })

  it('reads what the agent wrote, at most 64 KB, and null while there is nothing', async () => {
    const { root, wt } = setup()
    const slot = await handoffSlot({ root, worktree: wt, kind: 'pr' })
    if (!slot.ok) throw new Error('no slot')
    expect(await readHandoffText({ root, worktree: wt, kind: 'pr' })).toBeNull()
    writeFileSync(slot.path, '导航吸顶\n\n正文')
    expect(await readHandoffText({ root, worktree: wt, kind: 'pr' })).toBe('导航吸顶\n\n正文')
    writeFileSync(slot.path, 'x'.repeat(100_000))
    expect((await readHandoffText({ root, worktree: wt, kind: 'pr' }))?.length).toBe(64 * 1024)
  })

  it('refuses bad requests and strangers', async () => {
    const { root, wt } = setup()
    expect(await handoffSlot({ root, worktree: wt, kind: '../x' })).toEqual({ ok: false, message: '请求无效' })
    expect(await handoffSlot({ root, worktree: join(base, 'nope'), kind: 'pr' })).toMatchObject({ ok: false })
    expect(await handoffSlot({ root: join(base, 'elsewhere'), worktree: wt, kind: 'pr' })).toMatchObject({ ok: false })
    expect(await readHandoffText({ root: join(base, 'elsewhere'), worktree: wt, kind: 'pr' })).toBeNull()
  })
})

describe('shipToMain', () => {
  it('commits the ticked files, squashes with the agent message, pushes and starts watching CI', async () => {
    const { root, wt, bare } = setup()
    writeFileSync(join(wt, 'new.txt'), 'n\n')
    writeFileSync(join(wt, 'other.txt'), 'o\n')
    const message = 'feat(nav): sticky header\n\nWhy: it jumped on scroll.'
    const result = await shipToMain({ root, worktree: wt, message, method: 'squash', paths: ['new.txt'] })
    expect(result).toMatchObject({ ok: true, pushed: true })
    if (!result.ok) throw new Error('not shipped')
    expect(git(bare, 'log', '-1', '--format=%B', 'main').trim()).toBe(message)
    expect(sha(bare, 'main')).toBe(result.commit)
    expect(sha(root, 'main')).toBe(result.commit)
    expect(git(bare, 'ls-tree', '--name-only', 'main').split('\n')).toEqual(expect.arrayContaining(['b.txt', 'new.txt']))
    expect(git(bare, 'ls-tree', '--name-only', 'main')).not.toContain('other.txt')
    expect(git(root, 'status', '--porcelain')).toBe('')
    // The unticked file stayed in the worktree, uncommitted.
    expect(git(wt, 'status', '--porcelain').trim()).toBe('?? other.txt')
    // The branch sits on the squash commit: merged by ancestry.
    expect(sha(root, 'feat')).toBe(result.commit)
    expect(baseCi({ root, worktree: wt })).toBeNull()
  })

  it('merge: a merge commit with the message git would write, pushed; the agent message only commits the ticked files', async () => {
    const { root, wt, bare } = setup()
    writeFileSync(join(wt, 'new.txt'), 'n\n')
    const result = await shipToMain({ root, worktree: wt, message: 'feat: new file', method: 'merge', paths: ['new.txt'] })
    expect(result).toMatchObject({ ok: true, pushed: true })
    expect(git(bare, 'log', '-1', '--format=%s', 'main').trim()).toBe("Merge branch 'feat'")
    expect(git(bare, 'log', '-1', '--format=%P', 'main').trim().split(' ')).toHaveLength(2)
    expect(git(bare, 'log', '-1', '--format=%s', 'main^2').trim()).toBe('feat: new file')
    expect(git(root, 'branch', '--merged', 'main', '--format=%(refname:short)').split('\n')).toContain('feat')
  })

  it('rebase: the branch commits land on the base as they are, pushed, with the unticked files left in the worktree', async () => {
    const { root, wt, bare } = setup()
    commit(root, 'd.txt', 'd\n', 'main moved on')
    git(root, 'push', '-q', 'origin', 'main')
    writeFileSync(join(wt, 'new.txt'), 'n\n')
    writeFileSync(join(wt, 'other.txt'), 'o\n')
    const result = await shipToMain({ root, worktree: wt, message: 'feat: new file', method: 'rebase', paths: ['new.txt'] })
    expect(result).toMatchObject({ ok: true, pushed: true })
    expect(git(bare, 'log', '--format=%s', 'main').trim().split('\n')).toEqual(['feat: new file', 'Make nav sticky', 'main moved on', 'init'])
    expect(sha(root, 'feat')).toBe(sha(bare, 'main'))
    expect(git(wt, 'status', '--porcelain').trim()).toBe('?? other.txt')
  })

  // R47: a rebase that stops on a commit's conflicts although the trees merge cleanly is given up with Wavi's own
  // sentence (use 压缩 or 合并), not git's hint lines that tell the user to abort a rebase already aborted.
  it('rebase: a rebase given up on a commit’s conflicts keeps Wavi’s sentence', async () => {
    const { root, wt } = setup()
    commit(wt, 'a.txt', 'one\nFEAT\nthree\n', 'feat edits a')
    commit(wt, 'a.txt', 'one\ntwo\nthree\n', 'feat puts a back')
    commit(root, 'a.txt', 'one\nMAIN\nthree\n', 'main edits a')
    git(root, 'push', '-q', 'origin', 'main')
    const result = await shipToMain({ root, worktree: wt, message: 'feat: x', method: 'rebase', paths: null })
    expect(result).toMatchObject({ ok: false, step: 'merge', message: '变基时遇到冲突，已放弃，分支没有变化：改用「压缩」或「合并」' })
    if (!result.ok && result.failure) expect(result.failure.message).toBe('变基时遇到冲突，已放弃，分支没有变化：改用「压缩」或「合并」')
    expect(git(wt, 'symbolic-ref', '--short', 'HEAD').trim()).toBe('feat')
  })

  // M6: git prints a rebase's failure first and ten lines of hints after it; the class is read from all of it.
  it('rebase: a commit that could not be signed is told apart, although git’s hints push the reason out of the last lines', async () => {
    const { root, wt } = setup()
    commit(root, 'd.txt', 'd\n', 'add d on main')
    git(root, 'push', '-q', 'origin', 'main')
    const gpg = join(base, `gpg-${counter}`)
    writeFileSync(gpg, '#!/bin/sh\necho "gpg: signing failed: No pinentry" >&2\nexit 1\n', { mode: 0o755 })
    const saved = { count: process.env.GIT_CONFIG_COUNT, value: process.env.GIT_CONFIG_VALUE_0 }
    Object.assign(process.env, { GIT_CONFIG_COUNT: '2', GIT_CONFIG_VALUE_0: 'true', GIT_CONFIG_KEY_1: 'gpg.program', GIT_CONFIG_VALUE_1: gpg })
    try {
      const result = await shipToMain({ root, worktree: wt, message: 'feat: x', method: 'rebase', paths: null })
      expect(result).toMatchObject({ ok: false, step: 'merge', failure: { kind: 'signing', message: '提交签名需要口令', next: null } })
    } finally {
      Object.assign(process.env, { GIT_CONFIG_COUNT: saved.count, GIT_CONFIG_VALUE_0: saved.value })
      delete process.env.GIT_CONFIG_KEY_1
      delete process.env.GIT_CONFIG_VALUE_1
    }
    expect(git(wt, 'symbolic-ref', '--short', 'HEAD').trim()).toBe('feat')
  })

  it('without paths and without a message keeps the branch own commit message', async () => {
    const { root, wt, bare } = setup()
    const result = await shipToMain({ root, worktree: wt, message: '', method: 'squash', paths: null })
    expect(result).toMatchObject({ ok: true, pushed: true })
    expect(git(bare, 'log', '-1', '--format=%B', 'main').trim()).toBe('Make nav sticky')
  })

  it('does not ship a squash-merged branch again: no empty commit on the base', async () => {
    const { root, wt, bare } = setup()
    const head = sha(root, 'feat')
    const first = await shipToMain({ root, worktree: wt, message: 'feat: b', method: 'squash', paths: null })
    expect(first).toMatchObject({ ok: true, pushed: true })
    // The branch moved onto the squash commit: nothing ahead, and its own commit is in the base (merged).
    expect(await shipPreflight({ root, worktree: wt })).toMatchObject({ ok: true, ahead: 0, merged: true })
    const pushed = sha(bare, 'main')
    const again = await shipToMain({ root, worktree: wt, message: 'feat: b', method: 'squash', paths: null })
    expect(again).toEqual({ ok: false, step: 'merge', reason: 'blocked', message: '分支已经全部合并到 main' })
    // A branch that could not be moved (an agent was editing) is told by content (v1.101).
    git(wt, 'reset', '-q', '--keep', head)
    expect(await shipPreflight({ root, worktree: wt })).toMatchObject({ ok: true, ahead: 1, merged: true })
    expect(await shipToMain({ root, worktree: wt, message: 'feat: b', method: 'squash', paths: null })).toEqual(again)
    expect(sha(root, 'main')).toBe(pushed)
    expect(sha(bare, 'main')).toBe(pushed)
    commit(wt, 'more.txt', 'm\n', 'More')
    expect(await shipPreflight({ root, worktree: wt })).toMatchObject({ ok: true, ahead: 2, merged: false })
  })

  it('merges without pushing when there is no remote', async () => {
    const { root, wt } = setup({ remote: false })
    const result = await shipToMain({ root, worktree: wt, message: 'feat: b', method: 'squash', paths: null })
    expect(result).toMatchObject({ ok: true, pushed: false })
    expect(result).not.toHaveProperty('pushError')
    expect(git(root, 'log', '-1', '--format=%s', 'main').trim()).toBe('feat: b')
  })

  it('reports a commit that the repository hooks refused', async () => {
    const { root, wt } = setup()
    writeFileSync(join(root, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\necho "lint: no semicolons" >&2\nexit 1\n')
    chmodSync(join(root, '.git', 'hooks', 'pre-commit'), 0o755)
    writeFileSync(join(wt, 'new.txt'), 'n\n')
    const before = sha(root, 'main')
    const result = await shipToMain({ root, worktree: wt, message: 'feat: x', method: 'squash', paths: ['new.txt'] })
    expect(result).toMatchObject({ ok: false, step: 'commit', reason: 'failed' })
    expect(result.ok ? '' : result.output).toContain('lint: no semicolons')
    // git does not name the hook that failed, and this one does not either: its own words are the message.
    expect(result).toMatchObject({ failure: { kind: 'unknown', message: '提交失败：lint: no semicolons' } })
    expect(sha(root, 'main')).toBe(before)
  })

  it('refuses requests that are not valid', async () => {
    const { root, wt } = setup()
    expect(await shipToMain({ root, worktree: wt, message: '', method: 'squash', paths: ['x.txt'] })).toMatchObject({ ok: false, reason: 'failed', message: '请求无效' })
    expect(await shipToMain({ root: join(base, 'elsewhere'), worktree: wt, message: 'x', method: 'squash', paths: null })).toMatchObject({ ok: false })
    expect(await shipToMain(7)).toMatchObject({ ok: false })
  })

  it('blocks with a message when there is nothing to merge', async () => {
    const { root, wt } = setup({ github: false })
    git(wt, 'reset', '-q', '--hard', 'main')
    const result = await shipToMain({ root, worktree: wt, message: '', method: 'squash', paths: null })
    // Its reflog has a commit of its own, now all in main: the merge sheet says the same.
    expect(result).toEqual({ ok: false, step: 'merge', reason: 'blocked', message: '分支已经全部合并到 main' })
  })

  it('answers conflicts with the files to hand to the agent, and changes nothing', async () => {
    const { root, wt } = setup({ github: false })
    commit(wt, 'a.txt', 'one\nTWO FROM FEAT\nthree\n', 'edit a on feat')
    commit(root, 'a.txt', 'one\ntwo from main\nthree\n', 'edit a on main')
    git(root, 'push', '-q', 'origin', 'main')
    const before = sha(root, 'main')
    const result = await shipToMain({ root, worktree: wt, message: '', method: 'squash', paths: null })
    expect(result).toMatchObject({ ok: false, step: 'merge', reason: 'conflicts', conflicts: ['a.txt'] })
    expect(sha(root, 'main')).toBe(before)
  })

  it('fast-forwards the base to its upstream first, in its checkout', async () => {
    const { root, wt, bare } = setup({ github: false })
    const other = cloneOf(bare)
    commit(other, 'up.txt', 'u\n', 'upstream work')
    git(other, 'push', '-q', 'origin', 'main')
    const result = await shipToMain({ root, worktree: wt, message: 'feat: b', method: 'squash', paths: null })
    expect(result).toMatchObject({ ok: true, pushed: true })
    expect(git(bare, 'log', '--format=%s', 'main').trim().split('\n')).toEqual(['feat: b', 'upstream work', 'init'])
    expect(existsSync(join(root, 'up.txt'))).toBe(true)
    expect(git(root, 'status', '--porcelain')).toBe('')
  })

  it('fast-forwards a base that no checkout has out', async () => {
    const { root, wt, bare } = setup({ github: false })
    git(root, 'checkout', '-q', '--detach')
    const other = cloneOf(bare)
    commit(other, 'up.txt', 'u\n', 'upstream work')
    git(other, 'push', '-q', 'origin', 'main')
    const result = await shipToMain({ root, worktree: wt, message: 'feat: b', method: 'squash', paths: null })
    expect(result).toMatchObject({ ok: true, pushed: true })
    expect(git(bare, 'log', '--format=%s', 'main').trim().split('\n')).toEqual(['feat: b', 'upstream work', 'init'])
    expect(sha(root, 'main')).toBe(sha(bare, 'main'))
  })

  it('blocks when the base and its upstream have each moved on', async () => {
    for (const detached of [false, true]) {
      const { root, wt, bare } = setup({ github: false })
      if (detached) git(root, 'checkout', '-q', '--detach')
      const other = cloneOf(bare)
      commit(other, 'up.txt', 'u\n', 'upstream work')
      git(other, 'push', '-q', 'origin', 'main')
      git(root, 'update-ref', 'refs/heads/main', git(root, 'commit-tree', '-p', 'main', '-m', 'local only', 'main^{tree}').trim())
      const before = sha(root, 'main')
      const result = await shipToMain({ root, worktree: wt, message: 'feat: b', method: 'squash', paths: null })
      expect(result).toMatchObject({ ok: false, step: 'merge', reason: 'blocked' })
      expect(result.ok ? '' : result.message).toMatch(/^main (落后 origin\/main 1 个提交，没法快进|和 origin\/main 各有对方没有的提交，没法快进)/)
      expect(sha(root, 'main')).toBe(before)
      expect(sha(bare, 'main')).not.toBe(before)
    }
  })

  it('keeps the merge when the push is rejected, and says so', async () => {
    const { root, wt, bare } = setup()
    writeFileSync(join(bare, 'hooks', 'pre-receive'), '#!/bin/sh\necho "no pushes today" >&2\nexit 1\n')
    chmodSync(join(bare, 'hooks', 'pre-receive'), 0o755)
    const before = sha(bare, 'main')
    const result = await shipToMain({ root, worktree: wt, message: 'feat: b', method: 'squash', paths: null })
    expect(result).toMatchObject({ ok: true, pushed: false })
    if (!result.ok) throw new Error('not merged')
    expect(result.pushError).toContain('推送到 origin 失败')
    expect(result.pushError).toContain('pre-receive hook declined')
    // Not a protected branch: 改为创建 PR is not what to offer.
    expect(result).not.toHaveProperty('pushRefused')
    expect(result.failure).toMatchObject({ kind: 'pre-receive-hook', next: 'handoff' })
    expect(sha(root, 'main')).toBe(result.commit)
    expect(git(root, 'log', '-1', '--format=%s', 'main').trim()).toBe('feat: b')
    expect(sha(bare, 'main')).toBe(before)
    expect(baseCi({ root, worktree: wt })).toBeNull()
  })

  it('pushes the merge it kept once the remote takes it again, and starts watching CI', async () => {
    const { root, wt, bare } = setup()
    const hook = join(bare, 'hooks', 'pre-receive')
    writeFileSync(hook, '#!/bin/sh\necho "no pushes today" >&2\nexit 1\n')
    chmodSync(hook, 0o755)
    const first = await shipToMain({ root, worktree: wt, message: 'feat: b', method: 'squash', paths: null })
    if (!first.ok) throw new Error('not merged')
    expect(first.pushed).toBe(false)
    // Still refused: the merge stays, nothing new is merged.
    expect(await pushBaseAgain({ root, worktree: wt })).toMatchObject({ ok: true, commit: first.commit, pushed: false })
    rmSync(hook)
    expect(await pushBaseAgain({ root, worktree: wt })).toEqual({ ok: true, commit: first.commit, pushed: true })
    expect(sha(bare, 'main')).toBe(first.commit)
    expect(await checkBaseCi(wt, true)).toMatchObject({ base: 'main', sha: first.commit })
    // Pushed already (another worktree's retry pushed the same base): still pushed, and its CI is watched here too.
    resetShip()
    expect(await pushBaseAgain({ root, worktree: wt, commit: first.commit })).toEqual({ ok: true, commit: first.commit, pushed: true })
    expect(await checkBaseCi(wt, true)).toMatchObject({ base: 'main', sha: first.commit })
    expect(await pushBaseAgain({ root: join(base, 'elsewhere'), worktree: wt })).toMatchObject({ ok: false, message: '请求无效' })
  })

  it('refuses to push a base that no longer has the merge it kept', async () => {
    const { root, wt, bare } = setup()
    const hook = join(bare, 'hooks', 'pre-receive')
    writeFileSync(hook, '#!/bin/sh\nexit 1\n')
    chmodSync(hook, 0o755)
    const before = sha(root, 'main')
    const first = await shipToMain({ root, worktree: wt, message: 'feat: b', method: 'squash', paths: null })
    if (!first.ok) throw new Error('not merged')
    rmSync(hook)
    git(root, 'reset', '-q', '--hard', before)
    const result = await pushBaseAgain({ root, worktree: wt, commit: first.commit })
    expect(result).toMatchObject({ ok: false, step: 'push', reason: 'failed' })
    expect(result.ok ? '' : result.message).toContain(`main 上已经没有这次的合并（${first.commit.slice(0, 7)}）`)
    expect(sha(bare, 'main')).toBe(before)
  })

  it('says a push refused by branch protection is one, so the sheet offers 改为创建 PR (not after a network error)', () => {
    const refused = pushFailure('c1', 'main', 'To github.com:acme/widget.git ! [remote rejected] main -> main (protected branch hook declined) error: failed to push some refs')
    expect(refused).toMatchObject({ ok: true, commit: 'c1', pushed: false, pushRefused: true })
    expect(refused.ok && refused.pushError).toMatch(/^main 受保护，origin 不收直接推送：改为创建 PR/)
    const offline = pushFailure('c1', 'main', 'ssh: Could not resolve hostname github.com: nodename nor servname provided')
    expect(offline).not.toHaveProperty('pushRefused')
    expect(offline.ok && offline.pushError).toMatch(/^推送到 origin 失败/)
  })

  it('says whether the ticked files were committed before a later step failed', async () => {
    const { root, wt } = setup({ github: false })
    commit(wt, 'a.txt', 'one\nTWO FROM FEAT\nthree\n', 'edit a on feat')
    commit(root, 'a.txt', 'one\ntwo from main\nthree\n', 'edit a on main')
    git(root, 'push', '-q', 'origin', 'main')
    writeFileSync(join(wt, 'new.txt'), 'n\n')
    const result = await shipToMain({ root, worktree: wt, message: 'feat: new', method: 'squash', paths: ['new.txt'] })
    expect(result).toMatchObject({ ok: false, step: 'merge', reason: 'conflicts', committed: true })
    expect(git(wt, 'log', '-1', '--format=%s').trim()).toBe('feat: new')
    // Refused before anything ran: nothing was committed.
    expect(await shipToMain({ root: join(base, 'elsewhere'), worktree: wt, message: 'x', method: 'squash', paths: ['new.txt'] })).not.toHaveProperty('committed')
  })

  it('reads the refusal of a protected base through the failure classes', () => {
    const refused = (output: string) => pushFailure('c1', 'main', output)
    expect(refused('remote: error: GH006: Protected branch update failed for refs/heads/main.')).toMatchObject({ pushRefused: true, failure: { kind: 'protected-branch', next: 'create-pr' } })
    expect(refused('remote: error: GH013: Repository rule violations found for refs/heads/main.')).toMatchObject({ pushRefused: true, failure: { kind: 'protected-branch' } })
    // Protection words without the refused ref: nothing says a PR would get round it.
    const unread = refused('remote: error: Changes must be made through a pull request.')
    expect(unread).not.toHaveProperty('pushRefused')
    expect(unread.ok && unread.pushError).toMatch(/^推送到 origin 失败/)
    const behind = refused(' ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs')
    expect(behind).not.toHaveProperty('pushRefused')
    // 同步 cannot repair a local base that diverged from its remote: no way on is offered.
    expect(behind).toMatchObject({ failure: { kind: 'non-fast-forward', message: '远程有本地没有的提交', next: null } })
    expect(pushFailure('c1', 'main', 'fatal: Could not read from remote repository.', 'upstream')).toMatchObject({ pushError: expect.stringMatching(/^推送到 upstream 失败/) })
  })
})

describe('CI of the pushed base commit', () => {
  async function shipped() {
    const made = setup()
    const result = await shipToMain({ root: made.root, worktree: made.wt, message: 'feat: b', method: 'squash', paths: null })
    if (!result.ok || !result.pushed) throw new Error('not pushed')
    return { ...made, commit: result.commit, target: { root: made.root, worktree: made.wt } }
  }
  const emitted = () => sent.filter((s) => s.channel === 'ship:base-ci-changed').map((s) => s.payload as BaseCi)

  it('turns check runs and legacy statuses into a summary, emits each change, and stops when settled', async () => {
    const { wt, commit: pushed, target } = await shipped()
    // Right after the push GitHub has no checks yet: that reads as pending, not as "no CI".
    expect((await checkBaseCi(wt, true))?.checks).toMatchObject({ state: 'pending', total: 0 })
    expect(emitted()).toHaveLength(1)

    writeGh('check-runs.json', checkRuns({ name: 'test', status: 'in_progress' }, { name: 'lint', status: 'completed', conclusion: 'success' }))
    const running = await checkBaseCi(wt, true)
    expect(running).toMatchObject({ worktree: wt, base: 'main', sha: pushed, url: `https://github.com/acme/widget/commit/${pushed}/checks` })
    expect(running?.checks).toMatchObject({ state: 'pending', total: 2, passed: 1, pending: 1, failing: [] })
    expect(emitted()).toHaveLength(2)
    expect(apiCalls('/check-runs')[0]).toEqual(['api', `repos/acme/widget/commits/${pushed}/check-runs?per_page=100`, '--hostname=github.com'])

    // Nothing changed: nothing is emitted again.
    await checkBaseCi(wt, true)
    expect(emitted()).toHaveLength(2)

    writeGh('check-runs.json', checkRuns({ name: 'test', status: 'completed', conclusion: 'success' }, { name: 'lint', status: 'completed', conclusion: 'success' }))
    writeGh('status.json', JSON.stringify({ state: 'failure', statuses: [{ context: 'ci/legacy', state: 'failure', target_url: 'https://ci.example/1' }] }))
    const failed = await checkBaseCi(wt, true)
    expect(failed?.checks).toMatchObject({ state: 'failing', total: 3, passed: 2, failing: [{ name: 'ci/legacy', runId: null, jobId: null }] })
    expect(emitted()).toHaveLength(3)
    expect(emitted()[2]).toEqual(failed)
    expect(baseCi(target)).toEqual(failed)
    expect(baseCi({ root: target.root, worktree: join(base, 'nope') })).toBeNull()
    expect(baseCi({ root: join(base, 'elsewhere'), worktree: wt })).toBeNull()
  })

  it('reads the failing checks with the end of their logs', async () => {
    const { wt, commit: pushed, target } = await shipped()
    writeGh('check-runs.json', checkRuns({ name: 'test', status: 'completed', conclusion: 'failure', job: 22 }, { name: 'lint', status: 'completed', conclusion: 'success' }))
    writeGh('log-failed.txt', 'check\tRun npm test\t2026-10-20T17:15:15.9535000Z expected 1 to be 2\ncheck\tRun npm test\t2026-10-20T17:15:16.0000000Z ##[error]Process completed with exit code 1.\n')
    await checkBaseCi(wt, true)
    expect(await baseFailure(target)).toEqual({ base: 'main', sha: pushed, checks: ['test'], log: 'expected 1 to be 2\n##[error]Process completed with exit code 1.' })
    expect(calls().filter((c) => c[0] === 'run')[0]).toEqual(['run', 'view', '--repo=github.com/acme/widget', '--job=22', '--log-failed'])
    writeGh('check-runs.json', checkRuns({ name: 'test', status: 'completed', conclusion: 'success' }))
    await checkBaseCi(wt, true)
    expect(await baseFailure(target)).toBeNull()
  })

  it('asks about the tip the base had before the push when it is watched, else the tip of its upstream', async () => {
    const { root, wt, bare, target } = await shipped()
    const previous = git(wt, 'rev-parse', 'main~1').trim()
    writeGh(`check-runs-${previous}.json`, checkRuns({ name: 'lint', status: 'completed', conclusion: 'failure' }, { name: 'test', status: 'completed', conclusion: 'success' }))
    writeGh(`check-runs-${sha(bare, 'main')}.json`, checkRuns({ name: 'test', status: 'completed', conclusion: 'failure' }))
    expect(await baseFailing(target)).toEqual(['lint'])

    // Not watched (e.g. after a restart): the tip of origin/main as fetched.
    resetShip()
    expect(await baseFailing(target)).toEqual(['test'])
    expect(sha(root, 'refs/remotes/origin/main')).toBe(sha(bare, 'main'))
  })

  it('is null when gh or GitHub cannot tell', async () => {
    const { root, wt } = setup()
    const target = { root, worktree: wt }
    writeGh('api-fail', 'gh: Server Error (HTTP 500)')
    expect(await baseFailing(target)).toBeNull()
    rmSync(join(ghDir, 'api-fail'))
    writeGh('signed-out', '')
    await detectGh(true)
    expect(await baseFailing(target)).toBeNull()
    expect(await baseFailing({ root: join(base, 'elsewhere'), worktree: wt })).toBeNull()

    const plain = setup({ github: false })
    rmSync(join(ghDir, 'signed-out'))
    await detectGh(true)
    expect(await baseFailing({ root: plain.root, worktree: plain.wt })).toBeNull()
    // And a push to a repository that is not on GitHub watches nothing.
    const shippedPlain = await shipToMain({ root: plain.root, worktree: plain.wt, message: 'feat: b', method: 'squash', paths: null })
    expect(shippedPlain).toMatchObject({ ok: true, pushed: true })
    expect(baseCi({ root: plain.root, worktree: plain.wt })).toBeNull()
  })

  it('builds the rollup from the REST answers', () => {
    expect(commitRollup({ check_runs: [{ name: 'a', status: 'completed', conclusion: 'success', details_url: 'u' }, { name: 'old', status: 'completed', conclusion: 'stale' }] }, { state: 'pending', statuses: [] })).toEqual([
      { __typename: 'CheckRun', name: 'a', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: 'u' }
    ])
    expect(commitRollup({}, { statuses: [{ context: 'ci', state: 'error', target_url: 't' }] })).toEqual([{ __typename: 'StatusContext', context: 'ci', state: 'ERROR', targetUrl: 't' }])
    expect(commitRollup(null, 'nope')).toEqual([])
  })
})

describe('diffSince and discardSince', () => {
  it('returns the diff from a commit of the branch to HEAD, and null for anything else', async () => {
    const { root, wt } = setup({ github: false })
    const since = sha(wt, 'HEAD')
    commit(wt, 'fix.txt', 'fix\n', 'fix it')
    const diff = await diffSince({ root, worktree: wt, since })
    expect(diff).toContain('+++ b/fix.txt')
    expect(diff).not.toContain('b.txt')
    expect(await diffSince({ root, worktree: wt, since: since.slice(0, 7) })).toBe(diff)

    commit(root, 'main-only.txt', 'm\n', 'main only')
    expect(await diffSince({ root, worktree: wt, since: sha(root, 'main') })).toBeNull()
    expect(await diffSince({ root, worktree: wt, since: 'abcdef1234' })).toBeNull()
    expect(await diffSince({ root, worktree: wt, since: '--output=x' })).toBeNull()
    expect(await diffSince({ root: join(base, 'elsewhere'), worktree: wt, since })).toBeNull()
  })

  it('caps the diff at 2 MB, whole lines only', async () => {
    const { root, wt } = setup({ github: false })
    const since = sha(wt, 'HEAD')
    commit(wt, 'big.txt', `${'x'.repeat(99)}\n`.repeat(30_000), 'big')
    const diff = await diffSince({ root, worktree: wt, since })
    expect(diff!.length).toBeLessThanOrEqual(2 * 1024 * 1024)
    expect(diff!.length).toBeGreaterThan(1.9 * 1024 * 1024)
    expect(diff!.endsWith('\n')).toBe(true)
  })

  // A capped diff names only some files: whoever decides from its file list must know it is not the whole diff.
  it('says when the diff was cut at the cap, with the same text', async () => {
    const { root, wt } = setup({ github: false })
    const since = sha(wt, 'HEAD')
    commit(wt, 'fix.txt', 'fix\n', 'fix it')
    const small = await diffSinceWithCut({ root, worktree: wt, since })
    expect(small).toEqual({ text: await diffSince({ root, worktree: wt, since }), cut: false })
    expect(small!.text).toContain('+++ b/fix.txt')

    commit(wt, 'big.txt', `${'x'.repeat(99)}\n`.repeat(30_000), 'big')
    commit(wt, 'z.txt', 'z\n', 'after the big one')
    const big = await diffSinceWithCut({ root, worktree: wt, since })
    expect(big).toEqual({ text: await diffSince({ root, worktree: wt, since }), cut: true })
    expect(big!.text).not.toContain('z.txt')
    expect(await diffSinceWithCut({ root, worktree: wt, since: 'abcdef1234' })).toBeNull()
  })

  it('moves the branch back to the commit, and refuses uncommitted changes and strangers', async () => {
    const { root, wt } = setup({ github: false })
    const since = sha(wt, 'HEAD')
    commit(wt, 'fix.txt', 'fix\n', 'fix it')

    writeFileSync(join(wt, 'b.txt'), 'edited\n')
    const refused = await discardSince({ root, worktree: wt, since })
    expect(refused).toMatchObject({ ok: false })
    expect(existsSync(join(wt, 'fix.txt'))).toBe(true)
    expect(readFileSync(join(wt, 'b.txt'), 'utf8')).toBe('edited\n')
    git(wt, 'checkout', '--', 'b.txt')

    commit(root, 'main-only.txt', 'm\n', 'main only')
    expect(await discardSince({ root, worktree: wt, since: sha(root, 'main') })).toMatchObject({ ok: false })
    expect(await discardSince({ root, worktree: root, since: sha(root, 'main') })).toMatchObject({ ok: false, message: '这是基线分支本身：Wavi 不回退基线分支' })

    // An untracked file is not at risk and does not stop it.
    writeFileSync(join(wt, 'scratch.txt'), 's')
    expect(await discardSince({ root, worktree: wt, since })).toEqual({ ok: true })
    expect(sha(wt, 'HEAD')).toBe(since)
    expect(existsSync(join(wt, 'fix.txt'))).toBe(false)
    expect(existsSync(join(wt, 'scratch.txt'))).toBe(true)
    expect(sha(root, 'main')).not.toBe(since)
  })
})

describe('risks', () => {
  it('hands the whole change against the merge base, working tree included, to the markers', async () => {
    const { root, wt } = setup({ github: false })
    commit(root, 'main-only.txt', 'm\n', 'main moves on')
    commit(wt, 'c.txt', 'c\n', 'Test nav')
    writeFileSync(join(wt, 'a.txt'), 'one\ntwo\nTHREE\n')
    writeFileSync(join(wt, 'untracked.txt'), 'u\n')
    expect(await shipRisks({ root, worktree: wt })).toEqual([{ kind: 'ci-config', path: '.github/workflows/ci.yml', count: 1 }])
    const diff = seenDiffs[0]!
    expect(diff).toContain('+++ b/b.txt')
    expect(diff).toContain('+++ b/c.txt')
    expect(diff).toContain('+THREE')
    expect(diff).not.toContain('untracked.txt')
    expect(diff).not.toContain('main-only.txt')
  })

  it('is empty for strangers and for the base itself', async () => {
    const { root, wt } = setup({ github: false })
    expect(await shipRisks({ root: join(base, 'elsewhere'), worktree: wt })).toEqual([])
    expect(await shipRisks({ root, worktree: root })).toEqual([])
    expect(seenDiffs).toEqual([])
  })
})

// ── 合入链路 v2 (PRD v1.170) ─────────────────────────────────────────────────────────────────────────────────────

/** The same line of a.txt changed on main (pushed) and on feat: landing feat on main conflicts. */
function conflicting(options: { github?: boolean } = { github: false }) {
  const made = setup(options)
  commit(made.wt, 'a.txt', 'one\nTWO FROM FEAT\nthree\n', 'edit a on feat')
  commit(made.root, 'a.txt', 'one\ntwo from main\nthree\n', 'edit a on main')
  git(made.root, 'push', '-q', 'origin', 'main')
  return made
}

/** Runs git where it is expected to fail (a merge or rebase that stops on conflicts). */
const gitFails = (cwd: string, ...args: string[]) => expect(() => git(cwd, ...args)).toThrow()

/** HEAD, the index's tree and the working tree's status: what a refused sync must leave alone. */
const snapshot = (cwd: string) => ({ head: sha(cwd, 'HEAD'), index: git(cwd, 'write-tree').trim(), status: git(cwd, 'status', '--porcelain=v1', '--untracked-files=all') })

describe('preflight · the chain fields', () => {
  it('counts what the base has that the branch lacks, the files that would conflict, and the pushed branch as last fetched', async () => {
    const { root, wt, bare } = conflicting()
    expect(await shipPreflight({ root, worktree: wt })).toMatchObject({
      ok: true,
      head: sha(wt, 'HEAD'),
      behindBase: 1,
      baseConflicts: ['a.txt'],
      pushed: false,
      upstream: null,
      operation: null,
      remoteOnGitHub: false
    })
    git(wt, 'push', '-q', '-u', 'origin', 'feat')
    commit(wt, 'local.txt', 'l\n', 'local only')
    const other = cloneOf(bare)
    git(other, 'checkout', '-q', 'feat')
    commit(other, 'remote.txt', 'r\n', 'remote one')
    commit(other, 'remote2.txt', 'r\n', 'remote two')
    git(other, 'push', '-q', 'origin', 'feat')
    // No network call: the remote's new commits count only once fetched.
    expect(await shipPreflight({ root, worktree: wt })).toMatchObject({ pushed: true, upstream: { ahead: 1, behind: 0 } })
    git(wt, 'fetch', '-q', 'origin')
    expect(await shipPreflight({ root, worktree: wt })).toMatchObject({ pushed: true, upstream: { ahead: 1, behind: 2 } })
  })

  it('takes a same-named branch on the remote as pushed, without an upstream', async () => {
    const { root, wt } = setup({ github: false })
    git(wt, 'push', '-q', 'origin', 'feat')
    expect(await shipPreflight({ root, worktree: wt })).toMatchObject({ pushed: true, upstream: { ahead: 0, behind: 0 } })
  })

  it('takes a branch pushed with an upstream as pushed although git keeps no remote-tracking ref of it (single-branch clone)', async () => {
    const { root, wt } = setup({ github: false })
    git(root, 'config', 'remote.origin.fetch', '+refs/heads/main:refs/remotes/origin/main')
    git(wt, 'push', '-q', '-u', 'origin', 'feat')
    expect(git(root, 'for-each-ref', 'refs/remotes/origin/feat').trim()).toBe('')
    expect(await shipPreflight({ root, worktree: wt })).toMatchObject({ ok: true, pushed: true, upstream: null })
  })

  it('counts against origin/<base> when the local base is only behind it, as Git · 变更 does', async () => {
    const { root, wt, bare } = setup({ github: false })
    const other = cloneOf(bare)
    commit(other, 'up.txt', 'u\n', 'upstream work')
    git(other, 'push', '-q', 'origin', 'main')
    git(root, 'fetch', '-q', 'origin')
    const older = await shipPreflight({ root, worktree: wt })
    const listed = await changes(wt, 'main')
    expect(listed).toMatchObject({ baseRef: 'refs/remotes/origin/main', ahead: 1, behind: 1 })
    expect(older).toMatchObject({ ok: true, ahead: 1, behindBase: 1, merged: false })
    // A worktree started from origin/main has nothing of its own yet.
    const fresh = join(base, `wt-fresh-${++counter}`)
    git(root, 'worktree', 'add', '-q', '-b', 'fresh', fresh, 'origin/main')
    git(root, 'config', 'branch.fresh.base', 'main')
    expect(await changes(fresh, 'main')).toMatchObject({ ahead: 0, behind: 0 })
    expect(await shipPreflight({ root, worktree: fresh })).toMatchObject({ ok: true, ahead: 0, behindBase: 0, merged: false })
  })

  it('says a GitHub remote is on GitHub, and reports gh', async () => {
    const { root, wt } = setup()
    expect(await shipPreflight({ root, worktree: wt })).toMatchObject({ ok: true, remoteOnGitHub: true, gh: 'ready' })
    const none = setup({ remote: false })
    expect(await shipPreflight({ root: none.root, worktree: none.wt })).toMatchObject({ ok: true, remote: null, remoteOnGitHub: null })
  })

  it('does not take a GitLab or Bitbucket remote for GitHub, and never asks gh about it', async () => {
    for (const url of ['https://gitlab.com/acme/widget.git', 'git@bitbucket.org:acme/widget.git']) {
      const { root, wt } = setup({ url })
      git(wt, 'push', '-q', '-u', 'origin', 'feat')
      expect(await shipPreflight({ root, worktree: wt })).toMatchObject({ ok: true, remote: 'origin', remoteOnGitHub: false, baseProtected: null, mergeMethods: null })
    }
    expect(calls().filter((call) => call[0] !== 'auth')).toEqual([])
  })

  it('takes a GitHub Enterprise host gh is logged in to for GitHub, and only that host', async () => {
    writeGh('hosts', 'ghe.example.com\n')
    await detectGh(true)
    const ghe = setup({ url: 'git@ghe.example.com:acme/widget.git' })
    expect(await shipPreflight({ root: ghe.root, worktree: ghe.wt })).toMatchObject({ ok: true, remoteOnGitHub: true })
    const other = setup({ url: 'https://git.example.org/acme/widget.git' })
    expect(await shipPreflight({ root: other.root, worktree: other.wt })).toMatchObject({ ok: true, remoteOnGitHub: false })
  })

  it('counts a branch whose commits reached the base by fast-forward as merged, and a branch with none of its own as not', async () => {
    const { root, wt } = setup({ github: false })
    git(root, 'merge', '-q', '--ff-only', 'feat')
    expect(await shipPreflight({ root, worktree: wt })).toMatchObject({ ok: true, ahead: 0, merged: true })
    const fresh = join(base, `wt-fresh-${++counter}`)
    git(root, 'worktree', 'add', '-q', '-b', 'fresh', fresh)
    git(root, 'config', 'branch.fresh.base', 'main')
    expect(await shipPreflight({ root, worktree: fresh })).toMatchObject({ ok: true, ahead: 0, merged: false })
  })

  it('names a merge in progress and its unresolved files', async () => {
    const { root, wt } = conflicting()
    gitFails(wt, 'merge', 'main')
    expect(await shipPreflight({ root, worktree: wt })).toMatchObject({ ok: true, operation: { kind: 'merge', unresolved: ['a.txt'] } })
    writeFileSync(join(wt, 'a.txt'), 'one\nboth\nthree\n')
    git(wt, 'add', 'a.txt')
    expect(await shipPreflight({ root, worktree: wt })).toMatchObject({ ok: true, operation: { kind: 'merge', unresolved: [] } })
  })

  it('names a rebase in progress although HEAD is detached', async () => {
    const { root, wt } = conflicting()
    gitFails(wt, 'rebase', 'main')
    expect(await shipPreflight({ root, worktree: wt })).toEqual({ ok: false, message: 'rebase 进行中', operation: { kind: 'rebase', unresolved: ['a.txt'] } })
  })

  it('picks the only remote when it is not called origin', async () => {
    const { root, wt, bare } = setup({ remote: false })
    git(root, 'remote', 'add', 'upstream', bare)
    git(root, 'push', '-q', '-u', 'upstream', 'main')
    expect(await shipPreflight({ root, worktree: wt })).toMatchObject({ ok: true, remote: 'upstream' })
  })
})

/** The base 同步 brings in: the local base, or origin's when the local one is only behind it and could not catch up. */
const LOCAL_MAIN = { onto: 'main', ontoRef: 'refs/heads/main' }
const ORIGIN_MAIN = { onto: 'origin/main', ontoRef: 'refs/remotes/origin/main' }

describe('同步 <base>', () => {
  it('rebases a branch that was never pushed onto the base, and pushes nothing', async () => {
    const { root, wt, bare } = setup({ github: false })
    commit(root, 'm.txt', 'm\n', 'main moved on')
    git(root, 'push', '-q', 'origin', 'main')
    expect(await syncWorktree({ root, worktree: wt })).toEqual({ ok: true, ...LOCAL_MAIN })
    expect(git(wt, 'log', '--format=%s', 'HEAD').trim().split('\n')).toEqual(['Make nav sticky', 'main moved on', 'init'])
    expect(git(wt, 'rev-list', '--merges', 'HEAD').trim()).toBe('')
    expect(git(wt, 'symbolic-ref', '--short', 'HEAD').trim()).toBe('feat')
    expect(git(bare, 'for-each-ref', 'refs/heads/feat').trim()).toBe('')
  })

  it('merges the base into a pushed branch, never rebasing or pushing it', async () => {
    const { root, wt, bare } = setup({ github: false })
    git(wt, 'push', '-q', '-u', 'origin', 'feat')
    const pushed = sha(wt, 'HEAD')
    commit(root, 'm.txt', 'm\n', 'main moved on')
    git(root, 'push', '-q', 'origin', 'main')
    expect(await syncWorktree({ root, worktree: wt })).toEqual({ ok: true, ...LOCAL_MAIN })
    expect(git(wt, 'log', '-1', '--format=%P', 'HEAD').trim().split(' ')).toEqual([pushed, sha(root, 'main')])
    expect(git(wt, 'log', '-1', '--format=%s', 'HEAD').trim()).toBe("Merge branch 'main' into feat")
    expect(sha(bare, 'feat')).toBe(pushed)
  })

  it('merges the base the same way whatever the user git config says about merges and rebases', async () => {
    const { root, wt } = setup({ github: false })
    git(wt, 'push', '-q', '-u', 'origin', 'feat')
    const pushed = sha(wt, 'HEAD')
    commit(root, 'm.txt', 'm\n', 'main moved on')
    git(root, 'push', '-q', 'origin', 'main')
    git(root, 'config', 'merge.ff', 'only')
    git(root, 'config', 'branch.feat.mergeOptions', '--squash --no-commit')
    git(root, 'config', 'merge.log', 'true')
    expect(await syncWorktree({ root, worktree: wt })).toEqual({ ok: true, ...LOCAL_MAIN })
    expect(git(wt, 'log', '-1', '--format=%P%n%B', 'HEAD').trim()).toBe(`${pushed} ${sha(root, 'main')}\nMerge branch 'main' into feat`)

    // rebase.autoSquash is not set here: git reads it only for an interactive rebase, which 同步 never runs.
    const fresh = setup({ github: false })
    commit(fresh.wt, 'c.txt', 'c\n', 'more on feat')
    commit(fresh.root, 'm.txt', 'm\n', 'main moved on')
    git(fresh.root, 'config', 'rebase.updateRefs', 'true')
    git(fresh.wt, 'branch', 'side', 'HEAD~1')
    const side = sha(fresh.wt, 'side')
    expect(await syncWorktree({ root: fresh.root, worktree: fresh.wt })).toEqual({ ok: true, ...LOCAL_MAIN })
    expect(git(fresh.wt, 'log', '--format=%s', 'HEAD').trim().split('\n')).toEqual(['more on feat', 'Make nav sticky', 'main moved on', 'init'])
    expect(sha(fresh.wt, 'side')).toBe(side)
  })

  it('merges into a branch pushed with an upstream although git keeps no remote-tracking ref of it, never rebasing it', async () => {
    const { root, wt } = setup({ github: false })
    git(root, 'config', 'remote.origin.fetch', '+refs/heads/main:refs/remotes/origin/main')
    git(wt, 'push', '-q', '-u', 'origin', 'feat')
    const pushed = sha(wt, 'HEAD')
    commit(root, 'm.txt', 'm\n', 'main moved on')
    git(root, 'push', '-q', 'origin', 'main')
    expect(await syncWorktree({ root, worktree: wt })).toEqual({ ok: true, ...LOCAL_MAIN })
    expect(git(wt, 'log', '-1', '--format=%P', 'HEAD').trim().split(' ')).toEqual([pushed, sha(root, 'main')])
  })

  it('fetches only the base and the branch, so a stale ref elsewhere on the remote cannot block it', async () => {
    const { root, wt, bare } = setup({ github: false })
    const other = cloneOf(bare)
    git(other, 'switch', '-q', '-c', 'foo/bar')
    git(other, 'push', '-q', 'origin', 'foo/bar')
    git(other, 'switch', '-q', 'main')
    commit(other, 'up.txt', 'u\n', 'upstream work')
    git(other, 'push', '-q', 'origin', 'main')
    // A branch the remote deleted and replaced: a whole-remote fetch cannot create origin/foo/bar next to it.
    git(root, 'update-ref', 'refs/remotes/origin/foo', sha(root, 'main'))
    expect(() => git(root, 'fetch', '-q', 'origin')).toThrow()
    expect(await syncWorktree({ root, worktree: wt })).toEqual({ ok: true, ...LOCAL_MAIN })
    expect(sha(root, 'main')).toBe(sha(bare, 'main'))
  })

  it('still syncs a pushed branch whose remote branch was deleted (a merged PR), merging the base as for any pushed branch', async () => {
    const { root, wt, bare } = setup({ github: false })
    git(wt, 'push', '-q', '-u', 'origin', 'feat')
    const pushed = sha(wt, 'HEAD')
    git(wt, 'push', '-q', 'origin', ':refs/heads/feat')
    const other = cloneOf(bare)
    commit(other, 'up.txt', 'u\n', 'upstream work')
    git(other, 'push', '-q', 'origin', 'main')
    expect(await syncWorktree({ root, worktree: wt })).toEqual({ ok: true, ...LOCAL_MAIN })
    expect(sha(root, 'main')).toBe(sha(bare, 'main'))
    expect(git(wt, 'log', '-1', '--format=%P', 'HEAD').trim().split(' ')).toEqual([pushed, sha(bare, 'main')])
  })

  // R75: a remote added and never fetched (no remote-tracking ref of the base yet) is fetched all the same; a remote that
  // has no such branch is not a failure, 同步 goes on with the local base.
  it('fetches the base from its remote although no remote-tracking ref of it exists yet', async () => {
    const { root, wt, bare } = setup({ github: false })
    const other = cloneOf(bare)
    commit(other, 'up.txt', 'u\n', 'upstream work')
    git(other, 'push', '-q', 'origin', 'main')
    git(root, 'update-ref', '-d', 'refs/remotes/origin/main')
    expect(await syncWorktree({ root, worktree: wt })).toEqual({ ok: true, ...LOCAL_MAIN })
    expect(sha(root, 'main')).toBe(sha(bare, 'main'))
    expect(git(wt, 'log', '--format=%s', 'HEAD').trim().split('\n')).toEqual(['Make nav sticky', 'upstream work', 'init'])

    const gone = setup({ github: false })
    commit(gone.root, 'm.txt', 'm\n', 'local main work')
    git(gone.root, 'update-ref', '-d', 'refs/remotes/origin/main')
    git(gone.bare, 'branch', '-q', '-m', 'main', 'trunk')
    expect(await syncWorktree({ root: gone.root, worktree: gone.wt })).toEqual({ ok: true, ...LOCAL_MAIN })
    expect(git(gone.wt, 'log', '--format=%s', 'HEAD').trim().split('\n')).toEqual(['Make nav sticky', 'local main work', 'init'])
  })

  it('brings in what the preflight counts against when the local base cannot catch up, so 同步 is never a no-op', async () => {
    const { root, wt, bare } = setup({ github: false })
    const other = cloneOf(bare)
    commit(other, 'up.txt', 'u\n', 'upstream work')
    git(other, 'push', '-q', 'origin', 'main')
    git(root, 'fetch', '-q', 'origin')
    writeFileSync(join(root, 'a.txt'), 'edited in the main checkout\n')
    expect(await shipPreflight({ root, worktree: wt })).toMatchObject({ ok: true, behindBase: 1 })
    expect(await syncWorktree({ root, worktree: wt })).toEqual({ ok: true, baseNotCaughtUp: 'main 的工作区有未提交的改动，没有快进到 origin/main', ...ORIGIN_MAIN })
    expect(git(wt, 'log', '--format=%s', 'HEAD').trim().split('\n')).toEqual(['Make nav sticky', 'upstream work', 'init'])
    expect(await shipPreflight({ root, worktree: wt })).toMatchObject({ ok: true, behindBase: 0 })

    // A pushed branch merges it, with the message git writes for a remote-tracking branch.
    const pushedOne = setup({ github: false })
    git(pushedOne.wt, 'push', '-q', '-u', 'origin', 'feat')
    const elsewhere = cloneOf(pushedOne.bare)
    commit(elsewhere, 'up.txt', 'u\n', 'upstream work')
    git(elsewhere, 'push', '-q', 'origin', 'main')
    writeFileSync(join(pushedOne.root, 'a.txt'), 'edited in the main checkout\n')
    expect(await syncWorktree({ root: pushedOne.root, worktree: pushedOne.wt })).toEqual({ ok: true, baseNotCaughtUp: 'main 的工作区有未提交的改动，没有快进到 origin/main', ...ORIGIN_MAIN })
    expect(git(pushedOne.wt, 'log', '-1', '--format=%P%n%s', 'HEAD').trim()).toBe(
      `${sha(pushedOne.wt, 'HEAD^1')} ${sha(pushedOne.bare, 'main')}\nMerge remote-tracking branch 'origin/main' into feat`
    )
  })

  it('fetches first and fast-forwards the clean base checkout to its upstream before bringing it in', async () => {
    const { root, wt, bare } = setup({ github: false })
    const other = cloneOf(bare)
    commit(other, 'up.txt', 'u\n', 'upstream work')
    git(other, 'push', '-q', 'origin', 'main')
    expect(await syncWorktree({ root, worktree: wt })).toEqual({ ok: true, ...LOCAL_MAIN })
    expect(sha(root, 'main')).toBe(sha(bare, 'main'))
    expect(existsSync(join(root, 'up.txt'))).toBe(true)
    expect(git(wt, 'log', '--format=%s', 'HEAD').trim().split('\n')).toEqual(['Make nav sticky', 'upstream work', 'init'])
  })

  it('leaves a base that diverged from its upstream alone, says why, and syncs with it as it is', async () => {
    const { root, wt, bare } = setup({ github: false })
    const other = cloneOf(bare)
    commit(other, 'up.txt', 'u\n', 'upstream work')
    git(other, 'push', '-q', 'origin', 'main')
    git(root, 'update-ref', 'refs/heads/main', git(root, 'commit-tree', '-p', 'main', '-m', 'local only', 'main^{tree}').trim())
    const before = sha(root, 'main')
    const result = await syncWorktree({ root, worktree: wt })
    expect(result).toEqual({ ok: true, baseNotCaughtUp: 'main 和 origin/main 各有对方没有的提交，没法快进', ...LOCAL_MAIN })
    expect(sha(root, 'main')).toBe(before)
    expect(git(wt, 'log', '--format=%s', 'HEAD').trim().split('\n')).toEqual(['Make nav sticky', 'local only', 'init'])
  })

  it('leaves a base whose checkout has uncommitted changes alone, and says why', async () => {
    const { root, wt, bare } = setup({ github: false })
    const other = cloneOf(bare)
    commit(other, 'up.txt', 'u\n', 'upstream work')
    git(other, 'push', '-q', 'origin', 'main')
    writeFileSync(join(root, 'a.txt'), 'edited in the main checkout\n')
    const before = sha(root, 'main')
    expect(await syncWorktree({ root, worktree: wt })).toEqual({ ok: true, baseNotCaughtUp: 'main 的工作区有未提交的改动，没有快进到 origin/main', ...ORIGIN_MAIN })
    expect(sha(root, 'main')).toBe(before)
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('edited in the main checkout\n')
  })

  it('answers the files that would conflict and starts nothing: HEAD, index and working tree stay as they were', async () => {
    const { root, wt } = conflicting()
    writeFileSync(join(wt, 'scratch.txt'), 's\n')
    const before = snapshot(wt)
    expect(await syncWorktree({ root, worktree: wt })).toEqual({ ok: false, reason: 'conflicts', files: ['a.txt'], mode: 'rebase', conflicts: [{ path: 'a.txt', type: 'content' }], ...LOCAL_MAIN })
    expect(snapshot(wt)).toEqual(before)
    git(wt, 'push', '-q', '-u', 'origin', 'feat')
    expect(await syncWorktree({ root, worktree: wt })).toMatchObject({ ok: false, reason: 'conflicts', files: ['a.txt'], mode: 'merge', ...LOCAL_MAIN })
    expect(snapshot(wt)).toEqual(before)
  })

  it('refuses tracked uncommitted changes, not untracked files', async () => {
    const { root, wt } = setup({ github: false })
    commit(root, 'm.txt', 'm\n', 'main moved on')
    writeFileSync(join(wt, 'b.txt'), 'changed\n')
    expect(await syncWorktree({ root, worktree: wt })).toEqual({ ok: false, reason: 'blocked', message: '先提交改动' })
    git(wt, 'checkout', '--', 'b.txt')
    writeFileSync(join(wt, 'new.txt'), 'n\n')
    expect(await syncWorktree({ root, worktree: wt })).toEqual({ ok: true, ...LOCAL_MAIN })
    expect(existsSync(join(wt, 'new.txt'))).toBe(true)
  })

  it('aborts a rebase that stops on conflicts the pre-check could not see, and answers them', async () => {
    // feat changes a line and changes it back: the branches merge cleanly, but replaying the first commit conflicts.
    const { root, wt } = setup({ github: false })
    commit(wt, 'a.txt', 'one\nFEAT\nthree\n', 'feat edits a')
    commit(wt, 'a.txt', 'one\ntwo\nthree\n', 'feat reverts a')
    commit(root, 'a.txt', 'one\nMAIN\nthree\n', 'main edits a')
    const before = snapshot(wt)
    expect(await syncWorktree({ root, worktree: wt })).toEqual({ ok: false, reason: 'conflicts', files: ['a.txt'], mode: 'rebase', conflicts: [], ...LOCAL_MAIN })
    expect(snapshot(wt)).toEqual(before)
    expect(git(wt, 'symbolic-ref', '--short', 'HEAD').trim()).toBe('feat')
  })

  it('returns a fetch that failed, classified, and runs nothing else', async () => {
    const { root, wt } = setup({ github: false })
    commit(root, 'm.txt', 'm\n', 'main moved on')
    git(root, 'remote', 'set-url', 'origin', join(base, 'gone.git'))
    const before = snapshot(wt)
    const result = await syncWorktree({ root, worktree: wt })
    expect(result).toMatchObject({ ok: false, reason: 'failed', step: 'fetch', failure: { kind: 'no-remote', message: '没有远程仓库，没法拉取' } })
    expect(snapshot(wt)).toEqual(before)
  })

  it('does nothing when the branch has every base commit, and refuses strangers and an operation in progress', async () => {
    const { root, wt } = setup({ github: false })
    const head = sha(wt, 'HEAD')
    expect(await syncWorktree({ root, worktree: wt })).toEqual({ ok: true, ...LOCAL_MAIN })
    expect(sha(wt, 'HEAD')).toBe(head)
    expect(await syncWorktree({ root: join(base, 'elsewhere'), worktree: wt })).toEqual({ ok: false, reason: 'blocked', message: '请求无效' })
    expect(await syncWorktree({ root, worktree: root })).toMatchObject({ ok: false, reason: 'blocked' })
    const stuck = conflicting()
    gitFails(stuck.wt, 'merge', 'main')
    expect(await syncWorktree({ root: stuck.root, worktree: stuck.wt })).toEqual({ ok: false, reason: 'blocked', message: 'merge 进行中' })
  })
})

describe('拉取', () => {
  it('fast-forwards the branch to the remote branch, and refuses a diverged one', async () => {
    const { root, wt, bare } = setup({ github: false })
    git(wt, 'push', '-q', '-u', 'origin', 'feat')
    const other = cloneOf(bare)
    git(other, 'checkout', '-q', 'feat')
    commit(other, 'r.txt', 'r\n', 'from elsewhere')
    git(other, 'push', '-q', 'origin', 'feat')
    expect(await pullWorktree({ root, worktree: wt })).toEqual({ ok: true })
    expect(sha(wt, 'HEAD')).toBe(sha(bare, 'feat'))

    commit(other, 'r2.txt', 'r\n', 'more from elsewhere')
    git(other, 'push', '-q', 'origin', 'feat')
    commit(wt, 'l.txt', 'l\n', 'mine')
    const mine = sha(wt, 'HEAD')
    const result = await pullWorktree({ root, worktree: wt })
    expect(result).toMatchObject({ ok: false, reason: 'failed', failure: { kind: 'diverged', message: '远程分支和本地分叉', next: 'handoff' } })
    expect(sha(wt, 'HEAD')).toBe(mine)
  })

  it('fast-forwards a branch pushed with an upstream although git keeps no remote-tracking ref of it', async () => {
    const { root, wt, bare } = setup({ github: false })
    git(root, 'config', 'remote.origin.fetch', '+refs/heads/main:refs/remotes/origin/main')
    git(wt, 'push', '-q', '-u', 'origin', 'feat')
    const other = cloneOf(bare)
    git(other, 'checkout', '-q', 'feat')
    commit(other, 'r.txt', 'r\n', 'from elsewhere')
    git(other, 'push', '-q', 'origin', 'feat')
    expect(await pullWorktree({ root, worktree: wt })).toEqual({ ok: true })
    expect(sha(wt, 'HEAD')).toBe(sha(bare, 'feat'))
  })

  it('pushes no tags the user config would follow', async () => {
    const { root, wt, bare } = setup({ github: false })
    git(wt, 'push', '-q', '-u', 'origin', 'feat')
    commit(wt, 'c.txt', 'c\n', 'more')
    git(wt, 'tag', '-a', '-m', 'v', 'v9')
    git(root, 'config', 'push.followTags', 'true')
    expect(await pushBranch({ root, worktree: wt })).toMatchObject({ ok: true })
    expect(sha(bare, 'feat')).toBe(sha(wt, 'HEAD'))
    expect(git(bare, 'tag').trim()).toBe('')
  })

  it('says the remote no longer has the branch when it was deleted there (after its PR merged)', async () => {
    const { root, wt, bare } = setup({ github: false })
    git(wt, 'push', '-q', '-u', 'origin', 'feat')
    git(bare, 'branch', '-D', 'feat')
    const head = sha(wt, 'HEAD')
    expect(await pullWorktree({ root, worktree: wt })).toEqual({ ok: false, reason: 'blocked', message: 'origin 上已经没有分支 feat' })
    expect(sha(wt, 'HEAD')).toBe(head)
  })

  it('needs a branch that was pushed and a remote', async () => {
    const { root, wt } = setup({ github: false })
    expect(await pullWorktree({ root, worktree: wt })).toEqual({ ok: false, reason: 'blocked', message: '分支还没有推送过' })
    const none = setup({ remote: false })
    expect(await pullWorktree({ root: none.root, worktree: none.wt })).toEqual({ ok: false, reason: 'blocked', message: '没有远程仓库，没法拉取' })
  })
})

describe('继续 / 中止', () => {
  it('merge: 继续 answers unresolved files, then commits once they are resolved', async () => {
    const { root, wt } = conflicting()
    const head = sha(wt, 'HEAD')
    gitFails(wt, 'merge', 'main')
    expect(await shipOperation({ root, worktree: wt, action: 'continue' })).toEqual({ ok: false, reason: 'conflicts', files: ['a.txt'] })
    writeFileSync(join(wt, 'a.txt'), 'one\nboth\nthree\n')
    git(wt, 'add', 'a.txt')
    expect(await shipOperation({ root, worktree: wt, action: 'continue' })).toEqual({ ok: true })
    expect(git(wt, 'log', '-1', '--format=%P', 'HEAD').trim().split(' ')).toEqual([head, sha(root, 'main')])
    expect(await shipPreflight({ root, worktree: wt })).toMatchObject({ ok: true, operation: null })
    expect(await shipOperation({ root, worktree: wt, action: 'continue' })).toEqual({ ok: false, reason: 'blocked', message: '没有进行中的合并、rebase 或 cherry-pick' })
  })

  it('merge: 中止 puts the branch back', async () => {
    const { root, wt } = conflicting()
    const before = snapshot(wt)
    gitFails(wt, 'merge', 'main')
    expect(await shipOperation({ root, worktree: wt, action: 'abort' })).toEqual({ ok: true })
    expect(snapshot(wt)).toEqual(before)
  })

  it('rebase: 继续 stops again on the next commit, and finishes on the branch', async () => {
    const { root, wt } = setup({ github: false })
    commit(wt, 'a.txt', 'one\nFEAT 1\nthree\n', 'feat one')
    commit(wt, 'a.txt', 'one\nFEAT 2\nthree\n', 'feat two')
    commit(root, 'a.txt', 'one\nMAIN\nthree\n', 'main edits a')
    gitFails(wt, 'rebase', 'main')
    expect(await shipOperation({ root, worktree: wt, action: 'continue' })).toEqual({ ok: false, reason: 'conflicts', files: ['a.txt'] })
    writeFileSync(join(wt, 'a.txt'), 'one\nFEAT 1 + MAIN\nthree\n')
    git(wt, 'add', 'a.txt')
    // The second commit conflicts with the resolution of the first.
    expect(await shipOperation({ root, worktree: wt, action: 'continue' })).toEqual({ ok: false, reason: 'conflicts', files: ['a.txt'] })
    writeFileSync(join(wt, 'a.txt'), 'one\nFEAT 2 + MAIN\nthree\n')
    git(wt, 'add', 'a.txt')
    expect(await shipOperation({ root, worktree: wt, action: 'continue' })).toEqual({ ok: true })
    expect(git(wt, 'symbolic-ref', '--short', 'HEAD').trim()).toBe('feat')
    expect(git(wt, 'log', '--format=%s', 'HEAD').trim().split('\n')).toEqual(['feat two', 'feat one', 'Make nav sticky', 'main edits a', 'init'])
  })

  it('rebase: 中止 puts the branch back where it was', async () => {
    const { root, wt } = conflicting()
    const before = snapshot(wt)
    gitFails(wt, 'rebase', 'main')
    expect(await shipOperation({ root, worktree: wt, action: 'abort' })).toEqual({ ok: true })
    expect(snapshot(wt)).toEqual(before)
    expect(git(wt, 'symbolic-ref', '--short', 'HEAD').trim()).toBe('feat')
  })

  it('rebase: 中止 asks first when resolutions or other edits would be lost, and goes ahead when told to', async () => {
    const { root, wt } = setup({ github: false })
    commit(wt, 'a.txt', 'one\nFEAT\nthree\n', 'feat edits a')
    commit(wt, 'u.txt', 'u\n', 'feat adds u')
    commit(root, 'a.txt', 'one\nMAIN\nthree\n', 'main edits a')
    gitFails(wt, 'rebase', 'main')
    writeFileSync(join(wt, 'b.txt'), 'edited while stopped\n')
    expect(await shipOperation({ root, worktree: wt, action: 'abort' })).toEqual({ ok: false, reason: 'confirm', files: ['b.txt'] })
    git(wt, 'checkout', '--', 'b.txt')
    writeFileSync(join(wt, 'a.txt'), 'one\nFEAT + MAIN\nthree\n')
    git(wt, 'add', 'a.txt')
    expect(await shipOperation({ root, worktree: wt, action: 'abort' })).toEqual({ ok: false, reason: 'confirm', files: ['a.txt'] })
    expect(await shipOperation({ root, worktree: wt, action: 'abort', force: true })).toEqual({ ok: true })
    expect(git(wt, 'symbolic-ref', '--short', 'HEAD').trim()).toBe('feat')
  })

  // R29: a file edited while the confirmation was open is named before it is lost.
  it('rebase: a forced 中止 asks again when it would now lose a file the user was not shown', async () => {
    const { root, wt } = setup({ github: false })
    commit(wt, 'a.txt', 'one\nFEAT\nthree\n', 'feat edits a')
    commit(wt, 'u.txt', 'u\n', 'feat adds u')
    commit(root, 'c.txt', 'c\n', 'main adds c')
    commit(root, 'a.txt', 'one\nMAIN\nthree\n', 'main edits a')
    gitFails(wt, 'rebase', 'main')
    writeFileSync(join(wt, 'b.txt'), 'edited while stopped\n')
    expect(await shipOperation({ root, worktree: wt, action: 'abort' })).toEqual({ ok: false, reason: 'confirm', files: ['b.txt'] })
    // The sheet is open; the agent edits another tracked file.
    writeFileSync(join(wt, 'c.txt'), 'edited too\n')
    expect(await shipOperation({ root, worktree: wt, action: 'abort', force: true, confirmed: ['b.txt'] })).toEqual({ ok: false, reason: 'confirm', files: ['b.txt', 'c.txt'] })
    expect(await shipOperation({ root, worktree: wt, action: 'abort', force: true, confirmed: ['b.txt', 'c.txt'] })).toEqual({ ok: true })
    expect(git(wt, 'symbolic-ref', '--short', 'HEAD').trim()).toBe('feat')
  })

  it('cherry-pick: 中止 does not count what git staged for the stopped commit itself, nor an edit the abort keeps', async () => {
    const { root, wt } = setup({ github: false })
    commit(wt, 'a.txt', 'one\nFEAT\nthree\n', 'feat edits a')
    git(root, 'switch', '-q', '-c', 'pick')
    writeFileSync(join(root, 'a.txt'), 'one\nPICK\nthree\n')
    writeFileSync(join(root, 'clean.txt'), 'c\n')
    git(root, 'add', '.')
    git(root, 'commit', '-q', '-m', 'to pick')
    git(root, 'switch', '-q', 'main')
    // An edit the cherry-pick does not touch: `cherry-pick --abort` (reset --merge) keeps it.
    writeFileSync(join(wt, 'b.txt'), 'edited, not staged\n')
    gitFails(wt, 'cherry-pick', 'pick')
    expect(await shipOperation({ root, worktree: wt, action: 'abort' })).toEqual({ ok: true })
    expect(git(wt, 'status', '--porcelain', '--untracked-files=no').trim()).toBe('M b.txt')
    expect(readFileSync(join(wt, 'b.txt'), 'utf8')).toBe('edited, not staged\n')
  })

  it('rebase: 中止 asks about a conflicted file edited since the stop although it is not staged yet', async () => {
    const { root, wt } = conflicting()
    gitFails(wt, 'rebase', 'main')
    expect(await shipOperation({ root, worktree: wt, action: 'abort' })).toEqual({ ok: true })
    gitFails(wt, 'rebase', 'main')
    writeFileSync(join(wt, 'a.txt'), 'one\nboth, resolved by hand\nthree\n')
    expect(await shipOperation({ root, worktree: wt, action: 'abort' })).toEqual({ ok: false, reason: 'confirm', files: ['a.txt'] })
    expect(await shipOperation({ root, worktree: wt, action: 'abort', force: true })).toEqual({ ok: true })
  })

  it('merge: 中止 asks about staged resolutions and edited conflicted files, not about an edit the abort keeps', async () => {
    const { root, wt } = setup({ github: false })
    commit(wt, 'a.txt', 'one\nFEAT\nthree\n', 'feat edits a')
    commit(wt, 'c.txt', 'feat c\n', 'feat adds c')
    commit(root, 'a.txt', 'one\nMAIN\nthree\n', 'main edits a')
    commit(root, 'c.txt', 'main c\n', 'main adds c')
    // An edit the merge does not touch: `merge --abort` (reset --merge) keeps it.
    writeFileSync(join(wt, 'b.txt'), 'edited, not staged\n')
    gitFails(wt, 'merge', 'main')
    expect(await shipOperation({ root, worktree: wt, action: 'abort' })).toEqual({ ok: true })
    expect(readFileSync(join(wt, 'b.txt'), 'utf8')).toBe('edited, not staged\n')

    gitFails(wt, 'merge', 'main')
    writeFileSync(join(wt, 'a.txt'), 'one\nFEAT + MAIN\nthree\n')
    git(wt, 'add', 'a.txt')
    expect(await shipOperation({ root, worktree: wt, action: 'abort' })).toEqual({ ok: false, reason: 'confirm', files: ['a.txt'] })
    writeFileSync(join(wt, 'c.txt'), 'both c\n')
    expect(await shipOperation({ root, worktree: wt, action: 'abort' })).toEqual({ ok: false, reason: 'confirm', files: ['a.txt', 'c.txt'] })
    expect(await shipOperation({ root, worktree: wt, action: 'abort', force: true })).toEqual({ ok: true })
    expect(readFileSync(join(wt, 'a.txt'), 'utf8')).toBe('one\nFEAT\nthree\n')
    expect(readFileSync(join(wt, 'b.txt'), 'utf8')).toBe('edited, not staged\n')
  })

  it('without AUTO_MERGE (git < 2.42) 中止 asks about every staged change besides the unresolved files', async () => {
    const dropAutoMerge = (cwd: string) => rmSync(join(cwd, git(cwd, 'rev-parse', '--git-path', 'AUTO_MERGE').trim()), { force: true })
    for (const kind of ['rebase', 'merge'] as const) {
      const { root, wt } = setup({ github: false })
      commit(wt, 'a.txt', 'one\nFEAT\nthree\n', 'feat edits a')
      commit(wt, 'c.txt', 'feat c\n', 'feat adds c')
      commit(root, 'a.txt', 'one\nMAIN\nthree\n', 'main edits a')
      commit(root, 'c.txt', 'main c\n', 'main adds c')
      gitFails(wt, kind, 'main')
      dropAutoMerge(wt)
      expect(await shipOperation({ root, worktree: wt, action: 'abort' })).toEqual({ ok: true })
      gitFails(wt, kind, 'main')
      dropAutoMerge(wt)
      writeFileSync(join(wt, 'a.txt'), 'one\nFEAT + MAIN\nthree\n')
      git(wt, 'add', 'a.txt')
      expect(await shipOperation({ root, worktree: wt, action: 'abort' })).toEqual({ ok: false, reason: 'confirm', files: ['a.txt'] })
      expect(await shipOperation({ root, worktree: wt, action: 'abort', force: true })).toEqual({ ok: true })
    }
  })

  it('refuses bad requests', async () => {
    const { root, wt } = setup({ github: false })
    expect(await shipOperation({ root, worktree: wt, action: 'skip' })).toEqual({ ok: false, reason: 'blocked', message: '请求无效' })
    expect(await shipOperation({ root: join(base, 'elsewhere'), worktree: wt, action: 'abort' })).toEqual({ ok: false, reason: 'blocked', message: '请求无效' })
  })
})

describe('合并到 base 并推送 · the preflight remote and every method', () => {
  for (const method of ['squash', 'merge', 'rebase'] as const) {
    it(`${method}: pushes to the preflight's remote when it is not called origin`, async () => {
      const { root, wt, bare } = setup({ remote: false })
      git(root, 'remote', 'add', 'upstream', bare)
      git(root, 'push', '-q', '-u', 'upstream', 'main')
      commit(root, 'm.txt', 'm\n', 'main moved on')
      git(root, 'push', '-q', 'upstream', 'main')
      const result = await shipToMain({ root, worktree: wt, message: 'feat: b', method, paths: null })
      expect(result).toMatchObject({ ok: true, pushed: true })
      if (!result.ok) throw new Error('not shipped')
      expect(sha(bare, 'main')).toBe(result.commit)
      expect(sha(root, 'main')).toBe(result.commit)
      const subjects = git(bare, 'log', '--format=%s', 'main').trim().split('\n')
      if (method === 'squash') expect(subjects).toEqual(['feat: b', 'main moved on', 'init'])
      if (method === 'merge') expect(subjects[0]).toBe("Merge branch 'feat'")
      if (method === 'rebase') expect(subjects).toEqual(['Make nav sticky', 'main moved on', 'init'])
    })
  }

  it('pushes the base to the remote the base tracks, not to the fork the branch was published to', async () => {
    const { root, wt, bare } = setup({ github: false })
    const fork = join(base, `fork-${++counter}.git`)
    git(base, 'init', '-q', '--bare', '-b', 'main', fork)
    git(root, 'remote', 'add', 'myfork', fork)
    git(root, 'push', '-q', 'myfork', 'main')
    git(wt, 'push', '-q', '-u', 'myfork', 'feat')
    const forkMain = sha(fork, 'main')
    const result = await shipToMain({ root, worktree: wt, message: 'feat: b', method: 'merge', paths: null })
    expect(result).toMatchObject({ ok: true, pushed: true })
    expect(sha(bare, 'main')).toBe(sha(root, 'main'))
    expect(sha(fork, 'main')).toBe(forkMain)
    expect(await shipPreflight({ root, worktree: wt })).toMatchObject({ ok: true, remote: 'myfork', baseAheadOfUpstream: 0 })
  })

  it('pushes the base to origin, not to the fork, when the base was pushed without an upstream', async () => {
    const { root, wt, bare } = setup({ github: false })
    git(root, 'branch', '--unset-upstream', 'main')
    const fork = join(base, `fork-${++counter}.git`)
    git(base, 'init', '-q', '--bare', '-b', 'main', fork)
    git(root, 'remote', 'add', 'myfork', fork)
    git(root, 'push', '-q', 'myfork', 'main')
    git(wt, 'push', '-q', '-u', 'myfork', 'feat')
    const forkMain = sha(fork, 'main')
    expect(await shipToMain({ root, worktree: wt, message: 'feat: b', method: 'merge', paths: null })).toMatchObject({ ok: true, pushed: true })
    expect(sha(bare, 'main')).toBe(sha(root, 'main'))
    expect(sha(fork, 'main')).toBe(forkMain)
  })

  it('moves neither the base nor its catch-up while a rebase of the base is stopped elsewhere with HEAD detached', async () => {
    const { root, wt, bare } = setup({ github: false })
    commit(root, 'b2.txt', 'b\n', 'second on main')
    git(root, 'push', '-q', 'origin', 'main')
    const other = cloneOf(bare)
    commit(other, 'up.txt', 'u\n', 'upstream work')
    git(other, 'push', '-q', 'origin', 'main')
    execFileSync('git', ['-c', 'rebase.abbreviateCommands=false', 'rebase', '-i', 'HEAD~1'], { cwd: root, env: { ...process.env, GIT_SEQUENCE_EDITOR: "sed -i.bak 's/^pick /edit /'" }, stdio: 'ignore' })
    const before = sha(root, 'refs/heads/main')
    expect(await shipToMain({ root, worktree: wt, message: 'feat: b', method: 'merge', paths: null })).toMatchObject({
      ok: false,
      step: 'merge',
      reason: 'blocked',
      message: 'main 的工作区里有进行中的变基：先完成或放弃它'
    })
    expect(sha(root, 'refs/heads/main')).toBe(before)
    git(root, 'rebase', '--continue')
  })

  it('retries a push to that remote, and reads CI where it lives', async () => {
    const { root, wt, bare } = setup({ remote: false })
    git(root, 'remote', 'add', 'gh', 'https://github.com/acme/widget.git')
    git(root, 'config', 'remote.gh.pushurl', bare)
    git(root, 'config', 'protocol.https.allow', 'never')
    git(root, 'push', '-q', '-u', 'gh', 'main')
    const hook = join(bare, 'hooks', 'pre-receive')
    writeFileSync(hook, '#!/bin/sh\nexit 1\n')
    chmodSync(hook, 0o755)
    const first = await shipToMain({ root, worktree: wt, message: 'feat: b', method: 'merge', paths: null })
    expect(first).toMatchObject({ ok: true, pushed: false, pushError: expect.stringMatching(/^推送到 gh 失败/) })
    if (!first.ok) throw new Error('not merged')
    rmSync(hook)
    expect(await pushBaseAgain({ root, worktree: wt })).toEqual({ ok: true, commit: first.commit, pushed: true })
    expect(sha(bare, 'main')).toBe(first.commit)
    expect(await checkBaseCi(wt, true)).toMatchObject({ base: 'main', sha: first.commit, url: `https://github.com/acme/widget/commit/${first.commit}/checks` })
  })
})
