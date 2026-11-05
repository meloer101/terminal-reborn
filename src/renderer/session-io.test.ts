import { beforeEach, describe, expect, it, vi } from 'vitest'

// The seam to the terminal: what is on the session's screen, and the writes that reach its PTY.
const term = vi.hoisted(() => ({ viewport: '', writes: [] as string[] }))

vi.mock('./terminal/registry', () => ({
  readViewport: () => term.viewport,
  acceptsBracketedPaste: () => true,
  getSendIo: () => ({ write: (data: string) => void term.writes.push(data), readScreen: () => term.viewport })
}))
vi.mock('./terminal/attachments', () => ({ attachmentInput: () => '' }))
vi.mock('./session-meta/store', () => ({ useSessionMeta: { getState: () => ({ bySession: {} }) } }))
vi.mock('./state/workspace', () => ({
  useWorkspace: {
    getState: () => ({ sessions: [{ id: 's-1', kind: 'claude' }, { id: 's-sh', kind: 'shell' }, { id: 's-gui', kind: 'grok', ui: 'gui' }] }),
    subscribe: () => () => {}
  }
}))

// A GUI session's seam (PRD F23): main's `window.tr.gui`, faked.
const gui = vi.hoisted(() => ({
  calls: [] as unknown[][],
  sendResult: { ok: true, queued: false } as { ok: true; queued: boolean } | { ok: false; reason: string }
}))
vi.stubGlobal('window', {
  tr: {
    gui: {
      send: async (...args: unknown[]) => (gui.calls.push(['send', ...args]), gui.sendResult),
      interrupt: async (...args: unknown[]) => (gui.calls.push(['interrupt', ...args]), true)
    }
  }
})

const { insertIntoTerminal, insertPaths, insertSlashCommand, interruptAgent, submitInputLine, submitPrompt } = await import('./session-io')
const { useGuiSessions, draftOf } = await import('./gui/store')

// Claude Code 2.1.304's /rate-limit-options (PRD §6.6), as in send-protocol.test.ts.
const LIMIT_MENU = [
  ' What do you want to do?',
  ' ❯ 1. Wait here, then continue automatically at 5:22pm',
  '   2. Stop and wait for limit to reset',
  '',
  ' Enter to confirm · Esc to cancel'
].join('\n')
const MENU_REFUSAL = '终端里有选择框，请先在终端中处理'

beforeEach(() => {
  term.viewport = '❯ '
  term.writes = []
  gui.calls = []
  gui.sendResult = { ok: true, queued: false }
  useGuiSessions.setState({ states: {}, drafts: {}, attachments: {}, focus: {} })
})

describe('insertSlashCommand', () => {
  it('puts /compact into the input line of an agent that is waiting at it, without Enter', async () => {
    await insertSlashCommand('s-1', '/compact')
    const typed = term.writes.join('')
    expect(typed).toContain('/')
    expect(typed).toContain('compact')
    expect(typed).not.toContain('\r')
  })

  it('rejects with the refusal, and writes nothing, while a menu is open over the input line', async () => {
    term.viewport = LIMIT_MENU
    await expect(insertSlashCommand('s-1', '/compact')).rejects.toThrow(MENU_REFUSAL)
    expect(term.writes).toEqual([])
  })

  it('does nothing in a plain terminal', async () => {
    term.viewport = LIMIT_MENU
    await insertSlashCommand('s-sh', '/compact')
    expect(term.writes).toEqual([])
  })
})

describe('insertIntoTerminal', () => {
  it('rejects with the same refusal over a menu, and writes nothing', async () => {
    term.viewport = LIMIT_MENU
    await expect(insertIntoTerminal('s-1', '@src/app.ts ')).rejects.toThrow(MENU_REFUSAL)
    expect(term.writes).toEqual([])
  })

  it('types at a plain input line', async () => {
    await insertIntoTerminal('s-1', '@src/app.ts ')
    expect(term.writes.join('')).toContain('@src/app.ts')
  })
})

describe('GUI sessions (PRD F23)', () => {
  it('sends a prompt through main, never the terminal, even with a menu-like screen', async () => {
    term.viewport = LIMIT_MENU
    await submitPrompt('s-gui', '  跑一下测试  ')
    expect(gui.calls).toEqual([['send', 's-gui', { text: '跑一下测试', attachments: [] }]])
    expect(term.writes).toEqual([])
  })

  it('rejects with main’s reason when the message cannot go', async () => {
    gui.sendResult = { ok: false, reason: 'agent 已经退出' }
    await expect(submitPrompt('s-gui', 'x')).rejects.toThrow('agent 已经退出')
  })

  it('inserts text and slash commands into the composer draft, after what is typed', async () => {
    useGuiSessions.setState({ drafts: { 's-gui': '看看' } })
    await insertIntoTerminal('s-gui', '@src/app.ts')
    await insertSlashCommand('s-gui', '/compact')
    expect(draftOf('s-gui')).toBe('看看 @src/app.ts /compact ')
    expect(gui.calls).toEqual([])
    expect(term.writes).toEqual([])
  })

  it('turns files into attachments, and sends them with the draft for a photo without text', async () => {
    await insertPaths('s-gui', ['/tmp/a.png', '/tmp/b.png', '/tmp/a.png'])
    expect(useGuiSessions.getState().attachments['s-gui']).toEqual(['/tmp/a.png', '/tmp/b.png'])
    await submitInputLine('s-gui', '[Image #')
    expect(gui.calls).toEqual([['send', 's-gui', { text: '', attachments: ['/tmp/a.png', '/tmp/b.png'] }]])
    expect(useGuiSessions.getState().attachments['s-gui']).toEqual([])
  })

  it('stops a turn with an interrupt, not an Esc keystroke', async () => {
    await interruptAgent('s-gui')
    expect(gui.calls).toEqual([['interrupt', 's-gui']])
    expect(term.writes).toEqual([])
  })
})
