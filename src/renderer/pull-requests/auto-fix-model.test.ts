import { describe, expect, it } from 'vitest'
import { brakeLabel } from '@shared/auto-fix-brakes'
import type { PrDetails, PrThread, PullRequestInfo } from '@shared/pull-requests'
import type { BaseCi } from '@shared/ship'
import {
  afterPushed,
  afterSend,
  allowedThreads,
  automationText,
  autoFixDecision,
  baseAutomationText,
  baseBrokenChecks,
  baseFixDecision,
  failingChecks,
  fixNote,
  freshAutomation,
  mergeWhenGreenOn,
  prChecksText,
  prHeadline,
  prLineParts,
  prLineText,
  stopActions,
  stopLineText,
  stopParts,
  isInterrupted,
  restoredAutomation,
  savedFixRuns,
  stalledFix,
  FIX_TURN_TIMEOUT_MS,
  takenOver,
  type FixRun,
  type PrAutomation
} from './auto-fix-model'

const thread = (id: string, login: string, outdated = false): PrThread => ({
  id,
  path: 'a.ts',
  line: 3,
  startLine: null,
  side: 'new',
  outdated,
  comments: [{ author: { login, bot: login.endsWith('[bot]') }, body: 'fix this', url: '', createdAt: '' }]
})

const details = (over: Partial<PrDetails> = {}): PrDetails => ({
  id: 'PR_1',
  headOid: 'a'.repeat(40),
  reviewDecision: null,
  mergeState: 'clean',
  inMergeQueue: false,
  autoMerge: null,
  required: { total: 1, failing: [], pending: 0 },
  threads: [],
  notes: [],
  repo: { autoMergeAllowed: true, deleteBranchOnMerge: false, methods: ['squash'], defaultMethod: 'squash' },
  viewer: 'jacob',
  ...over
})

const pr = (over: Partial<PrDetails> = {}, checks: Partial<PullRequestInfo['checks']> = {}): PullRequestInfo => ({
  number: 7,
  state: 'open',
  url: 'https://github.com/a/b/pull/7',
  title: 't',
  checks: { state: 'passing', total: 1, passed: 1, pending: 0, failing: [], ...checks },
  details: details(over)
})

describe('自动修复 (PRD F16 v1.63 · L3)', () => {
  const on = { ...freshAutomation(7, true) }
  const input = (p: PullRequestInfo, agentIdle = true) => ({ pr: p, agentIdle, max: 3, bots: ['coderabbitai[bot]'] })

  it('counts required checks when there are some, else every check', () => {
    expect(failingChecks(pr({ required: { total: 2, failing: ['test'], pending: 0 } }))).toEqual(['test'])
    expect(failingChecks(pr({ required: { total: 0, failing: [], pending: 0 } }, { state: 'failing', failing: [{ name: 'lint', runId: null, jobId: null }] }))).toEqual(['lint'])
  })

  it('acts only for the user and allowed bots, and not on outdated threads', () => {
    const p = pr({ threads: [thread('T1', 'jacob'), thread('T2', 'coderabbitai[bot]'), thread('T3', 'stranger'), thread('T4', 'jacob', true)] })
    expect(allowedThreads(p, ['coderabbitai[bot]']).map((t) => t.id)).toEqual(['T1', 'T2'])
  })

  it('waits while off, while nothing is wrong and while the agent works', () => {
    const failing = pr({ required: { total: 1, failing: ['test'], pending: 0 } })
    expect(autoFixDecision(freshAutomation(7, false), input(failing))).toEqual({ kind: 'wait' })
    expect(autoFixDecision(on, input(pr()))).toEqual({ kind: 'wait' })
    expect(autoFixDecision(on, input(failing, false))).toEqual({ kind: 'wait' })
    expect(autoFixDecision(on, input(failing))).toMatchObject({ kind: 'send', failing: ['test'], threads: [] })
  })

  it('never sends the same situation twice, and stops when the agent did not push', () => {
    const failing = pr({ required: { total: 1, failing: ['test'], pending: 0 } })
    const first = autoFixDecision(on, input(failing))
    if (first.kind !== 'send') throw new Error('expected a send')
    const sent = afterSend(on, first)
    expect(sent).toMatchObject({ attempts: 1, lastHead: 'a'.repeat(40) })
    expect(autoFixDecision(sent, input(failing))).toEqual({ kind: 'wait' })
    // Same head, another failing check, no new thread: the agent did not push since.
    const other = pr({ required: { total: 2, failing: ['lint', 'test'], pending: 0 } })
    expect(autoFixDecision(sent, input(other))).toEqual({ kind: 'stop', reason: '自动修复已停：这一轮没有新的提交' })
    // A new thread on the same head is new work.
    const withThread = pr({ required: { total: 1, failing: ['test'], pending: 0 }, threads: [thread('T1', 'jacob')] })
    expect(autoFixDecision(sent, input(withThread))).toMatchObject({ kind: 'send' })
    // A new head: it pushed.
    expect(autoFixDecision(sent, input(pr({ headOid: 'b'.repeat(40), required: { total: 1, failing: ['test'], pending: 0 } })))).toMatchObject({ kind: 'send' })
  })

  it('stops after the cap', () => {
    const state = { ...on, attempts: 3, lastKey: 'x', lastHead: 'c'.repeat(40) }
    expect(autoFixDecision(state, input(pr({ required: { total: 1, failing: ['test'], pending: 0 } })))).toEqual({ kind: 'stop', reason: '自动修复已停：已经修了 3 次' })
    expect(autoFixDecision({ ...state, stopped: 'x' }, input(pr({ required: { total: 1, failing: ['test'], pending: 0 } })))).toEqual({ kind: 'wait' })
  })
})

const baseCi = (over: Partial<BaseCi> = {}, failing: string[] = ['test']): BaseCi => ({
  worktree: '/w',
  base: 'main',
  sha: 'a'.repeat(40),
  checks: {
    state: failing.length > 0 ? 'failing' : 'passing',
    total: 3,
    passed: 3 - failing.length,
    pending: 0,
    failing: failing.map((name) => ({ name, runId: null, jobId: null }))
  },
  url: 'https://github.com/a/b/commit/aaaa/checks',
  checkedAt: 1,
  ...over
})

const stoppedRun = (over: Partial<Extract<FixRun, { kind: 'stopped' }>> = {}): Extract<FixRun, { kind: 'stopped' }> => ({
  kind: 'stopped',
  sessionId: 's1',
  since: 'b'.repeat(40),
  key: 'test',
  checks: ['test'],
  baseFailing: null,
  decision: { kind: 'stop', reason: 'weakened' },
  ...over
})

const fixing: FixRun = { kind: 'fixing', sessionId: 's1', since: 'b'.repeat(40), key: 'test', checks: ['test'], baseFailing: null, sentAt: 1 }

describe('the fix loop around the brakes (Figma 29G)', () => {
  const failing = pr({ required: { total: 1, failing: ['test'], pending: 0 } })
  const input = (p: PullRequestInfo, agentIdle = true) => ({ pr: p, agentIdle, max: 3, bots: [] as string[] })

  it('waits while a fix is in flight or stopped', () => {
    const on = freshAutomation(7, true)
    expect(autoFixDecision({ ...on, run: fixing }, input(failing))).toEqual({ kind: 'wait' })
    expect(autoFixDecision({ ...on, run: stoppedRun() }, input(failing))).toEqual({ kind: 'wait' })
  })

  it('waits for the PR list to show the head Wavi pushed', () => {
    const on = { ...freshAutomation(7, true), afterPush: 'a'.repeat(40) }
    expect(autoFixDecision(on, input(failing))).toEqual({ kind: 'wait' })
    expect(autoFixDecision(on, input(pr({ headOid: 'c'.repeat(40), required: { total: 1, failing: ['test'], pending: 0 } })))).toMatchObject({ kind: 'send' })
  })

  it('counts a pushed fix and remembers its failure', () => {
    const next = afterPushed({ ...freshAutomation(7, true), run: fixing, attempts: 1 }, fixing, 'a'.repeat(40), 'f'.repeat(40))
    expect(next).toMatchObject({ run: null, pushed: 1, keys: ['test'], afterPush: 'a'.repeat(40), pushedShas: ['f'.repeat(40)] })
  })

  it('starts over when the user takes over the session', () => {
    const state = { ...freshAutomation(7, true), attempts: 2, pushed: 2, keys: ['x'], run: fixing, baseChecked: true, afterPush: 'a', lastKey: 'k' }
    expect(takenOver(state)).toMatchObject({ attempts: 0, pushed: 0, keys: [], run: null, baseChecked: false, afterPush: null, lastKey: 'k' })
    // The base failing already is not about the agent's work: the question stays.
    const asking = stoppedRun({ since: null, decision: { kind: 'ask', reason: 'base-broken', checks: ['test'] } })
    expect(takenOver({ ...state, run: asking }).run).toBe(asking)
  })

  it('offers the buttons that make sense for the stop', () => {
    expect(stopActions(stoppedRun())).toEqual({ kind: 'brake', push: true, discard: true })
    expect(stopActions(stoppedRun({ decision: { kind: 'stop', reason: 'no-progress' } }))).toEqual({ kind: 'brake', push: false, discard: false })
    expect(stopActions(stoppedRun({ since: null, decision: { kind: 'ask', reason: 'base-broken', checks: ['test'] } }))).toEqual({ kind: 'ask' })
  })

  it('keeps the first lines of fix.md as the attempt note', () => {
    expect(fixNote(null)).toBeNull()
    expect(fixNote('  \n')).toBeNull()
    expect(fixNote('# 修复 split 测试\n\n改了 a.ts\n\n第三行\n第四行')).toBe('修复 split 测试\n改了 a.ts\n第三行')
    expect(fixNote('x'.repeat(500))!.length).toBe(240)
  })
})

describe('自动修复 on the base (Figma 29E)', () => {
  const on = freshAutomation(0, true)
  const input = (ci: BaseCi | undefined, agentIdle = true) => ({ ci, agentIdle, max: 3 })

  it('sends for a failing base CI once the agent is idle, once per commit and failure', () => {
    expect(baseFixDecision(on, input(undefined))).toEqual({ kind: 'wait' })
    expect(baseFixDecision(on, input(baseCi({}, [])))).toEqual({ kind: 'wait' })
    expect(baseFixDecision(on, input(baseCi(), false))).toEqual({ kind: 'wait' })
    const decision = baseFixDecision(on, input(baseCi({}, ['test', 'e2e'])))
    expect(decision).toMatchObject({ kind: 'send', failing: ['e2e', 'test'], head: 'a'.repeat(40), threads: [] })
    if (decision.kind !== 'send') throw new Error('expected a send')
    expect(baseFixDecision(afterSend(on, decision), input(baseCi({}, ['test', 'e2e'])))).toEqual({ kind: 'wait' })
  })

  it('waits for the CI of the commit Wavi pushed, and while off, stopped or running', () => {
    expect(baseFixDecision({ ...on, afterPush: 'a'.repeat(40) }, input(baseCi()))).toEqual({ kind: 'wait' })
    expect(baseFixDecision({ ...on, afterPush: 'a'.repeat(40) }, input(baseCi({ sha: 'c'.repeat(40) })))).toMatchObject({ kind: 'send' })
    expect(baseFixDecision(freshAutomation(0, false), input(baseCi()))).toEqual({ kind: 'wait' })
    expect(baseFixDecision({ ...on, stopped: 'x' }, input(baseCi()))).toEqual({ kind: 'wait' })
    expect(baseFixDecision({ ...on, run: fixing }, input(baseCi()))).toEqual({ kind: 'wait' })
  })

  it('stops after the cap', () => {
    expect(baseFixDecision({ ...on, attempts: 3, lastKey: 'x' }, input(baseCi()))).toEqual({ kind: 'stop', reason: '自动修复已停：已经修了 3 次' })
  })

  it('says what is going on', () => {
    expect(baseAutomationText(undefined, { idle: true, wants: false })).toEqual({ text: '', tone: 'muted' })
    expect(baseAutomationText({ ...on, attempts: 1, run: fixing }, { idle: false, wants: false })).toEqual({ text: '第 1 次 · Claude 在修', tone: 'muted' })
    expect(baseAutomationText(on, { idle: false, wants: true })).toEqual({ text: '等 Claude 空闲', tone: 'muted' })
    expect(baseAutomationText({ ...on, attempts: 1 }, { idle: true, wants: false, name: 'Codex' })).toEqual({ text: '第 1 次 · 等 CI', tone: 'muted' })
    const asking = stoppedRun({ decision: { kind: 'ask', reason: 'base-broken', checks: ['test'] }, since: null })
    // The stopped row above says why (Figma 29J); after 不修 the CI line does.
    expect(baseAutomationText({ ...on, run: asking }, { idle: true, wants: false })).toEqual({ text: '', tone: 'muted' })
    expect(baseAutomationText({ ...on, stopped: '基线上本来就失败：test', baseBroken: ['test'] }, { idle: true, wants: false })).toEqual({ text: '', tone: 'muted' })
    expect(baseAutomationText({ ...on, stopped: '自动修复已停：x' }, { idle: true, wants: false })).toEqual({ text: '自动修复已停：x', tone: 'attention' })
  })
})

describe('通过后合并 and the PR rows (Figma 29I)', () => {
  it('is on with GitHub auto-merge or the queue', () => {
    expect(mergeWhenGreenOn({ pr: pr() })).toBe(false)
    expect(mergeWhenGreenOn({ pr: pr({ autoMerge: 'squash' }) })).toBe(true)
    expect(mergeWhenGreenOn({ pr: pr({ inMergeQueue: true }) })).toBe(true)
  })

  it('writes the PR line', () => {
    const running = pr({}, { state: 'pending', total: 3, passed: 2, pending: 1 })
    expect(prChecksText(running.checks)).toBe('检查 2/3 · 1 项在跑')
    expect(prLineText(running, '已打开', 0)).toBe('PR #7 · 已打开 · 检查 2/3 · 1 项在跑')
    expect(prLineText(running, '已打开', 3)).toBe('PR #7 · 已打开 · 检查 2/3 · 1 项在跑 · 3 条评论没解决')
    expect(prLineText(pr({ reviewDecision: 'review-required', mergeState: 'dirty' }), '已打开', 0)).toBe('PR #7 · 已打开 · 检查通过 1/1 · 需要审批 · 和基线冲突')
    expect(prLineText({ ...pr(), state: 'merged' }, '已合并', 2)).toBe('PR #7 · 已合并')
  })

  it('says the failing checks fail on the base too, and where the checks mark goes (Figma 29J)', () => {
    const failing = pr({}, { state: 'failing', total: 1, passed: 0, failing: [{ name: 'check', runId: null, jobId: null }] })
    expect(prLineParts(failing, '已打开', 0, { name: 'main', checks: ['check'] })).toEqual({ parts: ['PR #7', '已打开', '1 项检查失败：check', 'main 上也失败'], checks: 2 })
    expect(prLineText(failing, '已打开', 0, { name: 'main', checks: ['lint'] })).toBe('PR #7 · 已打开 · 1 项检查失败：check')
    expect(prLineParts({ ...pr(), state: 'merged' }, '已合并', 0).checks).toBe(-1)
  })

  it('splits the PR into the ship zone’s headline (checks) and facts (Figma 29R)', () => {
    const failing = pr({}, { state: 'failing', total: 1, passed: 0, failing: [{ name: 'check', runId: null, jobId: null }] })
    const onBase = prHeadline(failing, '已打开', 2, { name: 'main', checks: ['check'] })
    expect(onBase.headline).toBe('1 项检查失败：check · main 上也失败')
    expect(onBase.facts).toEqual(['2 条评论没解决'])
    expect(prHeadline({ ...pr(), state: 'merged' }, '已合并', 0)).toEqual({ headline: '已合并', facts: [] })
    expect(prHeadline({ ...failing, state: 'draft' }, '草稿', 0).facts).toEqual(['草稿'])
  })

  it('knows which checks fail on the base already: asked about, or declined', () => {
    const on = freshAutomation(7, true)
    const asking = stoppedRun({ since: null, decision: { kind: 'ask', reason: 'base-broken', checks: ['check'] } })
    expect(baseBrokenChecks(undefined)).toEqual([])
    expect(baseBrokenChecks({ ...on, run: asking })).toEqual(['check'])
    expect(baseBrokenChecks({ ...on, baseBroken: ['check'] })).toEqual(['check'])
  })

  it('asks instead of repeating the reason when the base fails already', () => {
    expect(stopLineText({ kind: 'ask', reason: 'base-broken', checks: ['check'] })).toBe('自动修复先停：要在这个分支修吗？')
    expect(stopLineText({ kind: 'stop', reason: 'repeated' })).toBe('自动修复已停：同一个失败又出现了')
    expect(stopParts({ kind: 'ask', reason: 'base-broken', checks: ['check'] })).toEqual({ fact: '自动修复先停', question: '要在这个分支修吗？' })
    expect(stopParts({ kind: 'stop', reason: 'repeated' })).toEqual({ fact: null, question: stopLineText({ kind: 'stop', reason: 'repeated' }) })
  })

  it('says what is going on', () => {
    const on = freshAutomation(7, true)
    const pending = { pr: pr({}, { state: 'pending' }) }
    expect(automationText({ ...on, attempts: 2, run: fixing }, pending, { idle: false })).toEqual({ text: '第 2 次 · Claude 在修', tone: 'muted' })
    expect(automationText({ ...on, attempts: 2 }, pending, { idle: true })).toEqual({ text: '第 2 次 · 等 CI', tone: 'muted' })
    expect(automationText(on, { pr: pr() }, { idle: false, wants: true, name: 'Codex' })).toEqual({ text: '等 Codex 空闲', tone: 'muted' })
    expect(automationText(on, { pr: pr({ autoMerge: 'squash' }) }, { idle: true }).text).toBe('检查通过后由 GitHub 合并（Squash）')
    expect(automationText({ ...on, mergeNote: '仓库没开 auto-merge：在 GitHub 设置里打开后才能检查通过后合并' }, { pr: pr() }, { idle: true })).toEqual({
      text: '仓库没开 auto-merge：在 GitHub 设置里打开后才能检查通过后合并',
      tone: 'attention'
    })
    expect(automationText(undefined, { pr: pr({ inMergeQueue: true }) }, { idle: true }).text).toBe('排队中')
    expect(automationText({ ...on, stopped: '自动修复已停：x' }, { pr: pr() }, { idle: true })).toEqual({ text: '自动修复已停：x', tone: 'attention' })
    expect(automationText({ ...on, run: stoppedRun() }, { pr: pr() }, { idle: true })).toEqual({ text: '', tone: 'muted' })
    expect(automationText({ ...on, stopped: '基线上本来就失败：check', baseBroken: ['check'] }, { pr: pr() }, { idle: true })).toEqual({ text: '', tone: 'muted' })
  })
})

describe('a fix the window had not finished (architecture review, batch 6)', () => {
  const base = { sessionId: 's1', key: 'k', checks: ['test'], baseFailing: null }
  const fixing: FixRun = { ...base, kind: 'fixing', since: 'abc1234', sentAt: 1 }
  const stopped: FixRun = { ...base, kind: 'stopped', since: 'abc1234', decision: { kind: 'stop', reason: 'repeated' } }
  const pushing: FixRun = { ...base, kind: 'pushing', since: 'abc1234' }
  const withRun = (number: number, run: FixRun | null): PrAutomation => ({ ...freshAutomation(number, true), attempts: 2, run })

  it('saves the runs of both scopes that are unfinished, not the ones being pushed', () => {
    const pr = { '/wt-a': withRun(7, fixing), '/wt-b': withRun(8, null), '/wt-c': withRun(9, pushing) }
    const baseScope = { '/wt-a': withRun(0, stopped) }
    expect(savedFixRuns(pr, baseScope)).toEqual([
      { scope: 'pr', worktree: '/wt-a', number: 7, run: fixing },
      { scope: 'base', worktree: '/wt-a', number: 0, run: stopped }
    ])
  })

  it('comes back stopped: a fix in flight as interrupted, its commits not pushed unchecked; the switches as set', () => {
    const back = restoredAutomation({ scope: 'pr', worktree: '/wt-a', number: 7, run: fixing }, false)
    expect(back).toMatchObject({ number: 7, autoFix: false, attempts: 0, run: { ...base, kind: 'stopped', since: 'abc1234', decision: { kind: 'stop', reason: 'interrupted' } } })
    expect(restoredAutomation({ scope: 'pr', worktree: '/wt-a', number: 7, run: stopped }, true)?.run).toEqual(stopped)
    expect(restoredAutomation({ scope: 'pr', worktree: '/wt-a', number: 7, run: pushing }, true)).toBeNull()
  })

  it('sends nothing new while it waits for the user', () => {
    const back = restoredAutomation({ scope: 'pr', worktree: '/wt-a', number: 7, run: fixing }, true)!
    expect(isInterrupted(back.run)).toBe(true)
    expect(isInterrupted(stopped)).toBe(false)
  })
})

describe('a fix whose turn never ends (an agent whose hooks did not arrive)', () => {
  const fixing: FixRun = { sessionId: 's1', key: 'k', checks: ['test'], baseFailing: null, kind: 'fixing', since: 'abc1234', sentAt: 1_000 }
  const state: PrAutomation = { ...freshAutomation(7, true), attempts: 1, run: fixing }

  it('stops after the timeout with that reason, keeping where the fix started for 丢弃 / 仍然推送', () => {
    expect(stalledFix(state, 1_000 + FIX_TURN_TIMEOUT_MS - 1)).toBeNull()
    const { sentAt: _sentAt, ...sent } = fixing as Extract<FixRun, { kind: 'fixing' }>
    expect(stalledFix(state, 1_000 + FIX_TURN_TIMEOUT_MS)?.run).toEqual({ ...sent, kind: 'stopped', decision: { kind: 'stop', reason: 'no-turn-end' } })
    expect(stalledFix({ ...state, run: null }, 1e12)).toBeNull()
  })

  it('says why in the row', () => {
    expect(brakeLabel({ kind: 'stop', reason: 'no-turn-end' })).toBe('自动修复已停：30 分钟没有收到这一轮结束的信号')
  })
})
