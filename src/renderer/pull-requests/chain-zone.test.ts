import { describe, expect, it } from 'vitest'
import type { ShipPreflight } from '@shared/ship'
import { CHAIN_TEXT, shipChain, type ChainInput } from '@shared/ship-chain'
import { NO_TICKED, paletteGitActions, shortReason, withTicks, zoneFiles, zoneHeadline, zoneMenu } from './chain-zone'

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
    const chain = shipChain(input({ pr: { number: 12, draft: false, unpushed: true, remoteAhead: false } }, pf))
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

describe('withTicks', () => {
  it('blocks 提交… with 没有勾选文件 when files are uncommitted but none is ticked', () => {
    const chain = withTicks(shipChain(input()), 0)
    expect(chain.actions.find((a) => a.id === 'commit')!.blocker).toBe(NO_TICKED)
    expect(withTicks(shipChain(input()), 1).actions.find((a) => a.id === 'commit')!.blocker).toBeNull()
    // The chain's own reason wins.
    const clean = shipChain(input({ local: { branch: 'b', base: 'main', ahead: 2, uncommitted: 0, trackedUncommitted: 0 } }, preflight({ uncommitted: 0 })))
    expect(withTicks(clean, 0).actions.find((a) => a.id === 'commit')!.blocker).toBe(CHAIN_TEXT.nothingToCommit)
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
