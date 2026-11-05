import { describe, expect, it } from 'vitest'
import type { ShipPreflight } from '@shared/ship'
import { exitPlan, shipContextFor, shipExits, type ExitState } from './exit-model'

function ok(patch: Partial<Extract<ShipPreflight, { ok: true }>> = {}): ShipPreflight {
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

function state(preflight: ShipPreflight | null, patch: Partial<ExitState> = {}): ExitState {
  return { preflight, remembered: null, unpushed: false, ...patch }
}

describe('shipExits', () => {
  it('shows both exits with a checking blocker while the preflight is pending', () => {
    const { primary, secondary } = shipExits(state(null))
    expect(primary).toEqual({ kind: 'main', label: '合并到 main 并推送', blocker: '正在检查…' })
    expect(secondary).toEqual({ kind: 'pr', label: '创建 PR', blocker: '正在检查…' })
  })

  it('keeps the remembered order while pending', () => {
    const { primary, secondary } = shipExits(state(null, { remembered: 'pr' }))
    expect(primary).toMatchObject({ kind: 'pr', blocker: '正在检查…' })
    expect(secondary).toMatchObject({ kind: 'main', blocker: '正在检查…' })
  })

  it('puts the preflight failure on both exits, main first', () => {
    const { primary, secondary } = shipExits(state({ ok: false, message: '不是 git 仓库' }, { remembered: 'pr' }))
    expect(primary).toEqual({ kind: 'main', label: '合并到 main 并推送', blocker: '不是 git 仓库' })
    expect(secondary).toEqual({ kind: 'pr', label: '创建 PR', blocker: '不是 git 仓库' })
  })

  describe('with an open PR', () => {
    it('opens it when there is nothing to push', () => {
      expect(shipExits(state(ok({ openPr: 12 })))).toEqual({
        primary: { kind: 'open-pr', number: 12, label: '打开 PR #12', blocker: null },
        secondary: null
      })
    })

    it('pushes to it when the head moved', () => {
      expect(shipExits(state(ok({ openPr: 12 }), { unpushed: true }))).toEqual({
        primary: { kind: 'push-pr', number: 12, label: '推送到 PR #12', blocker: null },
        secondary: null
      })
    })

    it('commits and pushes when the worktree is dirty', () => {
      expect(shipExits(state(ok({ openPr: 12, uncommitted: 3 })))).toEqual({
        primary: { kind: 'push-pr', number: 12, label: '提交并推送到 PR #12', blocker: null },
        secondary: null
      })
      expect(shipExits(state(ok({ openPr: 12, uncommitted: 1 }), { unpushed: true })).primary).toMatchObject({
        label: '提交并推送到 PR #12'
      })
    })

    it('ignores the remembered exit and an empty branch', () => {
      const result = shipExits(state(ok({ openPr: 5, ahead: 0 }), { remembered: 'main' }))
      expect(result.primary).toMatchObject({ kind: 'open-pr', number: 5 })
      expect(result.secondary).toBeNull()
    })
  })

  it('offers only 合并到 base when the repository has no remote', () => {
    expect(shipExits(state(ok({ remote: null, base: 'develop', suggested: 'pr' }), { remembered: 'pr' }))).toEqual({
      primary: { kind: 'main', label: '合并到 develop', blocker: null },
      secondary: null
    })
  })

  describe('with two exits', () => {
    it('uses the suggestion when nothing is remembered', () => {
      const { primary, secondary } = shipExits(state(ok({ suggested: 'pr' })))
      expect(primary).toEqual({ kind: 'pr', label: '创建 PR', blocker: null })
      expect(secondary).toEqual({ kind: 'main', label: '合并到 main 并推送', blocker: null })
    })

    it('prefers the remembered exit over the suggestion', () => {
      expect(shipExits(state(ok({ suggested: 'pr' }), { remembered: 'main' })).primary.kind).toBe('main')
      expect(shipExits(state(ok({ suggested: 'main' }), { remembered: 'pr' })).primary.kind).toBe('pr')
    })

    it('names the base in the label', () => {
      const { primary } = shipExits(state(ok({ base: 'develop' })))
      expect(primary).toMatchObject({ kind: 'main', label: '合并到 develop 并推送' })
    })

    it('blocks both exits with their own reasons when there is nothing to ship', () => {
      const { primary, secondary } = shipExits(state(ok({ ahead: 0, uncommitted: 0, base: 'develop' })))
      expect(primary).toMatchObject({ kind: 'main', blocker: '没有要合并的改动' })
      expect(secondary).toMatchObject({ kind: 'pr', blocker: '没有比 develop 新的提交' })
    })

    it('does not block when only uncommitted changes exist', () => {
      const { primary, secondary } = shipExits(state(ok({ ahead: 0, uncommitted: 2 })))
      expect(primary.blocker).toBeNull()
      expect(secondary?.blocker).toBeNull()
    })

    it('does not block when only commits exist', () => {
      expect(shipExits(state(ok({ ahead: 1, uncommitted: 0 }))).primary.blocker).toBeNull()
    })

    it('blocks both exits once the commits are squash-merged, until there is new work', () => {
      const { primary, secondary } = shipExits(state(ok({ ahead: 1, merged: true, uncommitted: 0 })))
      expect(primary.blocker).toBe('没有要合并的改动')
      expect(secondary?.blocker).toBe('没有比 main 新的提交')
      expect(shipExits(state(ok({ ahead: 1, merged: true, uncommitted: 1 }))).primary.blocker).toBeNull()
    })
  })

  it('blocks the single main exit when there is nothing to ship and no remote', () => {
    expect(shipExits(state(ok({ remote: null, ahead: 0 }))).primary).toEqual({
      kind: 'main',
      label: '合并到 main',
      blocker: '没有要合并的改动'
    })
  })
})

describe('exitPlan', () => {
  const changes = { branch: 'feat/x', base: 'main', ahead: 2, uncommitted: [], untrackedOmitted: 0 }
  const pr = { number: 7, state: 'open' as const, url: 'https://github.com/o/r/pull/7', details: { headOid: 'aaa' } } as never
  const plan = (patch: Partial<Parameters<typeof exitPlan>[0]> = {}) =>
    exitPlan({ preflight: ok(), remembered: null, prStatus: null, changes, isMain: false, projectRoot: '/r', ...patch })

  it('offers both exits for a branch with work, and says what blocks them', () => {
    const p = plan()
    expect(p.exits.primary.kind).toBe('main')
    expect(p.nothingToShip).toBe(false)
    expect(p.blocker(p.exits.primary)).toBeNull()
    expect(plan({ preflight: null }).blocker(p.exits.primary)).toBe('正在检查…')
    expect(plan({ projectRoot: null }).blocker(p.exits.primary)).toBe('找不到这个 worktree 的项目')
  })

  it('has nothing to ship once the work is merged, and nothing on the main checkout’s own base', () => {
    expect(plan({ preflight: ok({ merged: true }) }).nothingToShip).toBe(true)
    const base = plan({ isMain: true, changes: { ...changes, branch: 'main' } })
    expect(base.onBase).toBe(true)
    expect(base.blocker(base.exits.primary)).toMatch(/基线分支/)
  })

  it('sees an open PR with nothing to push as idle, and one with a newer local head as unpushed', () => {
    const idle = plan({ prStatus: { worktree: '/w', branch: 'feat/x', pr, checkedAt: 0, local: { head: 'aaa', remoteAhead: false } } })
    expect(idle.idlePr?.number).toBe(7)
    const ahead = plan({ prStatus: { worktree: '/w', branch: 'feat/x', pr, checkedAt: 0, local: { head: 'bbb', remoteAhead: false } } })
    expect(ahead.unpushed).toBe(true)
    expect(ahead.idlePr).toBeNull()
  })
})

describe('shipContextFor', () => {
  it('commits the uncommitted paths that are not nested repositories, and keeps the PR', () => {
    const ctx = shipContextFor({
      projectRoot: '/r',
      worktreePath: '/w',
      preflight: ok() as Extract<ShipPreflight, { ok: true }>,
      changes: { uncommitted: [{ path: 'a.ts', status: 'M', added: 1, removed: 0 }, { path: 'sub/', status: 'A', added: null, removed: null, nested: true }] },
      pr: null,
      agentSession: 's1',
      openIn: 's1',
      checksLine: null,
      settings: { review: {} as never, pr: {} as never }
    })
    expect(ctx).toMatchObject({ root: '/r', worktree: '/w', base: 'main', branch: 'feat/x', paths: ['a.ts'], openPr: null, sessionId: 's1' })
  })
})
