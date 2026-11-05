import { describe, expect, it } from 'vitest'
import { CLI_AGENTS } from './agents'
import { AGENT_GUI, guiAvailability, guiBinary, guiProtocolOf } from './gui-agents'

describe('gui agents', () => {
  it('drives 17 of the 19 agents: Claude and Codex natively, the rest over ACP', () => {
    const drivable = CLI_AGENTS.filter((a) => AGENT_GUI[a] !== null)
    expect(drivable).toHaveLength(17)
    expect(guiProtocolOf('claude')).toBe('claude-stream')
    expect(guiProtocolOf('codex')).toBe('codex-app-server')
    expect(drivable.filter((a) => guiProtocolOf(a) === 'acp')).toHaveLength(15)
    expect(guiProtocolOf('crush')).toBeNull()
  })

  it('runs the adapter for Pi and Amp, the agent’s own binary otherwise', () => {
    expect(guiBinary('pi', 'pi')).toBe('pi-acp')
    expect(guiBinary('grok', 'grok')).toBe('grok')
  })

  it('says whether 界面 can offer GUI (Figma 49″B)', () => {
    expect(guiAvailability('grok', () => false)).toEqual({ kind: 'available' })
    expect(guiAvailability('pi', () => false)).toEqual({ kind: 'needs-adapter', binary: 'pi-acp', install: 'npm install -g pi-acp' })
    expect(guiAvailability('pi', (b) => b === 'pi-acp')).toEqual({ kind: 'available' })
    expect(guiAvailability('crush', () => true)).toMatchObject({ kind: 'cli-only' })
  })
})
