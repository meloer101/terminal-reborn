import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OutputBatcher } from './batcher'
import { buildPtyEnv, resolveCwd, resolveShell } from './env'
import { FlowControl, HIGH_WATERMARK, LOW_WATERMARK } from './flow-control'

describe('OutputBatcher', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('coalesces small writes into one flush after the interval', () => {
    const emit = vi.fn()
    const batcher = new OutputBatcher(emit, 8, 1024)
    batcher.append('a')
    batcher.append('b')
    batcher.append('c')
    expect(emit).not.toHaveBeenCalled()
    vi.advanceTimersByTime(8)
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith('abc')
  })

  it('flushes immediately once the size limit is reached', () => {
    const emit = vi.fn()
    const batcher = new OutputBatcher(emit, 8, 10)
    batcher.append('12345')
    batcher.append('678901')
    expect(emit).toHaveBeenCalledWith('12345678901')
    vi.advanceTimersByTime(50)
    expect(emit).toHaveBeenCalledTimes(1)
  })

  it('flush() drains pending data and cancels the timer', () => {
    const emit = vi.fn()
    const batcher = new OutputBatcher(emit)
    batcher.append('x')
    batcher.flush()
    vi.advanceTimersByTime(50)
    expect(emit).toHaveBeenCalledTimes(1)
  })
})

describe('FlowControl', () => {
  it('pauses above the high watermark and resumes below the low one', () => {
    const flow = new FlowControl()
    expect(flow.onOutput(HIGH_WATERMARK)).toBe(false)
    expect(flow.onOutput(1)).toBe(true)
    expect(flow.onOutput(10)).toBe(false)
    expect(flow.onAck(100)).toBe(false)
    expect(flow.onAck(HIGH_WATERMARK)).toBe(true)
    expect(LOW_WATERMARK).toBeLessThan(HIGH_WATERMARK)
  })

  it('never goes negative', () => {
    const flow = new FlowControl()
    flow.onAck(500)
    expect(flow.onOutput(HIGH_WATERMARK)).toBe(false)
  })
})

describe('buildPtyEnv', () => {
  it('forces terminal identity and a UTF-8 locale', () => {
    const env = buildPtyEnv({ LANG: 'C', LC_ALL: 'C', TERM: 'dumb', PATH: '/usr/bin' })
    expect(env.TERM).toBe('xterm-256color')
    expect(env.COLORTERM).toBe('truecolor')
    expect(env.TERM_PROGRAM).toBe('TerminalReborn')
    expect(env.LANG).toBe('en_US.UTF-8')
    expect(env.LC_ALL).toBeUndefined()
    expect(env.PATH).toBe('/usr/bin')
  })

  it('keeps an existing UTF-8 locale and applies caller overrides', () => {
    const env = buildPtyEnv({ LANG: 'zh_CN.UTF-8' }, { FOO: 'bar' })
    expect(env.LANG).toBe('zh_CN.UTF-8')
    expect(env.FOO).toBe('bar')
  })

  it('strips app-internal variables', () => {
    const env = buildPtyEnv({ ELECTRON_RUN_AS_NODE: '1', CLAUDECODE: '1', HOME: '/h' })
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(env.CLAUDECODE).toBeUndefined()
    expect(env.HOME).toBe('/h')
  })
})

describe('resolveCwd', () => {
  const isDir = (path: string) => path === '/real/dir' || path === '/home/me/code'

  it('uses an existing absolute directory', () => {
    expect(resolveCwd('/real/dir', '/home/me', isDir)).toBe('/real/dir')
  })
  it('expands ~', () => {
    expect(resolveCwd('~/code', '/home/me', isDir)).toBe('/home/me/code')
  })
  it('falls back to home for missing or relative paths', () => {
    expect(resolveCwd('~/code/acme-web', '/home/me', isDir)).toBe('/home/me')
    expect(resolveCwd('relative', '/home/me', isDir)).toBe('/home/me')
  })
})

describe('resolveShell', () => {
  it('runs the login shell, defaulting to zsh', () => {
    expect(resolveShell({ SHELL: '/bin/bash' })).toEqual({ command: '/bin/bash', args: ['-l'] })
    expect(resolveShell({})).toEqual({ command: '/bin/zsh', args: ['-l'] })
  })
})
