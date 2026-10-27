import { describe, expect, it } from 'vitest'
import type { PrDetails, PrThread, PullRequestInfo } from '@shared/pull-requests'
import type { BaseCi } from '@shared/ship'
import {
  afterPushed,
  afterSend,
  allowedThreads,
  automationText,
  autoFixDecision,
  baseAutomationText,
  baseFixDecision,
  beforeFixDecision,
  failingChecks,
  fixNote,
  freshAutomation,
  mergeWhenGreenOn,
  prChecksText,
  prLineText,
  stopActions,
  takenOver,
  type FixRun
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
    expect(autoFixDecision(sent, input(other))).toEqual({ kind: 'stop', reason: '自动修复已停：上一次之后 agent 没有推送新提交' })
    // A new thread on the same head is new work.
    const withThread = pr({ required: { total: 1, failing: ['test'], pending: 0 }, threads: [thread('T1', 'jacob')] })
    expect(autoFixDecision(sent, input(withThread))).toMatchObject({ kind: 'send' })
    // A new head: it pushed.
    expect(autoFixDecision(sent, input(pr({ headOid: 'b'.repeat(40), required: { total: 1, failing: ['test'], pending: 0 } })))).toMatchObject({ kind: 'send' })
  })

  it('stops after the cap', () => {
    const state = { ...on, attempts: 3, lastKey: 'x', lastHead: 'c'.repeat(40) }
    expect(autoFixDecision(state, input(pr({ required: { total: 1, failing: ['test'], pending: 0 } })))).toEqual({ kind: 'stop', reason: '自动修复已停：3 次后 test 仍失败' })
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

  it('asks first when the base already fails the same checks', () => {
    expect(beforeFixDecision({ failingChecks: ['test', 'lint'], baseFailing: ['lint', 'e2e'] })).toEqual({ kind: 'ask', reason: 'base-broken', checks: ['lint'] })
    expect(beforeFixDecision({ failingChecks: ['test'], baseFailing: ['lint'] })).toEqual({ kind: 'go' })
    expect(beforeFixDecision({ failingChecks: ['test'], baseFailing: null })).toEqual({ kind: 'go' })
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
    expect(baseFixDecision({ ...on, attempts: 3, lastKey: 'x' }, input(baseCi()))).toEqual({ kind: 'stop', reason: '自动修复已停：3 次后 test 仍失败' })
  })

  it('says what is going on', () => {
    expect(baseAutomationText(undefined, { idle: true, wants: false })).toEqual({ text: '', tone: 'muted' })
    expect(baseAutomationText({ ...on, attempts: 1, run: fixing }, { idle: false, wants: false })).toEqual({ text: '第 1 次 · Claude 在修', tone: 'muted' })
    expect(baseAutomationText(on, { idle: false, wants: true })).toEqual({ text: '等 Claude 空闲', tone: 'muted' })
    expect(baseAutomationText({ ...on, attempts: 1 }, { idle: true, wants: false, name: 'Codex' })).toEqual({ text: '第 1 次 · 等 CI', tone: 'muted' })
    const asking = stoppedRun({ decision: { kind: 'ask', reason: 'base-broken', checks: ['test'] }, since: null })
    expect(baseAutomationText({ ...on, run: asking }, { idle: true, wants: false })).toEqual({ text: '基线上本来就失败：test', tone: 'attention' })
    expect(baseAutomationText({ ...on, stopped: '自动修复已停：x' }, { idle: true, wants: false })).toEqual({ text: '自动修复已停：x', tone: 'attention' })
  })
})

describe('通过后合并 and the PR rows (Figma 29I)', () => {
  it('is on with GitHub auto-merge, Wavi waiting or the queue', () => {
    expect(mergeWhenGreenOn({ pr: pr() })).toBe(false)
    expect(mergeWhenGreenOn({ pr: pr({ autoMerge: 'squash' }) })).toBe(true)
    expect(mergeWhenGreenOn({ pr: pr(), waiting: 'merge' })).toBe(true)
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

  it('says what is going on', () => {
    const on = freshAutomation(7, true)
    const pending = { pr: pr({}, { state: 'pending' }) }
    expect(automationText({ ...on, attempts: 2, run: fixing }, pending, { idle: false })).toEqual({ text: '第 2 次 · Claude 在修', tone: 'muted' })
    expect(automationText({ ...on, attempts: 2 }, pending, { idle: true })).toEqual({ text: '第 2 次 · 等 CI', tone: 'muted' })
    expect(automationText(on, { pr: pr() }, { idle: false, wants: true, name: 'Codex' })).toEqual({ text: '等 Codex 空闲', tone: 'muted' })
    expect(automationText(on, { pr: pr({ autoMerge: 'squash' }) }, { idle: true }).text).toBe('检查通过后由 GitHub 合并（Squash）')
    expect(automationText(undefined, { pr: pr(), waiting: 'merge' }, { idle: true }).text).toBe('检查通过后由 Wavi 合并（Wavi 要开着）')
    expect(automationText(undefined, { pr: pr({ inMergeQueue: true }) }, { idle: true }).text).toBe('排队中')
    expect(automationText({ ...on, stopped: '自动修复已停：x' }, { pr: pr() }, { idle: true })).toEqual({ text: '自动修复已停：x', tone: 'attention' })
    expect(automationText({ ...on, run: stoppedRun() }, { pr: pr() }, { idle: true })).toEqual({ text: '自动修复已停：weakened', tone: 'attention' })
  })
})
