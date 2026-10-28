// The facts in Git · 变更's ship zone (PRD F13 v1.78, Figma 29R): the risk markers read off the diff (tests deleted or
// skipped, checks silenced, CI config, dependencies, migrations) and the checks the agent ran this turn, on one line
// with the PR's facts. All facts from rules and hooks, no model; they inform the exit, they never block it.
import { useEffect, useRef, useState } from 'react'
import type { PrTarget } from '@shared/pull-requests'
import { riskLabel, type RiskMarker } from '@shared/risk-markers'
import type { TurnCheckView } from '@shared/turn-checks'
import { checksRow } from './facts-model'
import ci from './CiRows.module.css'
/** The change list moves in bursts while the agent works: ask for the markers once it settles. */
const DEBOUNCE_MS = 1000

/** The risk markers of the worktree's whole change, refreshed (debounced) whenever `changeKey` changes. */
export function useRisks(target: PrTarget | null, changeKey: string): RiskMarker[] {
  const [risks, setRisks] = useState<RiskMarker[]>([])
  const first = useRef(true)
  const root = target?.root
  const worktree = target?.worktree
  useEffect(() => {
    if (!root || !worktree) return
    let live = true
    const timer = window.setTimeout(
      () => {
        void window.tr.ship
          .risks({ root, worktree })
          .then((next) => live && setRisks(next))
          .catch(() => live && setRisks([]))
      },
      first.current ? 0 : DEBOUNCE_MS
    )
    first.current = false
    return () => {
      live = false
      window.clearTimeout(timer)
    }
  }, [root, worktree, changeKey])
  return root && worktree ? risks : []
}

/**
 * The ship zone's facts line (Figma 29R): one quiet row of what is known about the change and the PR — this turn's
 * checks, the risk markers, the PR's own facts and what its switches are doing — joined, the whole of it in the tooltip.
 */
export function FactsLine({
  risks,
  checks,
  more,
  note = null
}: {
  risks: readonly RiskMarker[]
  checks: TurnCheckView | null
  more: readonly string[]
  /** What the agent wrote about its last fix (fix.md), for the tooltip. */
  note?: string | null
}) {
  const parts = [...(checks ? [checksRow(checks).text] : []), ...risks.map(riskLabel), ...more]
  if (parts.length === 0) return null
  const text = parts.join(' · ')
  return (
    <p className={ci.facts} data-testid="facts" aria-label="这次改动的事实" title={note ? `${text}\n${note}` : text}>
      {text}
    </p>
  )
}
