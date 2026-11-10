// What Wavi does with a CLI beyond running it is answered in agents.ts (usageVendor, headlessAgent, claudeOrCodex,
// hasHooks), not by naming Claude Code and Codex at each place that asks: a CLI that gains a capability is then one
// list to edit. This holds the line.
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AGENT_SPECS, CLI_AGENTS, HOOK_AGENTS, hasHooks } from '@shared/agents'

const SRC = join(__dirname, '..')

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sources(path)
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : []
  })
}

/** `x === 'claude' || x === 'codex'`, `x !== 'codex' && x !== 'claude'` and the like, on one line. */
const MEMBERSHIP = /(['"])(claude|codex)\1[^\n]*?(\|\||&&)[^\n]*?(['"])(?!\2)(claude|codex)\4/

export function membershipChecks(source: string): number {
  return source.split('\n').filter((line) => MEMBERSHIP.test(line)).length
}

describe('agent capabilities', () => {
  it('finds a membership check, and not a single agent or a ternary between the two', () => {
    expect(membershipChecks("if (kind === 'claude' || kind === 'codex') go()")).toBe(1)
    expect(membershipChecks("if (a !== 'codex' && a !== 'claude') return")).toBe(1)
    expect(membershipChecks("const x = kind === 'claude' ? 1 : 2")).toBe(0)
    expect(membershipChecks("const name = kind === 'codex' ? 'Codex' : 'Claude'")).toBe(0)
  })

  it('no file outside agents.ts asks whether an agent is Claude Code or Codex', () => {
    const offenders = sources(SRC)
      .filter((path) => !path.endsWith(join('shared', 'agents.ts')))
      .filter((path) => membershipChecks(readFileSync(path, 'utf8')) > 0)
      .map((path) => relative(SRC, path))
    expect(offenders, 'ask usageVendor / headlessAgent / claudeOrCodex / hasHooks in src/shared/agents.ts').toEqual([])
  })

  it('HOOK_AGENTS is exactly the CLIs whose status is hooks', () => {
    expect(CLI_AGENTS.filter((id) => AGENT_SPECS[id].status === 'hooks')).toEqual([...HOOK_AGENTS])
    expect(hasHooks('gemini')).toBe(true)
    expect(hasHooks('cursor')).toBe(false)
  })
})
