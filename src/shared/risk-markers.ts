// Risk markers (PRD F13 v1.78, Figma 29A): facts read off a unified diff with rules, no model — tests deleted or
// skipped, checks silenced, CI config, dependencies, migrations. Shown at checkpoint 1 and used by the auto-fix brake.

export type RiskKind = 'test-deleted' | 'test-skipped' | 'check-silenced' | 'ci-config' | 'dependencies' | 'migration'

export interface RiskMarker {
  kind: RiskKind
  path: string
  /** How many hits in that file (deleted test cases, added skips, …); 1 for a file-level marker. */
  count: number
}

/** The markers of a unified diff (`git diff` output), one per kind and file. */
export function riskMarkers(diff: string): RiskMarker[] {
  void diff
  return []
}

/** One marker as its row reads, e.g. "改了 CI 配置 · .github/workflows/ci.yml". */
export function riskLabel(marker: RiskMarker): string {
  return `${marker.kind} · ${marker.path}`
}
