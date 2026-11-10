// What every agent's usage source provides (PRD F11 · 额度页). Adding an agent = one file here + one line in index.ts.
import type { StatsAgent } from '@shared/usage-stats'
import type { Accumulator } from '../accumulate'

export interface StatsDirs {
  home: string
  /** `projects` under ~/.claude and $CLAUDE_CONFIG_DIR. */
  claudeProjects: string[]
  /** $CODEX_HOME or ~/.codex. */
  codexHome: string
  /** ~/.local/share/opencode (or $XDG_DATA_HOME/opencode). */
  opencodeData: string
  piSessions: string
  grokSessions: string
}

export interface UsageSource {
  agent: StatsAgent
  /** The files to read, each with what tells a changed file from an unchanged one. */
  list(dirs: StatsDirs): Promise<{ path: string; signature: string }[]>
  read(path: string, acc: Accumulator): Promise<void>
}
