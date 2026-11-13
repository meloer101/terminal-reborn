import { describe, expect, it } from 'vitest'
import { isPanelTerminalId, nextPanelTerminalNumber, panelTerminalId, panelTerminalsOf, parsePanelTerminalId } from './panel-terminal'

describe('panel terminal ids', () => {
  it('round-trips the worktree and number, dashes in the worktree id included', () => {
    expect(panelTerminalId('w-1a2b3c4d', 3)).toBe('panel-w-1a2b3c4d-3')
    expect(parsePanelTerminalId('panel-w-1a2b3c4d-3')).toEqual({ worktreeId: 'w-1a2b3c4d', n: 3 })
    expect(parsePanelTerminalId(panelTerminalId('w1', 12))).toEqual({ worktreeId: 'w1', n: 12 })
  })

  it('passes the PTY id check main applies to every payload (SESSION_ID in src/main/pty/validate.ts)', () => {
    expect(panelTerminalId('w-1a2b3c4d', 1)).toMatch(/^[A-Za-z0-9._:-]{1,128}$/)
  })

  it('tells workspace session ids apart', () => {
    for (const id of ['s-1a2b3c4d', 'panel-', 'panel-w1', 'panel-w1-0', 'panel--1', 'panel-w1-01', 'xpanel-w1-1']) {
      expect(isPanelTerminalId(id), id).toBe(false)
    }
    expect(isPanelTerminalId('panel-w1-1')).toBe(true)
  })

  it("lists one worktree's shells by number", () => {
    const ids = ['panel-w-a-10', 's-1', 'panel-w-b-1', 'panel-w-a-2', 'panel-w-a-1']
    expect(panelTerminalsOf(ids, 'w-a')).toEqual(['panel-w-a-1', 'panel-w-a-2', 'panel-w-a-10'])
    expect(panelTerminalsOf(ids, 'w-c')).toEqual([])
  })

  it('numbers the next shell one past the highest of its worktree', () => {
    expect(nextPanelTerminalNumber([], 'w-a')).toBe(1)
    expect(nextPanelTerminalNumber(['panel-w-a-1', 'panel-w-a-4', 'panel-w-b-9'], 'w-a')).toBe(5)
    expect(nextPanelTerminalNumber(['panel-w-b-9'], 'w-a')).toBe(1)
  })
})
