import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Listener<T> = (value: T) => void

/** What the terminal drew and which listeners it holds on the surface. */
class FakeSurface {
  written: string[] = []
  inputs = new Set<Listener<string>>()
  onLink(): void {}
  setPathResolver(): void {}
  onContextMenu(): void {}
  mount(): void {}
  async whenOpen(): Promise<void> {}
  async reattach(): Promise<void> {}
  async restore(): Promise<void> {}
  fit(): { cols: number; rows: number } {
    return { cols: 80, rows: 24 }
  }
  write(data: string, done?: () => void): void {
    this.written.push(data)
    done?.()
  }
  onInput(listener: Listener<string>): { dispose: () => void } {
    this.inputs.add(listener)
    return { dispose: () => this.inputs.delete(listener) }
  }
  onResize(): { dispose: () => void } {
    return { dispose: () => {} }
  }
  onOsc(): { dispose: () => void } {
    return { dispose: () => {} }
  }
  snapshot(): null {
    return null
  }
  dispose(): void {}
}

let reattach = true
vi.mock('./xterm-surface', () => ({ XtermSurface: FakeSurface }))
vi.mock('./live-sessions', () => ({ loadLiveSessions: async () => {}, takeReattach: () => reattach }))
vi.mock('../state/link-actions', () => ({ handleTerminalLink: () => {}, resolveSessionPaths: () => [] }))
vi.mock('../lifecycle/launch-issues', () => ({ emitAgentMarker: () => {}, issueFromSpawnError: () => ({ kind: 'other' }), reportLaunchIssue: () => {} }))
vi.mock('../scripts/run-script', () => ({ takeRunStart: () => false }))
vi.mock('../scripts/setup-runs', () => ({ forgetSetup: () => {}, handleScriptMarker: () => {}, takeSetup: () => false }))
vi.mock('../attempts/terminal-menu', () => ({ openTerminalMenu: async () => {} }))
vi.mock('../dispatch/store', () => ({ takeDispatchLaunch: () => undefined }))
vi.mock('../state/workspace', () => ({ useWorkspace: { getState: () => ({ sessions: [] }) } }))
vi.mock('./typing', () => ({ noteInput: () => {} }))

const { SessionTerminal } = await import('./session-terminal')

let dataListeners: Array<(data: string, seq: number) => void> = []
let attachResult: { screen: unknown; seq: number; exit?: { exitCode: number } } = { screen: {}, seq: 0 }
const spawn = vi.fn(async () => {})

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0))
}

beforeEach(() => {
  dataListeners = []
  spawn.mockClear()
  reattach = true
  vi.stubGlobal('requestIdleCallback', () => 0)
  vi.stubGlobal('window', {
    tr: {
      pty: {
        onData: (_id: string, listener: (data: string, seq: number) => void) => {
          dataListeners.push(listener)
          return () => (dataListeners = dataListeners.filter((l) => l !== listener))
        },
        onExit: () => () => {},
        attach: async () => attachResult,
        spawn,
        write: () => {},
        resize: () => {},
        setVisible: () => {},
        ack: () => {},
        kill: () => {}
      },
      terminalSnapshots: { load: async () => null, save: async () => {} }
    }
  })
})
afterEach(() => vi.unstubAllGlobals())

const emit = (data: string, seq: number): void => dataListeners.forEach((l) => l(data, seq))

async function reattached(): Promise<{ terminal: InstanceType<typeof SessionTerminal>; surface: FakeSurface }> {
  const terminal = new SessionTerminal('s1', '/repo', 'claude')
  terminal.attach({} as HTMLElement)
  await flush()
  return { terminal, surface: terminal.surface as unknown as FakeSurface }
}

describe('SessionTerminal restart after a reattach', () => {
  it('shows the new process’s output, whose stream position starts again at 0', async () => {
    attachResult = { screen: {}, seq: 5000 }
    const { terminal, surface } = await reattached()
    expect(await terminal.restart()).toBe(true)
    expect(spawn).toHaveBeenCalledTimes(1)
    emit('$ fresh prompt', 14)
    expect(surface.written).toContain('$ fresh prompt')
    expect(surface.inputs.size).toBe(1)
    terminal.dispose()
  })

  it('listens for input once the process that had exited is started again', async () => {
    attachResult = { screen: {}, seq: 10, exit: { exitCode: 0 } }
    const { terminal, surface } = await reattached()
    expect(surface.inputs.size).toBe(0)
    expect(await terminal.restart()).toBe(true)
    expect(surface.inputs.size).toBe(1)
    emit('ready', 5)
    expect(surface.written).toContain('ready')
    terminal.dispose()
  })
})
