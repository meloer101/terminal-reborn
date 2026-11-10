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

  it('points a rejected push of the base itself at 同步', () => {
    expect(classifyGitFailure('push', FETCH_FIRST_BASE, ctx)).toMatchObject({ kind: 'non-fast-forward', message: '远程有本地没有的提交', next: 'sync' })
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
