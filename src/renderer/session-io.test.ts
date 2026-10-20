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
  useWorkspace: { getState: () => ({ sessions: [{ id: 's-1', kind: 'claude' }, { id: 's-sh', kind: 'shell' }] }), subscribe: () => () => {} }
}))

const { insertIntoTerminal, insertSlashCommand } = await import('./session-io')

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
