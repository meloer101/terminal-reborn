// Failures in plain words (合入链路 v2, PRD v1.169): what git or gh printed when a step failed, read as one of a few
// kinds the user can act on, with the chain action that gets them unstuck. Pure; ship / PR results carry the answer.
// Wavi runs git without a terminal, so a login or key passphrase prompt cannot appear: those kinds point at the terminal
// and Wavi does not try to recover them itself.
import { isSignedOut, stripControl } from './pull-requests'
import { CHAIN_TEXT, type ChainActionId } from './ship-chain'

/** The step that failed. `pr-create` / `pr-merge` / `pr-status` are gh calls (`gh pr create` pushes the branch too;
 *  `pr-status` is the PR poll's `gh pr list`). */
export type GitStep = 'commit' | 'push' | 'pull' | 'merge' | 'rebase' | 'pr-create' | 'pr-merge' | 'fetch' | 'pr-status'

export type GitFailureKind =
  /** The remote has commits the pushed ref lacks (`! [rejected] … (non-fast-forward | fetch first)`). */
  | 'non-fast-forward'
  /** A fast-forward-only pull found the branch and its remote both moved. */
  | 'diverged'
  /** The remote refused the ref as protected (GitHub GH006 / GH013, GitLab). */
  | 'protected-branch'
  /** Another server-side hook refused the push. */
  | 'pre-receive-hook'
  | 'pre-push-hook'
  /** pre-commit, commit-msg, prepare-commit-msg or pre-merge-commit exited non-zero. */
  | 'commit-hook'
  /** git or gh has no usable login (a prompt Wavi cannot show). */
  | 'auth'
  /** The commit could not be signed (the key needs its passphrase, gpg is missing). */
  | 'signing'
  /** git does not know who the committer is (no user.name / user.email). */
  | 'identity'
  | 'no-remote'
  /** gh: the remote is not on a GitHub host it knows. */
  | 'not-github'
  /** gh: the branch has no PR. */
  | 'no-pr'
  | 'network'
  /** Uncommitted changes are in the way of a merge / rebase / pull. */
  | 'dirty'
  /** A merge or rebase stopped on conflicts. */
  | 'conflicts'
  | 'unknown'

/**
 * What gets the user on: a chain action (src/shared/ship-chain.ts), `handoff` (put the problem and the output tail into
 * the agent's input line, no Enter), `create-pr` (the run's 改为创建 PR), or null (nothing in Wavi; the message says
 * where to go).
 */
export type GitFailureNext = ChainActionId | 'handoff' | 'create-pr' | null

export interface GitFailure {
  kind: GitFailureKind
  /** One line of UI copy. */
  message: string
  next: GitFailureNext
  /** The last FAILURE_TAIL_LINES lines of what was printed, colors and control characters removed (hand-offs and the
   *  unknown kind quote it). */
  tail: string
}

export interface GitFailureContext {
  /** The worktree's base branch (a rejected push of the base offers no way on, a protected one is named). */
  base: string
  remote: string | null
}

export const FAILURE_TAIL_LINES = 40

/** The last `lines` lines: CRLF and carriage-return progress collapsed, colors and control characters out. */
export function failureTail(output: string, lines = FAILURE_TAIL_LINES): string {
  const kept = output
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => stripControl(line.split('\r').pop() ?? '').trimEnd())
  while (kept.length > 0 && kept[kept.length - 1] === '') kept.pop()
  return kept.slice(-lines).join('\n')
}

const STEP_WORD: Record<GitStep, string> = {
  commit: '提交',
  push: '推送',
  pull: '拉取',
  merge: '合并',
  rebase: 'rebase',
  'pr-create': '创建 PR',
  'pr-merge': '合并 PR',
  fetch: '获取远程',
  'pr-status': '读取 PR 状态'
}

const COMMIT_STEPS: ReadonlySet<GitStep> = new Set(['commit', 'merge', 'rebase'])
const GH_STEPS: ReadonlySet<GitStep> = new Set(['pr-create', 'pr-merge', 'pr-status'])
const FETCH_STEPS: ReadonlySet<GitStep> = new Set(['pull', 'fetch'])

const COMMIT_HOOKS = 'pre-commit|commit-msg|prepare-commit-msg|pre-merge-commit'
/** husky 8 (`husky - pre-push hook exited with code 1`) and 9 (`husky - pre-push script failed (code 1)`). */
const HUSKY = /husky - ([a-z-]+) (?:hook exited|script failed)/
const NAMED_HOOK = new RegExp(`\\b(pre-push|${COMMIT_HOOKS}) hook\\b(?! declined)`)
/** The pre-commit framework's report of a failed hook. */
const PRE_COMMIT_FRAMEWORK = /^- hook id: /m

const PROTECTED =
  /GH006|GH013|protected branch|branch protection|repository rule violations|Changes must be made through a pull request|required status checks?/i
const PROTECTED_REF = /(?:Protected branch update failed for|Repository rule violations found for) refs\/heads\/([^\s.]+(?:\.[^\s.]+)*)/
const REJECTED = /^\s*! \[rejected\]\s+\S+ -> (\S+) \((?:non-fast-forward|fetch first)\)/m
const NON_FF = /\((?:non-fast-forward|fetch first)\)|Updates were rejected because the (?:tip of your current branch is behind|remote contains work)/
const DIVERGED = /Not possible to fast-forward|Diverging branches can't be fast-forwarded|have diverged/i
const PRE_RECEIVE = /pre-receive hook declined/
const IDENTITY = /Please tell me who you are|empty ident name|unable to auto-detect email address/i
const SIGNING = /gpg failed to sign|signing failed|error: Load key|incorrect passphrase|cannot run gpg|No secret key|failed to write commit object/i
const AUTH =
  /Authentication failed|Permission denied \(publickey|could not read (?:Username|Password)|terminal prompts disabled|Host key verification failed|Repository not found|The requested URL returned error: 40[13]|Permission to \S+ denied/i
const NO_REMOTE = /does not appear to be a git repository|No configured push destination|No remote repository specified/
const NETWORK =
  /Could not resolve host|Could not resolve hostname|Connection timed out|Operation timed out|Connection refused|Connection reset|Failed to connect to|Couldn't connect to server|unable to access|RPC failed|kex_exchange_identification|Network is unreachable|error connecting to api\.|dial tcp|no such host|TLS handshake timeout/i
const NOT_GITHUB = /none of the git remotes configured for this repository point to a known GitHub host|not a GitHub (?:repository|host)/i
const NO_PR = /no (?:open )?pull requests found/i
const DIRTY = /local changes to the following files would be overwritten|untracked working tree files would be overwritten|cannot (?:rebase|pull with rebase): You have unstaged changes|Your index contains uncommitted changes|Please commit or stash them/i
const CONFLICTS = /^CONFLICT \(|Automatic merge failed|could not apply [0-9a-f]+/m
const PUSH_FAILED = /failed to push some refs/
const REMOTE_REJECTION = /! \[(?:rejected|remote rejected)\]/

/** The line an unknown failure is summed up by: git's last `fatal:` / `error:` line, else the last line. */
function summaryLine(tail: string): string {
  const lines = tail.split('\n').map((l) => l.trim()).filter(Boolean)
  const marked = [...lines].reverse().find((l) => /^(?:fatal|error):/i.test(l))
  const line = (marked ?? lines[lines.length - 1] ?? '').replace(/^(?:fatal|error):\s*/i, '')
  return line.length > 200 ? `${line.slice(0, 199)}…` : line
}

function authMessage(step: GitStep, output: string): string {
  if (GH_STEPS.has(step) && isSignedOut(output) && !AUTH.test(output)) {
    return step === 'pr-create' ? CHAIN_TEXT.ghSignedOut : 'gh 还没有登录：在终端运行 gh auth login'
  }
  return FETCH_STEPS.has(step) ? '拉取需要登录：在终端里运行一次 git fetch' : '推送需要登录：在终端里运行一次 git push'
}

/** What went wrong, from `output` (stderr and stdout of the failed step, in any order). */
export function classifyGitFailure(step: GitStep, output: string, context: GitFailureContext): GitFailure {
  const tail = failureTail(output)
  const text = tail
  const fail = (kind: GitFailureKind, message: string, next: GitFailureNext): GitFailure => ({ kind, message, next, tail })

  if (GH_STEPS.has(step)) {
    // gh's not-GitHub message ends with "gh auth login": read it before the login rules do.
    if (NOT_GITHUB.test(text)) return fail('not-github', CHAIN_TEXT.notGitHub, null)
    if (NO_PR.test(text)) return fail('no-pr', CHAIN_TEXT.noPr, 'pr')
  }

  // A hook that says its own name failed before git reached the remote or wrote the commit.
  const hook = HUSKY.exec(text)?.[1] ?? NAMED_HOOK.exec(text)?.[1] ?? (PRE_COMMIT_FRAMEWORK.test(text) ? 'pre-commit' : null)
  if (hook === 'pre-push') return fail('pre-push-hook', 'pre-push hook 没通过', 'handoff')
  if (hook && new RegExp(`^(?:${COMMIT_HOOKS})$`).test(hook)) return fail('commit-hook', `${hook} hook 没通过`, 'handoff')

  if (COMMIT_STEPS.has(step) && IDENTITY.test(text)) return fail('identity', 'git 还不知道提交者是谁：在终端里设置 user.name 和 user.email', null)

  // The same key words mean a commit that could not be signed, or a push whose SSH key wants its passphrase.
  if (COMMIT_STEPS.has(step) && SIGNING.test(text)) return fail('signing', '提交签名需要口令', null)

  // 改为创建 PR only answers a refused push; a PR that GitHub will not merge is already the way round the protection.
  if (PROTECTED.test(text)) return fail('protected-branch', `${PROTECTED_REF.exec(text)?.[1] ?? context.base} 受保护`, step === 'push' ? 'create-pr' : null)
  if (NON_FF.test(text)) {
    // The base itself refused (exit A's push): 同步 brings the base into the branch, 拉取 moves the branch; neither
    // repairs a local base that diverged from its remote, so nothing in Wavi is offered.
    const ref = REJECTED.exec(text)?.[1]
    return fail('non-fast-forward', CHAIN_TEXT.remoteAhead, ref === context.base ? null : 'pull')
  }
  if (DIVERGED.test(text)) return fail('diverged', CHAIN_TEXT.diverged, 'handoff')
  if (PRE_RECEIVE.test(text)) return fail('pre-receive-hook', '远程的 pre-receive hook 拒绝了推送', 'handoff')

  if (AUTH.test(text) || (GH_STEPS.has(step) && isSignedOut(text))) return fail('auth', authMessage(step, text), null)
  if (NO_REMOTE.test(text)) return fail('no-remote', FETCH_STEPS.has(step) ? CHAIN_TEXT.noRemotePull : CHAIN_TEXT.noRemotePush, null)
  if (NETWORK.test(text)) return fail('network', GH_STEPS.has(step) && !PUSH_FAILED.test(text) ? '连不上 GitHub：检查网络后重试' : '连不上远程仓库：检查网络后重试', null)

  if (DIRTY.test(text)) return fail('dirty', CHAIN_TEXT.commitFirst, 'commit')
  if (CONFLICTS.test(text)) return fail('conflicts', `和 ${context.base} 有冲突`, 'handoff')

  // A pre-push hook that printed no name: git refused before any ref was sent, so nothing was rejected.
  if ((step === 'push' || step === 'pr-create') && PUSH_FAILED.test(text) && !REMOTE_REJECTION.test(text)) {
    return fail('pre-push-hook', 'pre-push hook 没通过', 'handoff')
  }

  // A commit that failed for no reason git names is most often a repository hook that does not name itself: the agent
  // can read the output and fix what the hook wants.
  const next: GitFailureNext = step === 'commit' ? 'handoff' : null
  const line = summaryLine(tail)
  const word = /[A-Za-z0-9]$/.test(STEP_WORD[step]) ? `${STEP_WORD[step]} ` : STEP_WORD[step]
  return fail('unknown', line ? `${word}失败：${line}` : `${word}失败`, next)
}
