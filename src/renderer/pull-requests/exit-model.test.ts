import { describe, expect, it } from 'vitest'
import type { ShipPreflight } from '@shared/ship'
import { shipExits, type ExitState } from './exit-model'

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
    baseAheadOfUpstream: 0,
    baseBehindUpstream: 0,
    openPr: null,
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
  })

  it('blocks the single main exit when there is nothing to ship and no remote', () => {
    expect(shipExits(state(ok({ remote: null, ahead: 0 }))).primary).toEqual({
      kind: 'main',
      label: '合并到 main',
      blocker: '没有要合并的改动'
    })
  })
})
