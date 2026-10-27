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

// Dozens of git processes per test: more than the default 5 s when the whole suite runs at once.
vi.setConfig({ testTimeout: 60_000 })

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
    echo "github.com: Logged in"; exit 0 ;;
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

const { detectGh, checkWorktree, watchTargets, unwatch } = await import('./pull-requests')
const { baseCi, baseFailing, baseFailure, checkBaseCi, commitRollup, diffSince, discardSince, handoffSlot, pushRejectedByProtection, readHandoffText, resetShip, shipPreflight, shipRisks, shipToMain } = await import('./ship')

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
function setup(options: { github?: boolean; remote?: boolean } = {}): { root: string; wt: string; bare: string } {
  const n = ++counter
  const root = join(base, `repo-${n}`)
  const bare = join(base, `bare-${n}.git`)
  mkdirSync(root)
  git(base, 'init', '-q', '--bare', '-b', 'main', bare)
  git(root, 'init', '-q', '-b', 'main')
  commit(root, 'a.txt', 'one\ntwo\nthree\n', 'init')
  if (options.remote !== false) {
    if (options.github !== false) {
      git(root, 'remote', 'add', 'origin', 'https://github.com/acme/widget.git')
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
    expect(await shipPreflight({ root, worktree: 'relative' })).toEqual({ ok: false, message: '请求无效' })
    expect(await shipPreflight(null)).toEqual({ ok: false, message: '请求无效' })
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
      baseAheadOfUpstream: 0,
      baseBehindUpstream: 0,
      openPr: null
    })
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
    expect(baseCi({ root, worktree: wt })).toBeNull()
  })

  it('without paths and without a message keeps the branch own commit message', async () => {
    const { root, wt, bare } = setup()
    const result = await shipToMain({ root, worktree: wt, message: '', method: 'squash', paths: null })
    expect(result).toMatchObject({ ok: true, pushed: true })
    expect(git(bare, 'log', '-1', '--format=%B', 'main').trim()).toBe('Make nav sticky')
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
    expect(result).toEqual({ ok: false, step: 'merge', reason: 'blocked', message: '分支没有比 main 新的提交' })
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
    expect(sha(root, 'main')).toBe(result.commit)
    expect(git(root, 'log', '-1', '--format=%s', 'main').trim()).toBe('feat: b')
    expect(sha(bare, 'main')).toBe(before)
    expect(baseCi({ root, worktree: wt })).toBeNull()
  })

  it('recognises the wording of a protected branch', () => {
    expect(pushRejectedByProtection('To github.com:a/b.git ! [remote rejected] main -> main (protected branch hook declined) error: failed to push some refs')).toBe(true)
    expect(pushRejectedByProtection('remote: error: GH006: Protected branch update failed for refs/heads/main.')).toBe(true)
    expect(pushRejectedByProtection('remote: error: GH013: Repository rule violations found for refs/heads/main.')).toBe(true)
    expect(pushRejectedByProtection('! [rejected] main -> main (fetch first)')).toBe(false)
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
