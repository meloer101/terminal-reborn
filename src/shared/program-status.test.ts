import { describe, expect, it } from 'vitest'
import { parseProgramStatus, ProgramStatusScanner } from './program-status'
import { initialState, reduce } from './session-state-machine'

const b64 = (text: string): string => btoa(String.fromCharCode(...new TextEncoder().encode(text)))

describe('parseProgramStatus (OSC 7501 rev 0.4)', () => {
  it('reads the root record: state, kind, app and a base64 message', () => {
    expect(parseProgramStatus(`state=blocked:app=pi:kind=permission:msg=${b64('Bash: npm test')}`)).toEqual({
      state: 'blocked',
      kind: 'permission',
      app: 'pi',
      message: 'Bash: npm test'
    })
    expect(parseProgramStatus(`state=working:msg=${b64('改 session.ts')}`)).toEqual({ state: 'working', message: '改 session.ts' })
  })

  it('ignores child records, queries, unknown states; the last of a repeated key wins', () => {
    expect(parseProgramStatus('state=working:id=a1b2')).toBeNull()
    expect(parseProgramStatus('?')).toBeNull()
    expect(parseProgramStatus('state=sleeping')).toBeNull()
    expect(parseProgramStatus(' state = idle : state = done ')).toEqual({ state: 'done' })
    expect(parseProgramStatus('state=blocked:kind=coffee')).toEqual({ state: 'blocked' })
  })

  it('drops a message carrying control characters (spec), and anything too long', () => {
    expect(parseProgramStatus(`state=done:msg=${b64('a\nb')}`)).toEqual({ state: 'done' })
    expect(parseProgramStatus(`state=done:msg=${'A'.repeat(5000)}`)).toBeNull()
  })
})

describe('ProgramStatusScanner', () => {
  it('finds queries and reports with either terminator, across chunk boundaries', () => {
    const scanner = new ProgramStatusScanner()
    expect(scanner.feed('hello\x1b]7501;?\x07\x1b[c')).toEqual([{ type: 'query' }])
    expect(scanner.feed('text \x1b]75')).toEqual([])
    expect(scanner.feed('01;state=wor')).toEqual([])
    expect(scanner.feed('king:app=pi\x1b\\more')).toEqual([{ type: 'report', status: { state: 'working', app: 'pi' } }])
    expect(scanner.feed('\x1b]0;title\x07 \x1b]7501;state=done\x07\x1b]7501;state=working:id=t1\x07')).toEqual([
      { type: 'report', status: { state: 'done' } }
    ])
  })
})

describe('session state from OSC 7501', () => {
  const T0 = 1_000_000
  const up = initialState('opencode', T0, { phase: 'ready' })
  const report = (state: 'working' | 'blocked' | 'done' | 'idle' | 'error', extra: Record<string, unknown> = {}) =>
    ({ type: 'program-status', status: { state, ...extra } }) as const

  it('runs, waits on the user, and finishes unread', () => {
    const running = reduce(up, report('working'), T0 + 1)
    expect(running.status).toBe('running')
    const waiting = reduce(running, report('blocked', { kind: 'question' }), T0 + 2)
    expect(waiting).toMatchObject({ status: 'needs_you', currentAction: '等你回答' })
    const done = reduce(reduce(waiting, report('working'), T0 + 3), report('done'), T0 + 4)
    expect(done.status).toBe('done_unread')
  })

  it('marks a starting CLI ready, and then its title no longer second-guesses it', () => {
    const starting = initialState('grok', T0, { phase: 'starting' })
    const ready = reduce(starting, report('idle'), T0 + 1)
    expect(ready.phase).toBe('ready')
    const titled = reduce(ready, { type: 'title', title: '⠋ thinking' }, T0 + 10_000)
    expect(titled.status).toBe('idle')
  })

  it('without OSC 7501 a spinner title is an estimated turn', () => {
    const running = reduce(up, { type: 'title', title: '⠋ Copilot' }, T0 + 10_000)
    expect(running.status).toBe('running')
    expect(reduce(running, { type: 'title', title: 'Copilot' }, T0 + 12_000).status).toBe('done_unread')
  })
})
