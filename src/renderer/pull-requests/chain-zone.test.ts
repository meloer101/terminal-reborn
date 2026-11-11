import { describe, expect, it } from 'vitest'
import type { ShipPreflight } from '@shared/ship'
import { CHAIN_TEXT, shipChain, type ChainInput } from '@shared/ship-chain'
import type { PrStatus, PullRequestInfo } from '@shared/pull-requests'
import type { ShipOperationRequest, ShipOperationResult } from '@shared/ship'
import { abortConfirmation, mergePrBlocker, paletteGitActions, runOperation, shortReason, zoneFiles, zoneHeadline, zoneMenu } from './chain-zone'

type Ok = Extract<ShipPreflight, { ok: true }>

const preflight = (patch: Partial<Ok> = {}): Ok => ({
  ok: true,
  branch: 'jacoy/tidy-owl',
  base: 'main',
  remote: 'origin',
  baseProtected: false,
  suggested: 'main',
  uncommitted: 2,
  ahead: 2,
  merged: false,
  baseAheadOfUpstream: 0,
  baseBehindUpstream: 0,
  openPr: null,
  mergeMethods: null,
  head: 'c0ffee',
  gh: 'ready',
  remoteOnGitHub: true,
  operation: null,
  behindBase: 0,
  baseConflicts: [],
  pushed: false,
  upstream: null,
  ...patch
})

const input = (patch: Partial<ChainInput> = {}, pf: ShipPreflight | null = preflight()): ChainInput => ({
  preflight: pf,
  remembered: null,
  local: { branch: 'jacoy/tidy-owl', base: 'main', ahead: 2, uncommitted: 2, trackedUncommitted: 2 },
  pr: null,
  prMerged: false,
  isMain: false,
  projectRoot: '/repo',
  gh: null,
  agent: 'Claude',
  sessions: [{ status: 'idle' }],
  radarConflicts: null,
  ...patch
})

describe('zoneHeadline', () => {
  it('is the reason the other exit is blocked when the chain has no headline (73C1), split at its colon', () => {
    const chain = shipChain(input({ gh: 'signed-out' }))
    expect(chain.next?.id).toBe('main')
    expect(zoneHeadline(chain)).toEqual({ tone: 'blocked', strong: 'gh 还没有登录', rest: '在终端运行 gh auth login 后可以创建 PR' })
  })

  it('says nothing when both exits can run', () => {
    expect(zoneHeadline(shipChain(input()))).toBeNull()
  })

  it('a detached HEAD is the preflight’s sentence (73C2)', () => {
    expect(zoneHeadline(shipChain(input({}, { ok: false, message: '分离 HEAD' })))).toEqual({ tone: 'blocked', strong: '分离 HEAD', rest: null })
  })

  it('conflicts with the base (73C3) and an operation in progress (73D3 / 73D4)', () => {
    const conflicts = shipChain(input({ local: { branch: 'b', base: 'main', ahead: 2, uncommitted: 0, trackedUncommitted: 0 } }, preflight({ uncommitted: 0, baseConflicts: ['a.ts', 'b.ts'], behindBase: 5 })))
    expect(zoneHeadline(conflicts)).toMatchObject({ strong: '和 main 会冲突 · 2 个文件' })
    const stopped = preflight({ operation: { kind: 'rebase', unresolved: ['a.ts'] } })
    expect(zoneHeadline(shipChain(input({}, stopped)))).toMatchObject({ tone: 'blocked', strong: 'rebase 进行中 · 1 个文件有冲突' })
    const resolved = preflight({ operation: { kind: 'rebase', unresolved: [] } })
    expect(zoneHeadline(shipChain(input({}, resolved)))).toEqual({ tone: 'ok', strong: 'rebase 进行中 · 冲突都解决了', rest: null })
  })
})

describe('zoneFiles', () => {
  it('lists what would conflict, else the radar’s files, and an operation’s unresolved files', () => {
    const pf = preflight({ uncommitted: 0, baseConflicts: ['a.ts'] })
    const local = { branch: 'b', base: 'main', ahead: 2, uncommitted: 0, trackedUncommitted: 0 }
    expect(zoneFiles(shipChain(input({ local }, pf)), pf, null)).toEqual(['a.ts'])
    const unknown = preflight({ uncommitted: 0, baseConflicts: null })
    expect(zoneFiles(shipChain(input({ local, radarConflicts: ['r.ts'] }, unknown)), unknown, ['r.ts'])).toEqual(['r.ts'])
    const op = preflight({ operation: { kind: 'merge', unresolved: ['x.ts', 'y.ts'] } })
    expect(zoneFiles(shipChain(input({}, op)), op, null)).toEqual(['x.ts', 'y.ts'])
    expect(zoneFiles(shipChain(input()), preflight(), null)).toEqual([])
  })
})

describe('zoneMenu (73B)', () => {
  it('lists the fixed order, 合并到 <base>… opening the merge sheet, a blocked item with its short reason', () => {
    const chain = shipChain(input({ sessions: [{ status: 'running' }] }, preflight({ behindBase: 0 })))
    const menu = zoneMenu(chain)
    expect(menu.map((m) => m.label)).toEqual(['提交…', '同步 main', '拉取', '推送', '创建 PR', '合并到 main…', '归档…'])
    expect(menu.find((m) => m.id === 'main')).toMatchObject({ command: 'merge-sheet', blocker: null })
    expect(menu.find((m) => m.id === 'sync')!.blocker).toBe(CHAIN_TEXT.commitFirst)
    expect(menu.find((m) => m.id === 'pull')!.blocker).toBe(CHAIN_TEXT.neverPushed)
    expect(menu.find((m) => m.id === 'archive')!.blocker).not.toBeNull()
  })

  it('while a PR is open: 推送到 PR #N and 合并 PR #N…, no 合并到 <base>…', () => {
    const pf = preflight({ openPr: 12, upstream: { ahead: 1, behind: 0 }, pushed: true })
    const chain = shipChain(input({ pr: { number: 12, draft: false, unpushed: true, remoteAhead: false, details: true, conflicting: false } }, pf))
    const labels = zoneMenu(chain).map((m) => m.label)
    expect(labels).toContain('提交并推送到 PR #12')
    expect(labels).toContain('合并 PR #12…')
    expect(labels).not.toContain('合并到 main…')
  })

  it('shortens a reason to the part before its colon', () => {
    expect(shortReason(CHAIN_TEXT.ghSignedOut)).toBe('gh 还没有登录')
    expect(shortReason(CHAIN_TEXT.neverPushed)).toBe(CHAIN_TEXT.neverPushed)
  })
})

describe('ticks (the chain\'s `ticked` input)', () => {
  it('blocks 提交… with 没有勾选文件 in the menu when files are uncommitted but none is ticked', () => {
    expect(zoneMenu(shipChain(input({ ticked: 0 }))).find((m) => m.id === 'commit')!.blocker).toBe(CHAIN_TEXT.noTicked)
    expect(zoneMenu(shipChain(input({ ticked: 1 }))).find((m) => m.id === 'commit')!.blocker).toBeNull()
    // The chain's own reason wins.
    const clean = shipChain(input({ ticked: 0, local: { branch: 'b', base: 'main', ahead: 2, uncommitted: 0, trackedUncommitted: 0 } }, preflight({ uncommitted: 0 })))
    expect(zoneMenu(clean).find((m) => m.id === 'commit')!.blocker).toBe(CHAIN_TEXT.nothingToCommit)
  })
})

describe('paletteGitActions (73H)', () => {
  it('lists only what can run, with what it acts on, the primary marked, then review and the PR', () => {
    const pf = preflight({ behindBase: 4, baseConflicts: [], uncommitted: 0 })
    const chain = shipChain(input({ remembered: 'pr', local: { branch: 'b', base: 'main', ahead: 2, uncommitted: 3, trackedUncommitted: 0 } }, pf))
    const rows = paletteGitActions(chain, { ticked: 3, behind: 4, branch: 'session-cookie', remote: 'origin', reviewFiles: 12, pr: null })
    expect(rows.map((r) => [r.label, r.detail, r.primary])).toEqual([
      ['提交…', '3 个文件', false],
      ['同步 main', '落后 4', false],
      ['推送', 'session-cookie → origin', false],
      ['创建 PR', '', true],
      ['合并到 main 并推送', '', false],
      ['审阅全部改动', '12 个文件', false]
    ])
    expect(paletteGitActions(chain, { ticked: 3, behind: 4, branch: 'b', remote: 'origin', reviewFiles: null, pr: 7 }).at(-1)).toMatchObject({ command: 'open-pr', label: '打开 PR #7' })
  })

  it('offers 归档… only once the branch is merged', () => {
    const facts = { ticked: 0, behind: null, branch: 'b', remote: 'origin', reviewFiles: null, pr: null }
    const merged = shipChain(input({ local: { branch: 'b', base: 'main', ahead: 2, uncommitted: 0, trackedUncommitted: 0 } }, preflight({ merged: true, uncommitted: 0 })))
    expect(merged.stage).toBe('merged')
    expect(paletteGitActions(merged, facts).map((r) => r.label)).toContain('归档…')
    const open = shipChain(input())
    expect(open.actions.find((a) => a.id === 'archive')?.blocker).toBeNull()
    expect(paletteGitActions(open, facts).map((r) => r.label)).not.toContain('归档…')
  })
})

// Review finding 8: 合并 PR #N… opens the PR merge sheet only, never the local one in its place.
describe('mergePrBlocker', () => {
  const pr = { number: 3, state: 'open', url: 'u', title: 't', checks: { state: 'none', total: 0, passed: 0, pending: 0, failing: [] } } as PullRequestInfo
  const status = (patch: Partial<PullRequestInfo>): PrStatus => ({ worktree: '/w', branch: 'b', pr: { ...pr, ...patch }, checkedAt: 0 })
  it('waits for the PR\'s details', () => {
    expect(mergePrBlocker(status({}))).toBe(CHAIN_TEXT.checking)
    expect(mergePrBlocker(status({ details: { headOid: 'a' } as never }))).toBeNull()
    expect(mergePrBlocker(status({ state: 'merged', details: { headOid: 'a' } as never }))).toBe(CHAIN_TEXT.noPr)
    expect(mergePrBlocker(null)).toBe(CHAIN_TEXT.checking)
  })
})

// Review finding 2: 中止 that would lose resolved or edited files asks first.
describe('runOperation', () => {
  const target = { root: '/r', worktree: '/w' }
  const sent: ShipOperationRequest[] = []
  const fake = (answers: ShipOperationResult[]) => (request: ShipOperationRequest) => {
    sent.push(request)
    return Promise.resolve(answers.shift()!)
  }

  it('names what is lost, with 中止 / 取消', () => {
    expect(abortConfirmation('rebase', ['a.ts', 'b.ts'])).toEqual({
      message: '中止 rebase 会丢掉 2 个文件里已解决或改过的内容',
      detail: 'a.ts\nb.ts',
      confirmLabel: '中止',
      cancelLabel: '取消',
      destructive: true
    })
    const many = abortConfirmation('cherry-pick', Array.from({ length: 12 }, (_, i) => `f${i}.ts`))
    expect(many.detail?.split('\n')).toHaveLength(9)
    expect(many.detail?.endsWith('等 12 个文件')).toBe(true)
  })

  it('resends 中止 with force only when the user says 中止', async () => {
    sent.length = 0
    const asked: string[] = []
    const yes = await runOperation({ ...target, action: 'abort' }, 'rebase', fake([{ ok: false, reason: 'confirm', files: ['a.ts'] }, { ok: true }]), async (o) => (asked.push(o.message), true))
    expect(yes).toEqual({ ok: true })
    expect(asked).toEqual(['中止 rebase 会丢掉 1 个文件里已解决或改过的内容'])
    expect(sent).toEqual([{ ...target, action: 'abort' }, { ...target, action: 'abort', force: true }])

    sent.length = 0
    const no = await runOperation({ ...target, action: 'abort' }, 'rebase', fake([{ ok: false, reason: 'confirm', files: ['a.ts'] }]), async () => false)
    expect(no).toBeNull()
    expect(sent).toEqual([{ ...target, action: 'abort' }])
  })

  it('passes every other answer through', async () => {
    sent.length = 0
    const result = await runOperation({ ...target, action: 'continue' }, 'merge', fake([{ ok: false, reason: 'conflicts', files: ['x'] }]), async () => true)
    expect(result).toEqual({ ok: false, reason: 'conflicts', files: ['x'] })
    expect(sent).toHaveLength(1)
  })
})
