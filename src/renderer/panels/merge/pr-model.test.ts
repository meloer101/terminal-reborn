import { describe, expect, it } from 'vitest'
import type { PrDetails, PrStatus } from '@shared/pull-requests'
import { prMergeView } from './pr-model'

const head = 'a'.repeat(40)
const details = (over: Partial<PrDetails> = {}): PrDetails => ({
  id: 'PR_1',
  headOid: head,
  reviewDecision: null,
  mergeState: 'clean',
  inMergeQueue: false,
  autoMerge: null,
  required: { total: 3, failing: [], pending: 0 },
  threads: [],
  notes: [],
  repo: { autoMergeAllowed: false, deleteBranchOnMerge: false, methods: ['squash', 'merge'], defaultMethod: 'squash' },
  viewer: 'jacob',
  ...over
})
const status = (over: Partial<PrDetails> = {}, rest: Partial<PrStatus> = {}): PrStatus => ({
  worktree: '/w',
  branch: 'jacob/x',
  checkedAt: 0,
  local: { head, remoteAhead: false },
  pr: { number: 12, state: 'open', url: 'https://github.com/a/b/pull/12', title: 't', checks: { state: 'passing', total: 3, passed: 3, pending: 0, failing: [] }, details: details(over) },
  ...rest
})

describe('合并到 GitHub PR (Figma 22C / 22D)', () => {
  it('lists checks, the same code, and what only informs', () => {
    const view = prMergeView(status({ reviewDecision: 'review-required', threads: [{ id: 'T', path: 'a', line: 1, startLine: null, side: 'new', outdated: false, comments: [] }] }))!
    expect(view.lines).toEqual([
      { tone: 'ok', text: '必需的检查通过', meta: '3/3' },
      { tone: 'ok', text: '本地和 PR 是同一份代码', meta: 'aaaaaaa' },
      { tone: 'warn', text: '需要审批 · 1 条评论没解决', meta: '只提示' }
    ])
    expect(view.blockers).toEqual([])
    expect(view.waitForChecks).toBe(false)
    expect(view.methods).toEqual(['squash', 'merge'])
  })

  it('waits for running checks and for local commits to be pushed', () => {
    expect(prMergeView(status({ required: { total: 3, failing: [], pending: 2 } }))).toMatchObject({ waitForChecks: true, lines: [{ tone: 'working', text: '必需的检查还在跑', meta: '1/3' }, expect.anything()] })
    expect(prMergeView(status({}, { local: { head: 'b'.repeat(40), remoteAhead: false } }))).toMatchObject({ waitForChecks: true })
  })

  it('blocks failing required checks, commits that are not local, conflicts, drafts and a queued PR', () => {
    expect(prMergeView(status({ required: { total: 3, failing: ['test'], pending: 0 } }))!.blockers).toEqual(['必需的检查没通过'])
    expect(prMergeView(status({}, { local: { head: 'b'.repeat(40), remoteAhead: true } }))!.blockers).toEqual(['PR 上有本地没有的提交'])
    expect(prMergeView(status({ mergeState: 'dirty' }))!.blockers).toEqual(['和基线冲突'])
    const draft = status()
    draft.pr = { ...draft.pr!, state: 'draft' }
    expect(prMergeView(draft)!.blockers[0]).toContain('草稿')
    expect(prMergeView(status({ inMergeQueue: true }))!.blockers).toEqual(['已经在合并队列里'])
  })

  it('needs the PR details', () => {
    const bare = status()
    bare.pr = { ...bare.pr!, details: undefined }
    expect(prMergeView(bare)).toBeNull()
  })
})
