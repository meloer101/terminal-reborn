// CI on the base after 合并到 main 并推送 pushed it (PRD F16 v1.78, Figma 29E / 29F): the latest BaseCi per worktree that
// pushed one, and 自动修复's state for that base push (keyed by worktree path, PrAutomation with number 0). main pushes
// every change (auto-fix.ts subscribes and asks once per worktree, for a CI that settled before the window loaded).
import { create } from 'zustand'
import type { ChecksState } from '@shared/pull-requests'
import type { BaseCi } from '@shared/ship'
import type { PrAutomation } from './auto-fix-model'

interface BaseCiStore {
  byWorktree: Record<string, BaseCi>
  /** 自动修复 for the worktree's base push; only worktrees that pushed one have an entry. */
  automation: Record<string, PrAutomation>
}

export const useBaseCi = create<BaseCiStore>()(() => ({ byWorktree: {}, automation: {} }))

/** The newer of two answers for one worktree: a late reply about the same commit never overwrites a fresher one. */
export function newerBaseCi(prev: BaseCi | undefined, next: BaseCi): BaseCi {
  return prev && prev.sha === next.sha && prev.checkedAt > next.checkedAt ? prev : next
}

export function acceptBaseCi(ci: BaseCi): void {
  useBaseCi.setState((s) => {
    const current = newerBaseCi(s.byWorktree[ci.worktree], ci)
    return current === s.byWorktree[ci.worktree] ? s : { byWorktree: { ...s.byWorktree, [ci.worktree]: current } }
  })
}

export function setBaseAutomation(worktree: string, next: PrAutomation | null): void {
  useBaseCi.setState((s) => {
    const automation = { ...s.automation }
    if (next) automation[worktree] = next
    else delete automation[worktree]
    return { automation }
  })
}

/** The worktree's base CI, if Wavi pushed a base commit from it. */
export function useBaseCiOf(worktreePath: string | null | undefined): BaseCi | null {
  return useBaseCi((s) => (worktreePath ? (s.byWorktree[worktreePath] ?? null) : null))
}

/** The CI row's words and mark: `main 上的 CI · 2 项在跑`, `main 上的 CI 通过`, `main 上的 CI 失败 · test · e2e/split.spec.ts`. */
export function baseCiText(ci: Pick<BaseCi, 'base' | 'checks'>): { mark: ChecksState; text: string } {
  const { checks, base } = ci
  switch (checks.state) {
    case 'pending':
      return { mark: 'pending', text: `${base} 上的 CI · ${checks.pending} 项在跑` }
    case 'passing':
      return { mark: 'passing', text: `${base} 上的 CI 通过` }
    case 'failing': {
      const names = checks.failing.map((c) => c.name)
      return { mark: 'failing', text: [`${base} 上的 CI 失败`, ...names.slice(0, 3)].join(' · ') + (names.length > 3 ? ` 等 ${names.length} 项` : '') }
    }
    case 'none':
      return { mark: 'none', text: `${base} 上没有 CI 检查` }
  }
}
