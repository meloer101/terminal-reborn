// The ship preflight per worktree (合入链路 v2): Git · 变更 asks for it and keeps the answer here, so ⌘K's Git group and
// the chain's actions read the same state as the zone. `generation` is bumped after something changed the worktree's
// git state that the change list may not show (继续 / 中止), so the zone asks again.
import { create } from 'zustand'
import type { PrTarget } from '@shared/pull-requests'
import type { ShipPreflight } from '@shared/ship'

interface ChainStore {
  preflights: Record<string, ShipPreflight>
  generation: Record<string, number>
}

export const useChainStore = create<ChainStore>()(() => ({ preflights: {}, generation: {} }))

export function acceptPreflight(worktree: string, preflight: ShipPreflight): void {
  useChainStore.setState((s) => ({ preflights: { ...s.preflights, [worktree]: preflight } }))
}

const asked = new Map<string, number>()

/** Asks main for the worktree's preflight and keeps it (an answer to an older question is dropped); a failed call is
 *  kept as a failed preflight. */
export async function loadPreflight(target: PrTarget): Promise<ShipPreflight> {
  const serial = (asked.get(target.worktree) ?? 0) + 1
  asked.set(target.worktree, serial)
  const preflight: ShipPreflight = await window.tr.ship
    .preflight(target)
    .catch((error: unknown) => ({ ok: false, message: error instanceof Error ? error.message : String(error) }))
  if (asked.get(target.worktree) === serial) acceptPreflight(target.worktree, preflight)
  return preflight
}

export function bumpChain(worktree: string): void {
  useChainStore.setState((s) => ({ generation: { ...s.generation, [worktree]: (s.generation[worktree] ?? 0) + 1 } }))
}
