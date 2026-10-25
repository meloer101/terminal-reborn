// What 设置 · 智能体 says about each installed CLI (Figma 25B). Pure.
import { AGENT_SPECS, type CliAgent } from '@shared/agents'

/** `1.2.3` → [1, 2, 3]; anything after the numbers is ignored. Null when it does not start with a number. */
export function versionParts(version: string): number[] | null {
  const match = /^(\d+(?:\.\d+)*)/.exec(version)
  return match ? match[1]!.split('.').map(Number) : null
}

/** a < b for dotted versions (missing parts count as 0). */
export function versionBelow(a: string, b: string): boolean {
  const x = versionParts(a)
  const y = versionParts(b)
  if (!x || !y) return false
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d !== 0) return d < 0
  }
  return false
}

/** Too old for the precise path: it then runs with title-only status. */
export function belowStatusVersion(id: CliAgent, version: string | null): boolean {
  const min = AGENT_SPECS[id].minStatusVersion
  return min !== undefined && version !== null && versionBelow(version, min)
}

/** 准确 when Wavi knows turns and dialogs (hooks or OSC 7501), 估计 when only titles tell. */
export function statusAccuracy(id: CliAgent, version: string | null): '准确' | '估计' {
  return AGENT_SPECS[id].status !== 'title' && !belowStatusVersion(id, version) ? '准确' : '估计'
}

/** The second line of a row, when there is something to do about it. */
export function agentStatusNote(id: CliAgent, version: string | null): string | null {
  const min = AGENT_SPECS[id].minStatusVersion
  return min && belowStatusVersion(id, version) ? `升级到 ${min} 以上才有准确状态` : null
}
