import { describe, expect, it } from 'vitest'
import { classifyGitFailure, FAILURE_TAIL_LINES, failureTail, type GitStep } from './git-failures'

const ctx = { base: 'main', remote: 'origin' }
const kind = (step: GitStep, output: string) => classifyGitFailure(step, output, ctx).kind

// Shapes as git 2.39–2.50, gh 2.92, husky 8 / 9 and pre-commit print them.
const NON_FF_BRANCH = `To github.com:o/r.git
 ! [rejected]        feat/x -> feat/x (non-fast-forward)
error: failed to push some refs to 'github.com:o/r.git'
hint: Updates were rejected because the tip of your current branch is behind
hint: its remote counterpart. If you want to integrate the remote changes,
hint: use 'git pull' before pushing again.`

const FETCH_FIRST_BASE = `To https://github.com/o/r.git
 ! [rejected]        main -> main (fetch first)
error: failed to push some refs to 'https://github.com/o/r.git'
hint: Updates were rejected because the remote contains work that you do not
hint: have locally. This is usually caused by another repository pushing to
hint: the same ref.`

const GH006 = `remote: error: GH006: Protected branch update failed for refs/heads/main.
remote: error: Changes must be made through a pull request.
To github.com:o/r.git
 ! [remote rejected] main -> main (protected branch hook declined)
error: failed to push some refs to 'github.com:o/r.git'`

const GH013 = `remote: error: GH013: Repository rule violations found for refs/heads/develop.
remote: Review all repository rules at https://github.com/o/r/rules?ref=refs%2Fheads%2Fdevelop
remote: - Changes must be made through a pull request.
To github.com:o/r.git
 ! [remote rejected] develop -> develop (push declined due to repository rule violations)
error: failed to push some refs to 'github.com:o/r.git'`

const GITLAB_PROTECTED = `remote: GitLab: You are not allowed to push code to protected branches on this project.
To gitlab.com:o/r.git
 ! [remote rejected] main -> main (pre-receive hook declined)
error: failed to push some refs to 'gitlab.com:o/r.git'`

const PRE_RECEIVE = `remote: error: File big.bin is 120.00 MB; this exceeds the file size limit of 100.00 MB
To example.com:o/r.git
 ! [remote rejected] feat/x -> feat/x (pre-receive hook declined)
error: failed to push some refs to 'example.com:o/r.git'`

const HUSKY9_PRE_PUSH = `> app@1.0.0 test
> vitest run

 FAIL  src/a.test.ts > adds
husky - pre-push script failed (code 1)
error: failed to push some refs to 'github.com:o/r.git'`

const PLAIN_PRE_PUSH = `Running tests before push…
1 test failed
error: failed to push some refs to 'github.com:o/r.git'`

const HUSKY8_PRE_COMMIT = `✖ eslint --fix:
/w/src/a.ts
  3:7  error  'x' is assigned a value but never used  no-unused-vars
husky - pre-commit hook exited with code 1 (error)`

const HUSKY_COMMIT_MSG = `⧗   input: wip
✖   subject may not be empty [subject-empty]
husky - commit-msg script failed (code 1)`

const PRE_COMMIT_FRAMEWORK = `trim trailing whitespace.................................................Failed
- hook id: trailing-whitespace
- exit code: 1
- files were modified by this hook`

const AUTH = {
  https: `remote: Invalid username or password.
fatal: Authentication failed for 'https://github.com/o/r.git/'`,
  publickey: `git@github.com: Permission denied (publickey).
fatal: Could not read from remote repository.

Please make sure you have the correct access rights
and the repository exists.`,
  username: "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
  forbidden: `remote: Permission to o/r.git denied to someone.
fatal: unable to access 'https://github.com/o/r.git/': The requested URL returned error: 403`,
  agent: `sign_and_send_pubkey: signing failed for ED25519 "/Users/u/.ssh/id_ed25519" from agent: agent refused operation
git@github.com: Permission denied (publickey).
fatal: Could not read from remote repository.`,
  sshKey: `Load key "/Users/u/.ssh/id_ed25519": incorrect passphrase supplied to decrypt private key
git@github.com: Permission denied (publickey).`
}

const SIGNING = {
  gpg: `error: gpg failed to sign the data
fatal: failed to write commit object`,
  ssh: `error: Load key "/Users/u/.ssh/id_ed25519": incorrect passphrase supplied to decrypt private key?

fatal: failed to write commit object`,
  pinentry: `gpg: signing failed: Inappropriate ioctl for device
gpg: signing failed: Inappropriate ioctl for device
error: gpg failed to sign the data
fatal: failed to write commit object`,
  noGpg: `error: cannot run gpg: No such file or directory
error: gpg failed to sign the data
fatal: failed to write commit object`
}

const NO_REMOTE = {
  origin: `fatal: 'origin' does not appear to be a git repository
fatal: Could not read from remote repository.

Please make sure you have the correct access rights
and the repository exists.`,
  destination: `fatal: No configured push destination.
Either specify the URL from the command-line or configure a remote repository using

    git remote add <name> <url>`
}

const NETWORK = {
  https: "fatal: unable to access 'https://github.com/o/r.git/': Could not resolve host: github.com",
  ssh: `ssh: connect to host github.com port 22: Connection timed out
fatal: Could not read from remote repository.

Please make sure you have the correct access rights
and the repository exists.`,
  hostname: `ssh: Could not resolve hostname github.com: nodename nor servname provided, or not known
fatal: Could not read from remote repository.`,
  connect: "fatal: unable to access 'https://github.com/o/r.git/': Failed to connect to github.com port 443 after 75004 ms: Couldn't connect to server",
  gh: `error connecting to api.github.com
check your internet connection or https://githubstatus.com`
}

const GH_NOT_GITHUB = 'none of the git remotes configured for this repository point to a known GitHub host. To tell gh about a new GitHub host, please use `gh auth login`'
const GH_NO_PR = 'no pull requests found for branch "feat/x"'
const GH_SIGNED_OUT = `To get started with GitHub CLI, please run:  gh auth login
Alternatively, populate the GH_TOKEN environment variable with a GitHub API authentication token.`

const DIVERGED = `hint: Diverging branches can't be fast-forwarded, you need to either:
hint:
hint: 	git merge --no-ff
hint:
hint: or:
hint:
hint: 	git rebase
hint:
fatal: Not possible to fast-forward, aborting.`

const DIRTY = `error: Your local changes to the following files would be overwritten by merge:
	src/a.ts
Please commit your changes or stash them before you merge.
Aborting`

const CONFLICT = `Auto-merging src/a.ts
CONFLICT (content): Merge conflict in src/a.ts
Auto-merging src/b.ts
CONFLICT (modify/delete): src/b.ts deleted in main and modified in HEAD.
Automatic merge failed; fix conflicts and then commit the result.`

describe('classifyGitFailure', () => {
  it('reads a rejected branch push as remote commits the local lacks, and points at 拉取', () => {
    expect(classifyGitFailure('push', NON_FF_BRANCH, ctx)).toMatchObject({ kind: 'non-fast-forward', message: '远程有本地没有的提交', next: 'pull' })
    expect(classifyGitFailure('pr-create', NON_FF_BRANCH, ctx)).toMatchObject({ kind: 'non-fast-forward', next: 'pull' })
  })

  it('offers no way on for a rejected push of the base itself: 同步 cannot repair a local base that diverged', () => {
    expect(classifyGitFailure('push', FETCH_FIRST_BASE, ctx)).toMatchObject({ kind: 'non-fast-forward', message: '远程有本地没有的提交', next: null })
  })

  it('names the protected branch and offers 创建 PR, before the hook rule matches', () => {
    expect(classifyGitFailure('push', GH006, ctx)).toMatchObject({ kind: 'protected-branch', message: 'main 受保护', next: 'create-pr' })
    expect(classifyGitFailure('push', GH013, { base: 'develop', remote: 'origin' })).toMatchObject({ kind: 'protected-branch', message: 'develop 受保护' })
    expect(classifyGitFailure('push', GITLAB_PROTECTED, ctx)).toMatchObject({ kind: 'protected-branch', message: 'main 受保护' })
  })

  it('falls back to the base name when the protected ref cannot be read', () => {
    expect(classifyGitFailure('push', 'remote: error: GH006: Protected branch update failed.', ctx).message).toBe('main 受保护')
  })

  it('hands a pre-receive refusal to the agent with the output tail', () => {
    const failure = classifyGitFailure('push', PRE_RECEIVE, ctx)
    expect(failure).toMatchObject({ kind: 'pre-receive-hook', next: 'handoff' })
    expect(failure.tail).toContain('exceeds the file size limit')
  })

  it('tells a failed pre-push hook apart, with or without husky', () => {
    expect(classifyGitFailure('push', HUSKY9_PRE_PUSH, ctx)).toMatchObject({ kind: 'pre-push-hook', message: 'pre-push hook 没通过', next: 'handoff' })
    expect(kind('push', PLAIN_PRE_PUSH)).toBe('pre-push-hook')
  })

  it('names the commit hook that failed', () => {
    expect(classifyGitFailure('commit', HUSKY8_PRE_COMMIT, ctx)).toMatchObject({ kind: 'commit-hook', message: 'pre-commit hook 没通过', next: 'handoff' })
    expect(classifyGitFailure('commit', HUSKY_COMMIT_MSG, ctx).message).toBe('commit-msg hook 没通过')
    expect(classifyGitFailure('commit', PRE_COMMIT_FRAMEWORK, ctx)).toMatchObject({ kind: 'commit-hook', message: 'pre-commit hook 没通过' })
  })

  it('reads a pre-commit framework report on a push as the pre-push hook', () => {
    const output = `mypy.....................................................................Failed
- hook id: mypy
- exit code: 1
error: failed to push some refs to 'github.com:o/r.git'`
    expect(classifyGitFailure('push', output, ctx)).toMatchObject({ kind: 'pre-push-hook', message: 'pre-push hook 没通过', next: 'handoff' })
    expect(classifyGitFailure('pr-create', output, ctx)).toMatchObject({ kind: 'pre-push-hook' })
  })

  it('reads a pre-push hook that printed network or login words as the hook, not as the network or a login', () => {
    // Real git 2.50 output: the hook's lines, then git's own, with no ref line (nothing reached the remote).
    const hookOutput = (lines: string) => `${lines}\nerror: failed to push some refs to '../r.git'`
    for (const lines of ['dial tcp 127.0.0.1:5432: connect: connection refused', 'Authentication failed for user test', "fatal: 'db' does not appear to be a git repository"]) {
      expect(classifyGitFailure('push', hookOutput(lines), ctx)).toMatchObject({ kind: 'pre-push-hook', message: 'pre-push hook 没通过', next: 'handoff' })
      expect(kind('pr-create', hookOutput(lines))).toBe('pre-push-hook')
    }
    // git's own transport failures are still read as such.
    expect(kind('push', `error: RPC failed; HTTP 500 curl 22 The requested URL returned error: 500\nfatal: the remote end hung up unexpectedly\nerror: failed to push some refs to 'https://github.com/o/r.git'`)).not.toBe('pre-push-hook')
  })

  it('reads only local classes at the merge and rebase steps, which never reach a remote', () => {
    // A pre-commit hook run by `git merge --continue` (real output: only the hook's line).
    for (const output of ['dial tcp 127.0.0.1:5432: connect: connection refused', 'Authentication failed for the test database', "fatal: 'origin' does not appear to be a git repository", 'remote: error: GH006: Protected branch update failed for refs/heads/main.']) {
      for (const step of ['merge', 'rebase'] as const) expect(classifyGitFailure(step, output, ctx)).toMatchObject({ kind: 'unknown', next: null })
    }
    expect(kind('merge', CONFLICT)).toBe('conflicts')
    expect(kind('merge', DIRTY)).toBe('dirty')
    expect(kind('rebase', HUSKY8_PRE_COMMIT)).toBe('commit-hook')
  })

  it('does not read a verbose pre-commit hook that passed as a failed one', () => {
    const passedVerbose = `check yaml...............................................................Passed
- hook id: check-yaml
- duration: 0.03s`
    expect(classifyGitFailure('commit', `${passedVerbose}\nerror: gpg failed to sign the data\nfatal: failed to write commit object`, ctx)).toMatchObject({ kind: 'signing' })
    expect(classifyGitFailure('push', `${passedVerbose}\nssh: Could not resolve hostname github.com: nodename nor servname provided, or not known\nfatal: Could not read from remote repository.`, ctx)).toMatchObject({
      kind: 'network',
      next: null
    })
    const failedVerbose = `mypy.....................................................................Failed
- hook id: mypy
- duration: 1.2s
- exit code: 1`
    expect(kind('commit', failedVerbose)).toBe('commit-hook')
    expect(kind('commit', 'ruff format..............................................................Failed\n- hook id: ruff-format\n- files were modified by this hook')).toBe('commit-hook')
  })

  it('does not read a commit object git could not write for permissions as signing', () => {
    const output = 'error: insufficient permission for adding an object to repository database .git/objects\nfatal: failed to write commit object'
    expect(classifyGitFailure('commit', output, ctx)).toMatchObject({ kind: 'unknown', message: '提交失败：failed to write commit object' })
  })

  it('says a push or fetch needs a login, without trying to recover', () => {
    for (const output of Object.values(AUTH)) {
      expect(classifyGitFailure('push', output, ctx)).toMatchObject({ kind: 'auth', message: '推送需要登录：在终端里运行一次 git push', next: null })
    }
    expect(classifyGitFailure('fetch', AUTH.username, ctx).message).toBe('拉取需要登录：在终端里运行一次 git fetch')
    expect(classifyGitFailure('pull', AUTH.publickey, ctx).message).toBe('拉取需要登录：在终端里运行一次 git fetch')
  })

  it('reads a key that cannot sign a commit as signing, and the same words on a push as auth', () => {
    for (const output of Object.values(SIGNING)) {
      expect(classifyGitFailure('commit', output, ctx)).toMatchObject({ kind: 'signing', message: '提交签名需要口令', next: null })
    }
    expect(kind('merge', SIGNING.gpg)).toBe('signing')
    expect(kind('rebase', SIGNING.ssh)).toBe('signing')
    expect(kind('push', AUTH.sshKey)).toBe('auth')
  })

  it('says there is no remote', () => {
    expect(classifyGitFailure('push', NO_REMOTE.origin, ctx)).toMatchObject({ kind: 'no-remote', message: '没有远程仓库，没法推送分支', next: null })
    expect(kind('push', NO_REMOTE.destination)).toBe('no-remote')
    expect(classifyGitFailure('fetch', NO_REMOTE.origin, ctx).message).toBe('没有远程仓库，没法拉取')
  })

  it('reads an unreachable host as the network', () => {
    for (const output of [NETWORK.https, NETWORK.ssh, NETWORK.hostname, NETWORK.connect]) {
      expect(classifyGitFailure('push', output, ctx)).toMatchObject({ kind: 'network', message: '连不上远程仓库：检查网络后重试', next: null })
    }
    expect(classifyGitFailure('pr-create', NETWORK.gh, ctx)).toMatchObject({ kind: 'network', message: '连不上 GitHub：检查网络后重试' })
  })

  it('does not take gh’s not-GitHub message for a missing login', () => {
    expect(classifyGitFailure('pr-create', GH_NOT_GITHUB, ctx)).toMatchObject({ kind: 'not-github', message: '远程不在 GitHub 上', next: null })
  })

  it('does not take “no pull requests found” for a login or network problem', () => {
    expect(classifyGitFailure('pr-merge', GH_NO_PR, ctx)).toMatchObject({ kind: 'no-pr', message: '这个分支没有打开的 PR', next: 'pr' })
  })

  it('says gh needs a login in the words 创建 PR already uses', () => {
    expect(classifyGitFailure('pr-create', GH_SIGNED_OUT, ctx)).toMatchObject({ kind: 'auth', message: 'gh 还没有登录：在终端运行 gh auth login 后可以创建 PR' })
    expect(classifyGitFailure('pr-merge', 'HTTP 401: Bad credentials (https://api.github.com/graphql)\nTry authenticating with:  gh auth login', ctx).message).toBe(
      'gh 还没有登录：在终端运行 gh auth login'
    )
  })

  it('words a failed PR poll as a gh call', () => {
    expect(classifyGitFailure('pr-status', NETWORK.gh, ctx)).toMatchObject({ kind: 'network', message: '连不上 GitHub：检查网络后重试' })
    expect(classifyGitFailure('pr-status', GH_SIGNED_OUT, ctx)).toMatchObject({ kind: 'auth', message: 'gh 还没有登录：在终端运行 gh auth login' })
    expect(classifyGitFailure('pr-status', 'GraphQL: Something went wrong', ctx)).toMatchObject({ kind: 'unknown', message: '读取 PR 状态失败：GraphQL: Something went wrong' })
  })

  it('reads a fast-forward-only pull that cannot fast-forward as diverged', () => {
    expect(classifyGitFailure('pull', DIVERGED, ctx)).toMatchObject({ kind: 'diverged', message: '远程分支和本地分叉', next: 'handoff' })
    expect(kind('pull', 'fatal: Not possible to fast-forward, aborting.')).toBe('diverged')
  })

  it('asks to commit first when uncommitted changes are in the way', () => {
    expect(classifyGitFailure('pull', DIRTY, ctx)).toMatchObject({ kind: 'dirty', message: '先提交改动', next: 'commit' })
    expect(kind('rebase', 'error: cannot rebase: You have unstaged changes.\nerror: Please commit or stash them.')).toBe('dirty')
  })

  it('hands a merge that stopped on conflicts to the agent', () => {
    expect(classifyGitFailure('merge', CONFLICT, ctx)).toMatchObject({ kind: 'conflicts', message: '和 main 有冲突', next: 'handoff' })
    expect(kind('rebase', 'error: could not apply 1a2b3c4... add x\nhint: Resolve all conflicts manually')).toBe('conflicts')
  })

  it('keeps an unknown failure’s words and the raw tail', () => {
    const failure = classifyGitFailure('push', 'Enumerating objects: 5, done.\nerror: something odd happened\nmore detail', ctx)
    expect(failure).toMatchObject({ kind: 'unknown', message: '推送失败：something odd happened', next: null })
    expect(failure.tail).toBe('Enumerating objects: 5, done.\nerror: something odd happened\nmore detail')
    expect(classifyGitFailure('fetch', '', ctx)).toMatchObject({ kind: 'unknown', message: '获取远程失败', tail: '' })
    expect(classifyGitFailure('commit', 'nothing added', ctx).message).toBe('提交失败：nothing added')
  })

  it('puts a space between a Latin step word and 失败', () => {
    expect(classifyGitFailure('pr-merge', 'GraphQL: odd', ctx).message).toBe('合并 PR 失败：GraphQL: odd')
    expect(classifyGitFailure('pr-create', 'error: odd', ctx).message).toBe('创建 PR 失败：odd')
    expect(classifyGitFailure('rebase', 'error: odd', ctx).message).toBe('rebase 失败：odd')
    expect(classifyGitFailure('pr-merge', '', ctx).message).toBe('合并 PR 失败')
    expect(classifyGitFailure('push', 'error: odd', ctx).message).toBe('推送失败：odd')
  })

  it.each([
    'remote: error: Changes must be made through a pull request.',
    ' ! [remote rejected] main -> main (protected branch hook declined)',
    'remote: error: Required status check "test" is expected.',
    'remote: error: required status checks are failing',
    'remote: error: push blocked by branch protection rules',
    'remote: error: GH006: Protected branch update failed for refs/heads/main.',
    'remote: error: GH013: Repository rule violations found for refs/heads/main.',
    'remote: GitLab: You are not allowed to push code to protected branches on this project.'
  ])('reads %j as a protected branch', (output) => {
    expect(classifyGitFailure('push', output, ctx)).toMatchObject({ kind: 'protected-branch' })
  })

  it.each([
    ' ! [remote rejected] main -> main (protected branch hook declined)',
    'remote: error: GH006: Protected branch update failed for refs/heads/main.',
    'remote: error: GH013: Repository rule violations found for refs/heads/main.'
  ])('offers 改为创建 PR for %j, a refusal of the base itself', (output) => {
    expect(classifyGitFailure('push', output, ctx)).toMatchObject({ kind: 'protected-branch', message: 'main 受保护', next: 'create-pr' })
  })

  it('offers nothing for a protection refusal whose ref cannot be read', () => {
    for (const output of ['remote: error: Changes must be made through a pull request.', 'remote: error: push blocked by branch protection rules']) {
      expect(classifyGitFailure('push', output, ctx)).toMatchObject({ kind: 'protected-branch', next: null })
    }
  })

  it('says a rule refused the session branch itself, without offering 改为创建 PR (a PR pushes the same commits)', () => {
    const secret = `remote: error: GH013: Repository rule violations found for refs/heads/wavi/fix-login.
remote: - GITHUB PUSH PROTECTION
remote:   Push cannot contain secrets
To github.com:o/r.git
 ! [remote rejected] wavi/fix-login -> wavi/fix-login (push declined due to repository rule violations)
error: failed to push some refs to 'github.com:o/r.git'`
    const failure = classifyGitFailure('push', secret, ctx)
    expect(failure).toMatchObject({ kind: 'protected-branch', message: 'wavi/fix-login 被推送保护拒绝：提交里有密钥', next: null })
    expect(failure.tail).toContain('Push cannot contain secrets')
    expect(classifyGitFailure('pr-create', secret, ctx)).toMatchObject({ message: 'wavi/fix-login 被推送保护拒绝：提交里有密钥', next: null })
    const signed = ' ! [remote rejected] feat -> feat (push declined due to repository rule violations)\nremote: - Commits must have verified signatures.'
    expect(classifyGitFailure('push', `remote: error: GH013: Repository rule violations found.\n${signed}`, ctx)).toMatchObject({ message: 'feat 被仓库规则拒绝：提交需要验证过的签名', next: null })
    const other = ' ! [remote rejected] feat -> feat (push declined due to repository rule violations)\nremote: - Changes must be made through a pull request.'
    expect(classifyGitFailure('push', `remote: error: GH013: Repository rule violations found.\n${other}`, ctx)).toMatchObject({ message: 'feat 被仓库规则拒绝', next: null })
  })

  it('names push protection and a signature rule, and offers no PR for them, whatever ref was refused (a PR carries the same commits)', () => {
    const secretOnBase = `remote: error: GH013: Repository rule violations found for refs/heads/main.
remote:
remote: - GITHUB PUSH PROTECTION
remote:   —————————————————————————————————————————
remote:     Resolve the following violations before pushing again
remote:
remote:     - Push cannot contain secrets
To github.com:o/r.git
 ! [remote rejected] main -> main (push declined due to repository rule violations)
error: failed to push some refs to 'github.com:o/r.git'`
    const secret = classifyGitFailure('push', secretOnBase, ctx)
    expect(secret).toMatchObject({ kind: 'protected-branch', message: 'main 被推送保护拒绝：提交里有密钥', next: null })
    expect(secret.tail).toContain('Push cannot contain secrets')
    expect(classifyGitFailure('push', 'remote: error: GH009: Secrets detected! This push failed.\n ! [remote rejected] main -> main (pre-receive hook declined)', ctx)).toMatchObject({
      message: 'main 被推送保护拒绝：提交里有密钥',
      next: null
    })
    const unsigned = `remote: error: GH013: Repository rule violations found for refs/heads/main.
remote: - Commits must have verified signatures.
 ! [remote rejected] main -> main (push declined due to repository rule violations)
error: failed to push some refs to 'github.com:o/r.git'`
    expect(classifyGitFailure('push', unsigned, ctx)).toMatchObject({ kind: 'protected-branch', message: 'main 被仓库规则拒绝：提交需要验证过的签名', next: null })
    const protectedUnsigned = 'remote: error: GH006: Protected branch update failed for refs/heads/main.\nremote: error: Commits must have verified signatures.'
    expect(classifyGitFailure('push', protectedUnsigned, ctx)).toMatchObject({ message: 'main 被仓库规则拒绝：提交需要验证过的签名', next: null })
  })

  it('offers 改为创建 PR only for a refused push, not for a PR GitHub will not merge', () => {
    const output = 'GraphQL: Required status check "test" is expected. (mergePullRequest)'
    expect(classifyGitFailure('pr-merge', output, ctx)).toMatchObject({ kind: 'protected-branch', next: null })
  })

  it('keeps an unnamed failure at the commit step unknown, with the output handed to the agent', () => {
    expect(classifyGitFailure('commit', 'error: odd hook output', ctx)).toMatchObject({ kind: 'unknown', next: 'handoff', tail: 'error: odd hook output' })
    expect(classifyGitFailure('commit', '', ctx)).toMatchObject({ kind: 'unknown', next: 'handoff' })
    for (const step of ['push', 'pull', 'merge', 'rebase', 'pr-create', 'pr-merge', 'fetch', 'pr-status'] as const) {
      expect(classifyGitFailure(step, 'error: odd', ctx)).toMatchObject({ kind: 'unknown', next: null })
    }
  })

  it('reads only what can happen to a local commit at the commit step; anything else goes to the agent', () => {
    const outputs = [
      'dial tcp 127.0.0.1:5432: connect: connection refused',
      'psql: error: connection to server on socket failed: Connection refused',
      "warning: unable to access '/Users/u/.config/git/ignore': Permission denied\nerror: odd",
      'Authentication failed for the test database',
      "fatal: 'origin' does not appear to be a git repository",
      'remote: error: GH006: Protected branch update failed for refs/heads/main.',
      ' ! [rejected]        feat -> feat (non-fast-forward)',
      'fatal: Not possible to fast-forward, aborting.',
      'remote rejected (pre-receive hook declined)'
    ]
    for (const output of outputs) expect(classifyGitFailure('commit', output, ctx)).toMatchObject({ kind: 'unknown', next: 'handoff' })
    expect(kind('commit', HUSKY8_PRE_COMMIT)).toBe('commit-hook')
    expect(kind('commit', SIGNING.gpg)).toBe('signing')
    expect(kind('commit', DIRTY)).toBe('dirty')
    expect(kind('commit', CONFLICT)).toBe('conflicts')
  })

  it('says when git does not know who the committer is', () => {
    const message = 'git 还不知道提交者是谁：在终端里设置 user.name 和 user.email'
    const tell = `Author identity unknown

*** Please tell me who you are.

Run

  git config --global user.email "you@example.com"
  git config --global user.name "Your Name"

fatal: unable to auto-detect email address (got 'm@host.(none)')`
    expect(classifyGitFailure('commit', tell, ctx)).toEqual({ kind: 'identity', message, next: null, tail: tell })
    expect(classifyGitFailure('commit', 'fatal: empty ident name (for <m@host>) not allowed', ctx)).toMatchObject({ kind: 'identity', message, next: null })
    expect(classifyGitFailure('merge', tell, ctx).kind).toBe('identity')
  })
})

describe('failureTail', () => {
  it('keeps the last lines without colors or control characters', () => {
    const lines = Array.from({ length: 60 }, (_, i) => `line ${i}`)
    const tail = failureTail(`\u001b[31m${lines.join('\n')}\u001b[0m\n\n`)
    expect(tail.split('\n')).toHaveLength(FAILURE_TAIL_LINES)
    expect(tail.startsWith('line 20')).toBe(true)
    expect(tail.endsWith('line 59')).toBe(true)
    expect(failureTail('a\r\nb\u0007')).toBe('a\nb')
  })
})
