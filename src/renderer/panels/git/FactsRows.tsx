// The facts under Git · 变更's files, above the ship zone (PRD F13 v1.78, Figma 29A / 29K2): one row per risk marker read
// off the diff (tests deleted or skipped, checks silenced, CI config, dependencies, migrations) and the checks the agent
// ran this turn. Both are facts from rules and hooks, no model; they inform the exit, they never block it.
import { Check, CircleAlert, Minus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { PrTarget } from '@shared/pull-requests'
import { riskLabel, type RiskMarker } from '@shared/risk-markers'
import type { TurnCheckView } from '@shared/turn-checks'
import { checksRow } from './facts-model'
import styles from './FactsRows.module.css'

const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const
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

export function FactsRows({ risks, checks }: { risks: readonly RiskMarker[]; checks: TurnCheckView | null }) {
  if (risks.length === 0 && !checks) return null
  const row = checks ? checksRow(checks) : null
  const Mark = row?.tone === 'fail' ? X : row?.tone === 'ok' ? Check : Minus
  return (
    <ul className={styles.facts} aria-label="这次改动的事实" data-testid="facts">
      {risks.map((marker) => (
        <li key={`${marker.kind}:${marker.path}`} className={styles.row} data-tone="risk">
          <CircleAlert {...ICON} />
          <span className={styles.text} title={riskLabel(marker)}>
            {riskLabel(marker)}
          </span>
        </li>
      ))}
      {row && (
        <li className={styles.row} data-tone={row.tone}>
          <Mark {...ICON} />
          <span className={styles.text} title={row.text}>
            {row.text}
          </span>
        </li>
      )}
    </ul>
  )
}
