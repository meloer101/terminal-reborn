import { describe, expect, it } from 'vitest'
import type { PrStatus, PullRequestInfo } from './pull-requests'
import type { ShipPreflight } from './ship'
import { CHAIN_ACTION_IDS, CHAIN_LABEL, CHAIN_TEXT, chainInputFrom, shipChain, type ChainActionId, type ChainInput, type ChainState } from './ship-chain'

type Ok = Extract<ShipPreflight, { ok: true }>

function ok(patch: Partial<Ok> = {}): Ok {
  return {
    ok: true,
    branch: 'feat/x',
    base: 'main',
    remote: 'origin',
    baseProtected: false,
    suggested: 'main',
    uncommitted: 0,
    ahead: 2,
    merged: false,
    baseAheadOfUpstream: 0,
    baseBehindUpstream: 0,
    openPr: null,
    mergeMethods: null,
    ...patch
  }
}

function input(patch: Partial<ChainInput> = {}): ChainInput {
  return {
    preflight: ok(),
    remembered: null,
    local: { branch: 'feat/x', base: 'main', ahead: 2, uncommitted: 0, trackedUncommitted: 0 },
    pr: null,
    prMerged: false,
    isMain: false,
    projectRoot: '/r',
    gh: null,
    agent: 'Claude',
    sessions: [],
    radarConflicts: null,
    ...patch
  }
}

const dirty = (n: number, tracked = n): ChainInput['local'] => ({ branch: 'feat/x', base: 'main', ahead: 2, uncommitted: n, trackedUncommitted: tracked })
const action = (state: ChainState, id: ChainActionId) => state.actions.find((a) => a.id === id)!
const pr = (patch: Partial<NonNullable<ChainInput['pr']>> = {}): NonNullable<ChainInput['pr']> => ({ number: 5, draft: false, unpushed: false, remoteAhead: false, ...patch })

describe('shipChain · actions', () => {
  it('always lists every action once, in the fixed order', () => {
    const states = [
      shipChain(input()),
      shipChain(input({ preflight: null })),
      shipChain(input({ preflight: { ok: false, message: '处于分离 HEAD，没有分支可以合并' } })),
      shipChain(input({ pr: pr() })),
      shipChain(input({ preflight: ok({ operation: { kind: 'rebase', unresolved: ['a.ts'] } }) })),
      shipChain(input({ prMerged: true })),
      shipChain(input({ preflight: ok({ ahead: 0 }), local: { ...dirty(0), ahead: 0 } }))
    ]
    for (const state of states) expect(state.actions.map((a) => a.id)).toEqual([...CHAIN_ACTION_IDS])
    expect(CHAIN_ACTION_IDS).toEqual(['commit', 'sync', 'pull', 'push', 'pr', 'main', 'merge-pr', 'archive'])
  })

  it('labels each action with the base and the PR', () => {
    const plain = shipChain(input({ preflight: ok({ base: 'develop' }) }))
    expect(plain.actions.map((a) => a.label)).toEqual(['提交…', '同步 develop', '拉取', '推送', '创建 PR', '合并到 develop 并推送', '合并 PR…', '归档…'])
    const withPr = shipChain(input({ pr: pr(), local: dirty(1) }))
    expect(action(withPr, 'pr').label).toBe('提交并推送到 PR #5')
    expect(action(withPr, 'merge-pr').label).toBe('合并 PR #5…')
    expect(action(shipChain(input({ pr: pr({ unpushed: true }) })), 'pr').label).toBe('推送到 PR #5')
    expect(action(shipChain(input({ preflight: ok({ remote: null }) })), 'main').label).toBe('合并到 main')
    expect(CHAIN_LABEL.handoff('Codex')).toBe('交给 Codex')
  })

  it('says why each action cannot run', () => {
    const state = shipChain(input({ preflight: ok({ behindBase: 0, upstream: { ahead: 0, behind: 0 } }) }))
    expect(action(state, 'commit').blocker).toBe('没有未提交的改动')
    expect(action(state, 'sync').blocker).toBe('main 没有新的提交')
    expect(action(state, 'pull').blocker).toBe('远程分支没有新的提交')
    expect(action(state, 'push').blocker).toBe('没有要推送的提交')
    expect(action(state, 'pr').blocker).toBeNull()
    expect(action(state, 'main').blocker).toBeNull()
    expect(action(state, 'merge-pr').blocker).toBe('这个分支没有打开的 PR')
    expect(action(state, 'archive').blocker).toBeNull()
  })

  it('lets 推送 publish a branch that was never pushed, and 拉取 wait for one', () => {
    const state = shipChain(input({ preflight: ok({ upstream: null, pushed: false }) }))
    expect(action(state, 'push').blocker).toBeNull()
    expect(action(state, 'pull').blocker).toBe('分支还没有推送过')
    expect(action(shipChain(input({ preflight: ok({ upstream: null, ahead: 0 }), local: dirty(1) })), 'push').blocker).toBe('没有要推送的提交')
  })

  it('stops 推送 when the remote branch moved, and 拉取 when the two diverged', () => {
    const behind = shipChain(input({ preflight: ok({ upstream: { ahead: 1, behind: 2 } }) }))
    expect(action(behind, 'push').blocker).toBe('远程有本地没有的提交')
    expect(action(behind, 'pull').blocker).toBe('远程分支和本地分叉')
    expect(action(shipChain(input({ preflight: ok({ upstream: { ahead: 0, behind: 2 } }) })), 'pull').blocker).toBeNull()
  })

  it('needs a remote for 推送, 拉取 and 创建 PR', () => {
    const state = shipChain(input({ preflight: ok({ remote: null }) }))
    expect(action(state, 'push').blocker).toBe('没有远程仓库，没法推送分支')
    expect(action(state, 'pull').blocker).toBe('没有远程仓库，没法拉取')
    expect(action(state, 'pr').blocker).toBe('没有远程仓库，没法推送分支')
  })

  it('keeps 同步 away from tracked uncommitted changes, not untracked files', () => {
    expect(action(shipChain(input({ local: dirty(2, 1) })), 'sync').blocker).toBe('先提交改动')
    expect(action(shipChain(input({ local: dirty(2, 0) })), 'sync').blocker).toBeNull()
  })

  it('leaves 推送 and 合并到 base to the PR while one is open', () => {
    const state = shipChain(input({ pr: pr({ unpushed: true }) }))
    expect(action(state, 'push').blocker).toBe('分支已有 PR #5')
    expect(action(state, 'main').blocker).toBe('分支已有 PR #5')
  })

  it('blocks merging locally into a base it would conflict with', () => {
    expect(action(shipChain(input({ preflight: ok({ baseConflicts: ['a.ts'] }) })), 'main').blocker).toBe('和 main 会冲突 · 1 个文件')
  })

  it('archives regardless of the git state, but not a running session or the main checkout', () => {
    expect(action(shipChain(input({ preflight: null })), 'archive').blocker).toBeNull()
    expect(action(shipChain(input({ sessions: [{ status: 'needs_you' }] })), 'archive').blocker).toBe('会话还在运行，先停下来再归档')
    expect(action(shipChain(input({ isMain: true })), 'archive').blocker).toBe('项目主目录不能归档')
  })
})

describe('shipChain · a. an operation in progress', () => {
  const rebase = (unresolved: string[]) => ok({ operation: { kind: 'rebase', unresolved } })

  it('hands unresolved conflicts to the agent, with 中止 beside it', () => {
    const state = shipChain(input({ preflight: rebase(['a.ts', 'b.ts']) }))
    expect(state.stage).toBe('operation')
    expect(state.headline).toEqual({ tone: 'blocked', text: 'rebase 进行中 · 2 个文件有冲突' })
    expect(state.next).toEqual({ id: 'handoff', label: '交给 Claude', blocker: null })
    expect(state.second).toEqual({ id: 'abort', label: '中止', blocker: null })
    expect(state.blocked).toBe('rebase 进行中')
    for (const a of state.actions.filter((a) => a.id !== 'archive')) expect(a.blocker).toBe('rebase 进行中')
  })

  it('offers 继续 once every conflict is resolved', () => {
    const state = shipChain(input({ preflight: ok({ operation: { kind: 'cherry-pick', unresolved: [] } }) }))
    expect(state.headline).toEqual({ tone: 'info', text: 'cherry-pick 进行中' })
    expect(state.next).toEqual({ id: 'continue', label: '继续', blocker: null })
    expect(state.second).toMatchObject({ id: 'abort' })
  })

  it('reads the operation from a failed preflight too (a rebase detaches HEAD)', () => {
    const state = shipChain(input({ preflight: { ok: false, message: '处于分离 HEAD，没有分支可以合并', operation: { kind: 'rebase', unresolved: ['a.ts'] } } }))
    expect(state.stage).toBe('operation')
    expect(state.next?.id).toBe('handoff')
  })

  it('wins over the main checkout being on its base', () => {
    const state = shipChain(input({ isMain: true, local: { ...dirty(0), branch: 'main' }, preflight: ok({ operation: { kind: 'merge', unresolved: ['a.ts'] } }) }))
    expect(state.headline?.text).toBe('merge 进行中 · 1 个文件有冲突')
  })

  it('cannot hand off without an agent session', () => {
    const state = shipChain(input({ agent: null, preflight: rebase(['a.ts']) }))
    expect(state.next).toEqual({ id: 'handoff', label: '交给 agent', blocker: '这个 worktree 没有 agent 会话' })
  })
})

describe('shipChain · b. nowhere to go', () => {
  it('says the main checkout is on its base', () => {
    const state = shipChain(input({ isMain: true, local: { ...dirty(0), branch: 'main', base: 'origin/main' } }))
    expect(state).toMatchObject({ stage: 'stuck', headline: { tone: 'info', text: CHAIN_TEXT.onBase }, next: null, second: null, blocked: CHAIN_TEXT.onBase })
    expect(action(state, 'pr').blocker).toBe(CHAIN_TEXT.onBase)
  })

  it('shows the preflight’s reason (a detached HEAD) as the headline', () => {
    const state = shipChain(input({ preflight: { ok: false, message: '处于分离 HEAD，没有分支可以合并' } }))
    expect(state).toMatchObject({ stage: 'stuck', headline: { tone: 'blocked', text: '处于分离 HEAD，没有分支可以合并' }, next: null })
  })

  it('needs the worktree’s project', () => {
    expect(shipChain(input({ projectRoot: null })).headline).toEqual({ tone: 'blocked', text: '找不到这个 worktree 的项目' })
  })
})

describe('shipChain · while the preflight runs', () => {
  it('shows the two exits as checking, the remembered one first', () => {
    const state = shipChain(input({ preflight: null, remembered: 'pr' }))
    expect(state.stage).toBe('checking')
    expect(state.headline).toEqual({ tone: 'working', text: '正在检查…' })
    expect(state.next).toEqual({ id: 'pr', label: '创建 PR', blocker: '正在检查…' })
    expect(state.second).toEqual({ id: 'main', label: '合并到 main 并推送', blocker: '正在检查…' })
  })

  it('already knows a branch with nothing of its own, and a merged PR', () => {
    expect(shipChain(input({ preflight: null, local: { ...dirty(0), ahead: 0 } })).stage).toBe('empty')
    expect(shipChain(input({ preflight: null, prMerged: true })).stage).toBe('merged')
  })
})

describe('shipChain · c. an open PR', () => {
  it('commits and pushes uncommitted work to it', () => {
    const state = shipChain(input({ pr: pr(), local: dirty(3) }))
    expect(state).toMatchObject({ stage: 'pr', headline: null, next: { id: 'pr', label: '提交并推送到 PR #5', blocker: null }, second: null })
  })

  it('pushes commits it does not have yet', () => {
    expect(shipChain(input({ pr: pr({ unpushed: true }) })).next).toEqual({ id: 'pr', label: '推送到 PR #5', blocker: null })
    expect(shipChain(input({ pr: pr(), preflight: ok({ upstream: { ahead: 1, behind: 0 } }) })).next?.label).toBe('推送到 PR #5')
  })

  it('pulls first when the PR has commits the branch lacks, even with uncommitted work', () => {
    const state = shipChain(input({ pr: pr({ remoteAhead: true }), local: dirty(1) }))
    expect(state.headline).toEqual({ tone: 'info', text: '远程有本地没有的提交' })
    expect(state.next).toEqual({ id: 'pull', label: '拉取', blocker: null })
    expect(action(state, 'pr').blocker).toBe('远程有本地没有的提交')
  })

  it('hands a diverged branch to the agent', () => {
    const state = shipChain(input({ pr: pr(), preflight: ok({ upstream: { ahead: 1, behind: 1 } }) }))
    expect(state.headline).toEqual({ tone: 'blocked', text: '远程分支和本地分叉' })
    expect(state.next).toEqual({ id: 'handoff', label: '交给 Claude', blocker: null })
  })

  it('offers to merge the PR once there is nothing to send', () => {
    const state = shipChain(input({ pr: pr() }))
    expect(state.next).toEqual({ id: 'merge-pr', label: '合并 PR #5…', blocker: null })
    expect(action(state, 'pr').blocker).toBe('没有要推送的提交')
  })

  it('says a draft cannot be merged yet, as the headline', () => {
    const state = shipChain(input({ pr: pr({ draft: true }) }))
    expect(state.next?.blocker).toBe('PR 还是草稿：先在 GitHub 上标记为可审阅')
    expect(state.headline).toEqual({ tone: 'blocked', text: 'PR 还是草稿：先在 GitHub 上标记为可审阅' })
  })

  it('comes before a merged-looking branch and the conflict check', () => {
    expect(shipChain(input({ pr: pr(), preflight: ok({ merged: true, baseConflicts: ['a.ts'] }) })).stage).toBe('pr')
  })
})

describe('shipChain · d. merged', () => {
  it('says everything is in the base and offers 归档…', () => {
    const state = shipChain(input({ prMerged: true }))
    expect(state).toMatchObject({ stage: 'merged', headline: { tone: 'ok', text: '已经全部合并到 main' }, next: { id: 'archive', label: '归档…', blocker: null }, second: null })
    expect(shipChain(input({ preflight: ok({ merged: true }) })).stage).toBe('merged')
  })

  it('offers no 归档… while a session runs or on the main checkout', () => {
    expect(shipChain(input({ prMerged: true, sessions: [{ status: 'running' }] }))).toMatchObject({ stage: 'merged', next: null })
    expect(shipChain(input({ prMerged: true, isMain: true }))).toMatchObject({ stage: 'merged', next: null })
  })

  it('is not merged while something is uncommitted', () => {
    expect(shipChain(input({ prMerged: true, local: dirty(1) })).stage).toBe('exits')
  })
})

describe('shipChain · e. nothing of its own', () => {
  it('shows nothing', () => {
    const state = shipChain(input({ preflight: ok({ ahead: 0 }) }))
    expect(state).toMatchObject({ stage: 'empty', headline: null, next: null, second: null })
  })

  it('has work as soon as a file is uncommitted', () => {
    expect(shipChain(input({ preflight: ok({ ahead: 0 }), local: dirty(1) })).stage).toBe('exits')
  })
})

describe('shipChain · f. conflicts with the base', () => {
  it('puts 同步 first and says how many files', () => {
    const state = shipChain(input({ preflight: ok({ baseConflicts: ['a.ts', 'b.ts'] }) }))
    expect(state).toMatchObject({ stage: 'conflicts', headline: { tone: 'blocked', text: '和 main 会冲突 · 2 个文件' }, next: { id: 'sync', label: '同步 main', blocker: null } })
  })

  it('falls back on the conflict radar while the preflight does not check', () => {
    expect(shipChain(input({ radarConflicts: ['a.ts'] })).stage).toBe('conflicts')
    expect(shipChain(input({ preflight: ok({ baseConflicts: [] }), radarConflicts: ['a.ts'] })).stage).toBe('exits')
  })

  it('keeps the conflict headline when 同步 is blocked', () => {
    const state = shipChain(input({ preflight: ok({ baseConflicts: ['a.ts'] }), local: dirty(1) }))
    expect(state.next).toEqual({ id: 'sync', label: '同步 main', blocker: '先提交改动' })
    expect(state.headline?.text).toBe('和 main 会冲突 · 1 个文件')
  })
})

describe('shipChain · g. the two exits', () => {
  it('puts the suggestion first, then the remembered exit over it', () => {
    expect(shipChain(input({ preflight: ok({ suggested: 'pr' }) }))).toMatchObject({
      stage: 'exits',
      headline: null,
      next: { id: 'pr', label: '创建 PR', blocker: null },
      second: { id: 'main', label: '合并到 main 并推送', blocker: null }
    })
    expect(shipChain(input({ preflight: ok({ suggested: 'pr' }), remembered: 'main' })).next?.id).toBe('main')
  })

  it('offers only 合并到 base without a remote', () => {
    const state = shipChain(input({ preflight: ok({ remote: null, suggested: 'pr' }), remembered: 'pr' }))
    expect(state.next).toEqual({ id: 'main', label: '合并到 main', blocker: null })
    expect(state.second).toBeNull()
  })

  it('blocks 创建 PR before anything is written when the remote is not on GitHub or gh is not usable', () => {
    const notGitHub = shipChain(input({ preflight: ok({ remoteOnGitHub: false }), remembered: 'pr' }))
    expect(notGitHub.next).toEqual({ id: 'pr', label: '创建 PR', blocker: '远程不在 GitHub 上' })
    expect(notGitHub.headline).toEqual({ tone: 'blocked', text: '远程不在 GitHub 上' })
    expect(action(shipChain(input({ gh: 'missing' })), 'pr').blocker).toBe('创建 PR 需要 GitHub CLI：装好 gh 后在终端运行 gh auth login')
    expect(action(shipChain(input({ gh: 'signed-out' })), 'pr').blocker).toBe('gh 还没有登录：在终端运行 gh auth login 后可以创建 PR')
    expect(action(shipChain(input({ preflight: ok({ gh: 'missing' }) })), 'pr').blocker).toBe(CHAIN_TEXT.ghMissing)
    expect(action(shipChain(input({ gh: 'checking' })), 'pr').blocker).toBeNull()
    // The renderer's gh state is newer than the preflight's.
    expect(action(shipChain(input({ gh: 'ready', preflight: ok({ gh: 'missing' }) })), 'pr').blocker).toBeNull()
  })

  it('keeps a blocked secondary exit out of the headline', () => {
    const state = shipChain(input({ gh: 'missing' }))
    expect(state.next?.id).toBe('main')
    expect(state.headline).toBeNull()
  })

  it('still says why the exits cannot run when there is nothing to ship', () => {
    // The preflight's count wins over the change list's (which may compare against origin/main).
    const state = shipChain(input({ preflight: ok({ ahead: 0 }), local: { ...dirty(0), ahead: 3 } }))
    expect(state.stage).toBe('empty')
    expect(action(state, 'main').blocker).toBe('没有要合并的改动')
    expect(action(state, 'pr').blocker).toBe('没有比 main 新的提交')
  })
})

describe('chainInputFrom', () => {
  const live: PullRequestInfo = {
    number: 7,
    state: 'open',
    url: 'https://github.com/o/r/pull/7',
    title: 't',
    checks: { state: 'none', total: 0, passed: 0, pending: 0, failing: [] },
    details: { headOid: 'aaa' } as never
  }
  const status = (patch: Partial<PrStatus>): PrStatus => ({ worktree: '/w', branch: 'feat/x', pr: live, checkedAt: 0, ...patch })
  const changes = {
    branch: 'feat/x',
    base: 'main',
    ahead: 2,
    uncommitted: [
      { path: 'a.ts', status: 'M' as const, added: 1, removed: 0 },
      { path: 'new.ts', status: 'A' as const, added: 3, removed: 0, untracked: true }
    ],
    untrackedOmitted: 4
  }
  const from = (patch: Partial<Parameters<typeof chainInputFrom>[0]> = {}) =>
    chainInputFrom({ preflight: ok(), remembered: null, prStatus: null, changes, isMain: false, projectRoot: '/r', ...patch })

  it('counts every uncommitted file, and the tracked ones apart', () => {
    expect(from().local).toEqual({ branch: 'feat/x', base: 'main', ahead: 2, uncommitted: 6, trackedUncommitted: 1 })
  })

  it('reads the open PR from the poll: unpushed, remote ahead, draft', () => {
    expect(from({ prStatus: status({ local: { head: 'bbb', remoteAhead: false } }) }).pr).toEqual({ number: 7, draft: false, unpushed: true, remoteAhead: false })
    expect(from({ prStatus: status({ local: { head: 'aaa', remoteAhead: true } }) }).pr).toEqual({ number: 7, draft: false, unpushed: false, remoteAhead: true })
    expect(from({ prStatus: status({ pr: { ...live, state: 'draft' } }) }).pr?.draft).toBe(true)
  })

  it('falls back on the preflight’s PR number', () => {
    expect(from({ preflight: ok({ openPr: 9 }) }).pr).toEqual({ number: 9, draft: false, unpushed: false, remoteAhead: false })
  })

  it('sees a merged PR, and no PR in a closed one', () => {
    expect(from({ prStatus: status({ pr: { ...live, state: 'merged' } }) })).toMatchObject({ pr: null, prMerged: true })
    expect(from({ prStatus: status({ pr: { ...live, state: 'closed' } }) })).toMatchObject({ pr: null, prMerged: false })
  })

  it('defaults what the caller does not know', () => {
    expect(from()).toMatchObject({ gh: null, agent: null, sessions: [], radarConflicts: null })
  })
})
