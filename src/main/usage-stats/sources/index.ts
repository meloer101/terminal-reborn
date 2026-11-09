// The agents whose logs 设置 · 额度 reads (STATS_AGENTS in src/shared/usage-stats.ts), and where those logs live.
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { claudeSource } from './claude'
import { codexSource } from './codex'
import { grokSource } from './grok'
import { opencodeSource } from './opencode'
import { piSource } from './pi'
import type { StatsDirs, UsageSource } from './source'

export const SOURCES: readonly UsageSource[] = [claudeSource, codexSource, opencodeSource, piSource, grokSource]

export function defaultStatsDirs(env: NodeJS.ProcessEnv = process.env, home = homedir()): StatsDirs {
  const abs = (v: string | undefined): string | null => (v && isAbsolute(v) ? v : null)
  const claude = new Set([join(home, '.claude', 'projects')])
  const claudeConfig = abs(env.CLAUDE_CONFIG_DIR)
  if (claudeConfig) claude.add(join(claudeConfig, 'projects'))
  return {
    home,
    claudeProjects: [...claude],
    codexHome: abs(env.CODEX_HOME) ?? join(home, '.codex'),
    opencodeData: join(abs(env.XDG_DATA_HOME) ?? join(home, '.local', 'share'), 'opencode'),
    piSessions: join(home, '.pi', 'agent', 'sessions'),
    grokSessions: join(home, '.grok', 'sessions')
  }
}

export type { StatsDirs, UsageSource } from './source'
