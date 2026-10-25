import { describe, expect, it } from 'vitest'
import { agentName, AGENT_SPECS, claudeOrCodex, CLI_AGENTS, isCliAgent } from './agents'

describe('agent registry', () => {
  it('has one row per CLI, keyed by its own id', () => {
    for (const id of CLI_AGENTS) expect(AGENT_SPECS[id].id).toBe(id)
    expect(Object.keys(AGENT_SPECS).sort()).toEqual([...CLI_AGENTS].sort())
  })

  it('uses binaries that are plain command names (they go unquoted into `command -v`)', () => {
    for (const id of CLI_AGENTS) expect(AGENT_SPECS[id].binary).toMatch(/^[a-z][a-z0-9-]*$/)
  })

  it('gives every CLI a distinct label and an install command', () => {
    const labels = CLI_AGENTS.map((id) => AGENT_SPECS[id].label)
    expect(new Set(labels).size).toBe(labels.length)
    for (const id of CLI_AGENTS) expect(AGENT_SPECS[id].install.length).toBeGreaterThan(0)
  })

  it('puts the session id in every resume-by-id argv', () => {
    for (const id of CLI_AGENTS) {
      const argv = AGENT_SPECS[id].resumeById
      if (argv) expect(argv.join(' ')).toContain('{id}')
    }
  })

  it('names sessions and narrows to Claude / Codex', () => {
    expect(agentName('shell')).toBe('终端')
    expect(agentName('qwen')).toBe('Qwen Code')
    expect(isCliAgent('opencode')).toBe(true)
    expect(isCliAgent('shell')).toBe(false)
    expect(claudeOrCodex('codex')).toBe('codex')
    expect(claudeOrCodex('gemini')).toBeNull()
  })
})
