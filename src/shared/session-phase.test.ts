// Agent phase, session end and the screen-based heals of the status state machine (phase 2a · A3/A4/A6/A7).
import { describe, expect, it } from 'vitest'
import type { AgentEvent } from './agent-events'
import { initialState, NEEDS_YOU_HEAL_MS, reduce, STARTUP_TIMEOUT_MS, type SessionState, type Signal } from './session-state-machine'
import type { AgentKind, SessionStatus } from './types'

const T0 = 1_000_000

const ev = (event: AgentEvent): Signal => ({ type: 'event', event })
const toolStart = (tool: string, input: Record<string, unknown> = {}) => ev({ type: 'tool-start', tool, input })
const promptSubmit = ev({ type: 'prompt-submit', prompt: 'hi' })
const notification = (kind: 'permission' | 'question' | 'idle' | 'other') => ev({ type: 'notification', kind, message: 'm' })
const screen = (text: string): Signal => ({ type: 'screen', text })

function make(status: SessionStatus, options: { kind?: AgentKind; action?: string } = {}): SessionState {
  return initialState(options.kind ?? 'claude', T0, { status, currentAction: options.action })
}

// Phase 2a · A4: only the PTY exiting is final.
describe('session end', () => {
  it.each(['clear', 'resume'])('SessionEnd(%s) is not an exit: idle until the SessionStart that follows', (reason) => {
    let s = reduce(make('running', { action: '运行 ls' }), ev({ type: 'session-end', reason }), T0 + 1)
    expect(s).toMatchObject({ status: 'idle', ended: false })
    expect(s.currentAction).toBeUndefined()
    s = reduce(s, ev({ type: 'session-start' }), T0 + 2)
    expect(s.status).toBe('idle')
    s = reduce(s, promptSubmit, T0 + 3)
    expect(s.status).toBe('running')
  })

  it.each(['prompt_input_exit', 'logout', 'other', undefined])('SessionEnd(%s) exits, but is not final', (reason) => {
    let s = reduce(make('running'), ev({ type: 'session-end', ...(reason ? { reason } : {}) }), T0 + 1)
    expect(s).toMatchObject({ status: 'exited', ended: false })
    s = reduce(s, ev({ type: 'session-start' }), T0 + 2)
    expect(s.status).toBe('idle')
  })

  it('only the PTY exiting ends the session for good', () => {
    const s = reduce(make('running'), { type: 'pty-exit', code: 0 }, T0 + 1)
    expect(s.ended).toBe(true)
    expect(reduce(s, ev({ type: 'session-start' }), T0 + 2)).toBe(s)
  })
})

describe('claude title frames', () => {
  it('the quarter-circle spinner (Claude Code 2.1.x) is a busy title', () => {
    for (const frame of ['◐', '◑', '◒', '◓']) {
      expect(reduce(make('idle'), { type: 'title', title: `${frame} Claude Code` }, T0 + 10_000).status).toBe('running')
    }
  })
})

describe('agent phase', () => {
  const T = T0 + 100_000
  const start = (kind: AgentKind = 'claude'): SessionState => initialState(kind, T, { phase: 'starting' })
  const CLAUDE_UI = 'Claude Code v2.1.299\n❯ Try "how does <filepath> work?"\n  ⏸ manual mode on · ← for agents'
  const TRUST = 'Do you trust the files in this folder?\n❯ 1. Yes, I trust this folder\n  2. No, exit'

  it('shells and fixture sessions have no phase', () => {
    expect(initialState('shell', T, { phase: 'starting' }).phase).toBeUndefined()
    expect(make('idle').phase).toBeUndefined()
  })

  it('a new agent session starts in starting (idle status, nothing blocked)', () => {
    expect(start()).toMatchObject({ phase: 'starting', status: 'idle' })
  })

  it('a hook event means the agent is up', () => {
    expect(reduce(start(), ev({ type: 'session-start', agentSessionId: 'x' }), T + 1)).toMatchObject({ phase: 'ready', hooksSeen: true })
    expect(reduce(start('codex'), promptSubmit, T + 1)).toMatchObject({ phase: 'ready', status: 'running' })
  })

  it("claude's own title means its UI is up; a shell title does not", () => {
    expect(reduce(start(), { type: 'title', title: '✳ Claude Code' }, T + 1)).toMatchObject({ phase: 'ready', titleIdle: true })
    expect(reduce(start(), { type: 'title', title: '◐ Claude Code' }, T + 1).phase).toBe('ready')
    expect(reduce(start(), { type: 'title', title: 'user@host:~/code' }, T + 1).phase).toBe('starting')
    expect(reduce(start('codex'), { type: 'title', title: 'tr-codex-lab' }, T + 1).phase).toBe('starting')
  })

  it('the agent UI on screen means ready (codex has no SessionStart until the first prompt)', () => {
    expect(reduce(start(), screen(CLAUDE_UI), T + 1).phase).toBe('ready')
    expect(reduce(start('codex'), screen('>_ OpenAI Codex (v0.142.5)\n› Ask Codex to do anything'), T + 1).phase).toBe('ready')
  })

  it('a blank screen keeps starting, however long it takes', () => {
    expect(reduce(start(), screen('  \n'), T + 60_000).phase).toBe('starting')
  })

  it('the trust dialog blocks: status needs_you with the question, until it is answered', () => {
    let s = reduce(start(), screen(TRUST), T + 1_000)
    expect(s).toMatchObject({ phase: 'blocked', status: 'needs_you', currentAction: '等你确认：信任此文件夹' })
    expect(reduce(s, screen(TRUST), T + 2_000)).toBe(s)
    // Answered: the dialog is gone but the agent has not drawn its UI yet.
    s = reduce(s, screen('Loading…'), T + 3_000)
    expect(s).toMatchObject({ phase: 'starting', status: 'idle' })
    expect(s.currentAction).toBeUndefined()
    expect(reduce(s, screen(CLAUDE_UI), T + 4_000).phase).toBe('ready')
  })

  it('a SessionStart releases a blocked session', () => {
    const blocked = reduce(start(), screen(TRUST), T + 1_000)
    expect(reduce(blocked, ev({ type: 'session-start' }), T + 2_000)).toMatchObject({ phase: 'ready', status: 'idle' })
  })

  it('the codex update dialog and shell-startup questions block too', () => {
    const update = 'Update available! 0.142.5 -> 0.150\n› Update now\n  Skip until next version'
    expect(reduce(start('codex'), screen(update), T + 1).blocked).toEqual({ kind: 'dialog', dialog: 'codex-update' })
    const rc = reduce(start(), screen('[oh-my-zsh] Would you like to update? [Y/n]'), T + 1)
    expect(rc).toMatchObject({ phase: 'blocked', blocked: { kind: 'prompt' }, status: 'needs_you' })
  })

  it('unrecognised output after the startup timeout hands the terminal to the user (claude: hooks silent)', () => {
    expect(reduce(start(), screen('some banner'), T + STARTUP_TIMEOUT_MS - 1).phase).toBe('starting')
    expect(reduce(start(), screen('some banner'), T + STARTUP_TIMEOUT_MS)).toMatchObject({ phase: 'ready', hooksSilent: true })
    expect(reduce(start('codex'), screen('some banner'), T + STARTUP_TIMEOUT_MS)).toMatchObject({ phase: 'ready', hooksSilent: false })
  })

  it('claude that is up but never sends a hook is flagged as hooks-silent; a hook clears it', () => {
    let s = reduce(start(), screen(CLAUDE_UI), T + 1_000)
    expect(s.hooksSilent).toBe(false)
    s = reduce(s, screen(CLAUDE_UI), T + 1_000 + STARTUP_TIMEOUT_MS)
    expect(s.hooksSilent).toBe(true)
    expect(reduce(s, promptSubmit, T + 20_000).hooksSilent).toBe(false)
  })

  it('the hook watchdog can flag silence too, but only for a claude that is up and has not heard from its hooks', () => {
    const heard = reduce(start(), ev({ type: 'notification', kind: 'other', message: '' }), T + 1)
    expect(reduce(heard, { type: 'hooks-silent' }, T + 2).hooksSilent).toBe(false)
    const up = reduce(start(), screen(CLAUDE_UI), T + 1)
    expect(reduce(up, { type: 'hooks-silent' }, T + 2).hooksSilent).toBe(true)
  })

  it('the agent exiting (marker) leaves an exited phase while the PTY lives on', () => {
    const up = reduce(start(), ev({ type: 'session-start' }), T + 1)
    const s = reduce(up, { type: 'agent-marker', marker: { type: 'exit', code: 0 } }, T + 2)
    expect(s).toMatchObject({ phase: 'exited', status: 'exited', ended: false })
    // Stale hooks after the exit do nothing.
    expect(reduce(s, promptSubmit, T + 3)).toBe(s)
  })

  it('a crash while working, or while starting, is an error; an interrupted exit is not', () => {
    const working = reduce(reduce(start(), promptSubmit, T + 1), { type: 'agent-marker', marker: { type: 'exit', code: 1 } }, T + 2)
    expect(working).toMatchObject({ status: 'error', phase: 'exited', currentAction: '进程异常退出，退出码 1' })
    expect(reduce(start(), { type: 'agent-marker', marker: { type: 'exit', code: 127 } }, T + 2).status).toBe('error')
    const idle = reduce(start(), ev({ type: 'session-start' }), T + 1)
    expect(reduce(idle, { type: 'agent-marker', marker: { type: 'exit', code: 130 } }, T + 2).status).toBe('exited')
  })

  it('a missing CLI exits the phase', () => {
    expect(reduce(start(), { type: 'agent-marker', marker: { type: 'missing' } }, T + 1)).toMatchObject({ phase: 'exited', status: 'exited' })
  })

  it('a failed spawn exits the phase without ending the session', () => {
    expect(reduce(start(), { type: 'launch-failed' }, T + 1)).toMatchObject({ phase: 'exited', status: 'exited', ended: false })
  })

  it('PTY exit ends the session and the phase', () => {
    expect(reduce(start(), { type: 'pty-exit', code: 0 }, T + 1)).toMatchObject({ phase: 'exited', ended: true })
  })

  it('launch revives an exited or not-started session as starting', () => {
    const exited = reduce(reduce(start(), promptSubmit, T + 1), { type: 'pty-exit', code: 0 }, T + 2)
    expect(reduce(exited, { type: 'launch' }, T + 3)).toMatchObject({ phase: 'starting', status: 'idle', ended: false, hooksSeen: false })
    const notStarted = initialState('claude', T, { phase: 'not-started' })
    expect(reduce(notStarted, { type: 'launch' }, T + 1).phase).toBe('starting')
    // No phase, no change.
    const plain = make('running')
    expect(reduce(plain, { type: 'launch' }, T + 1)).toBe(plain)
  })

  it('a not-started session ignores events and titles', () => {
    const s = initialState('claude', T, { phase: 'not-started' })
    expect(reduce(s, promptSubmit, T + 1)).toBe(s)
    expect(reduce(s, { type: 'title', title: '✳ Claude Code' }, T + 1)).toBe(s)
  })
})

// Phase 2a · A7: the TUI answered a dialog without any hook saying so (verified against Claude Code 2.1.299:
// Esc at a permission dialog sends no hook, and the title stays idle `✳` the whole time).
describe('needs_you healing by screen', () => {
  const FOOTER = '❯ \n  ⏸ manual mode on · ← for agents'
  const DIALOG = ' Do you want to proceed?\n ❯ 1. Yes\n   4. No\n\n Esc to cancel · Tab to amend'
  const waitingForPermission = (): SessionState => {
    let s = reduce(make('idle'), { type: 'title', title: '✳ Writing hi to a.txt' }, T0 + 100)
    s = reduce(s, toolStart('Bash', { command: 'echo hi > a.txt' }), T0 + 200)
    return reduce(s, notification('permission'), T0 + 300)
  }

  it('stays needs_you while the dialog is on screen', () => {
    let s = waitingForPermission()
    for (let t = 1; t <= 10; t++) s = reduce(s, screen(DIALOG), T0 + t * 1_000)
    expect(s.status).toBe('needs_you')
  })

  it('goes back to idle once the input footer has been back for a moment', () => {
    let s = waitingForPermission()
    s = reduce(s, screen(FOOTER), T0 + 10_000)
    expect(s.status).toBe('needs_you')
    s = reduce(s, screen(FOOTER), T0 + 10_000 + NEEDS_YOU_HEAL_MS)
    expect(s.status).toBe('idle')
    expect(s.currentAction).toBeUndefined()
  })

  it('a flicker of the footer does not count', () => {
    let s = waitingForPermission()
    s = reduce(s, screen(FOOTER), T0 + 10_000)
    s = reduce(s, screen(DIALOG), T0 + 11_000)
    s = reduce(s, screen(FOOTER), T0 + 12_000)
    s = reduce(s, screen(FOOTER), T0 + 12_000 + NEEDS_YOU_HEAL_MS - 1)
    expect(s.status).toBe('needs_you')
  })

  it('never heals codex or a busy title', () => {
    const codex = reduce(make('idle', { kind: 'codex' }), notification('permission'), T0 + 1)
    expect(reduce(reduce(codex, screen(FOOTER), T0 + 10_000), screen(FOOTER), T0 + 20_000).status).toBe('needs_you')
    let busy = reduce(make('idle'), { type: 'title', title: '◐ Claude Code' }, T0 + 10_000)
    busy = reduce(busy, notification('permission'), T0 + 10_100)
    expect(reduce(reduce(busy, screen(FOOTER), T0 + 20_000), screen(FOOTER), T0 + 30_000).status).toBe('needs_you')
  })
})
