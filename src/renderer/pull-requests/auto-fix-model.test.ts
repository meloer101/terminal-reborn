import { describe, expect, it } from 'vitest'
import type { PrDetails, PrThread, PullRequestInfo } from '@shared/pull-requests'
import { afterSend, allowedThreads, automationText, autoFixDecision, failingChecks, freshAutomation, mergeWhenGreenOn } from './auto-fix-model'

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

describe('通过后合并 and the PR line (Figma 22E)', () => {
  it('is on with GitHub auto-merge, Wavi waiting or the queue', () => {
    expect(mergeWhenGreenOn({ pr: pr() })).toBe(false)
    expect(mergeWhenGreenOn({ pr: pr({ autoMerge: 'squash' }) })).toBe(true)
    expect(mergeWhenGreenOn({ pr: pr(), waiting: 'merge' })).toBe(true)
    expect(mergeWhenGreenOn({ pr: pr({ inMergeQueue: true }) })).toBe(true)
  })

  it('says what is going on', () => {
    expect(automationText({ ...freshAutomation(7, true), attempts: 2 }, { pr: pr({}, { state: 'pending' }) }, false)).toEqual({ text: '自动修复 · 第 2 次 · agent 在改', tone: 'muted' })
    expect(automationText(freshAutomation(7, true), { pr: pr({ autoMerge: 'squash' }) }, true).text).toBe('自动修复已打开 · 检查通过后由 GitHub 合并（Squash）')
    expect(automationText(undefined, { pr: pr(), waiting: 'merge' }, true).text).toBe('检查通过后由 Wavi 合并（Wavi 要开着）')
    expect(automationText(undefined, { pr: pr({ inMergeQueue: true }) }, true).text).toBe('排队中')
    expect(automationText({ ...freshAutomation(7, true), stopped: '自动修复已停：x' }, { pr: pr() }, true)).toEqual({ text: '自动修复已停：x', tone: 'attention' })
  })
})
