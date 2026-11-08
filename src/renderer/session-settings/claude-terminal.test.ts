import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@shared/types'

// A Claude TUI that answers keys as 2.1.319 does (PRD §6.16): ⌥p model picker, /effort picker, shift+tab cycle.
const claude = vi.hoisted(() => {
  /** `data` is `key` pressed one or more times. */
  const repeats = (data: string, key: string) => data.length > 0 && data.split(key).every((part) => part === '')
  const MODELS = ['default', 'opus', 'fable', 'sonnet', 'haiku']
  const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
  const MODES = ['manual mode on', 'accept edits on', 'plan mode on', 'auto mode on']
  const t = {
    writes: [] as string[],
    picker: null as null | 'model' | 'effort' | 'switch',
    typed: '',
    cursor: 0,
    model: 'opus',
    effort: 1,
    mode: 0,
    /** A conversation exists: switching the model asks again. */
    asks: true,
    savedDefault: false,
    /** What Claude printed last ("… for this session only"). */
    note: '',
    screen(): string {
      if (t.picker === 'model') return ['  Select model', ...MODELS.map((m, i) => `  ${i === t.cursor ? '❯' : ' '} ${i + 1}. ${m[0]?.toUpperCase()}${m.slice(1)}   x`), '  Enter to set as default · s to use this session only'].join('\n')
      if (t.picker === 'effort') return ['   Effort', `${' '.repeat(29 + [0, 10, 20, 29, 40][t.effort]!)}▲`, '                             low     medium     high     xhigh      max', '   s for this session only'].join('\n')
      if (t.picker === 'switch') return 'Switch model?\n 1. Yes\n 2. No'
      return `${t.note}\n❯ ${t.typed}\n  SL\n  ${MODES[t.mode] === 'manual mode on' ? '⏸' : MODES[t.mode] === 'plan mode on' ? '⏸' : '⏵⏵'} ${MODES[t.mode]}`
    },
    write(data: string) {
      t.writes.push(data)
      if (data === '\x1bp') [t.picker, t.cursor] = ['model', MODELS.indexOf(t.model) < 0 ? 0 : 0]
      else if (data === '\x1b') t.picker = null
      else if (t.picker === 'model' && repeats(data, '\x1b[B')) t.cursor += data.length / 3
      else if (t.picker === 'model' && repeats(data, '\x1b[A')) t.cursor -= data.length / 3
      else if (t.picker === 'model' && data === 's') [t.model, t.picker, t.note] = [MODELS[t.cursor]!, t.asks ? 'switch' : null, t.asks ? '' : `Model set to ${MODELS[t.cursor]} for this session only`]
      else if (t.picker === 'model' && data === '\r') [t.savedDefault, t.picker] = [true, null]
      else if (t.picker === 'switch' && data === '1') [t.picker, t.note] = [null, `Model set to ${t.model} for this session only`]
      else if (t.picker === 'effort' && repeats(data, '\x1b[C')) t.effort += data.length / 3
      else if (t.picker === 'effort' && repeats(data, '\x1b[D')) t.effort -= data.length / 3
      else if (t.picker === 'effort' && data === 's') [t.picker, t.note] = [null, `Set effort level to ${EFFORTS[t.effort]} (this session only)`]
      else if (data === '\x1b[Z') t.mode = (t.mode + 1) % MODES.length
      else if (data === '\r' && t.typed === '/effort') [t.picker, t.typed] = ['effort', '']
      else t.typed += data
    }
  }
  return { t, EFFORTS }
})
const meta = vi.hoisted(() => ({ settings: [] as unknown[] }))

vi.mock('../terminal/registry', () => ({ readViewport: () => claude.t.screen(), getSendIo: () => ({ write: (d: string) => claude.t.write(d), readScreen: () => claude.t.screen() }) }))
vi.mock('../terminal/typing', () => ({ typingIn: () => ({ lastKeyAt: null, draft: false }) }))
vi.mock('../session-io', () => ({ exclusively: (_id: string, task: () => Promise<unknown>) => task() }))
vi.mock('../session-meta/store', () => ({ useSessionMeta: { getState: () => ({ setSettings: (_id: string, s: unknown) => meta.settings.push(s) }) } }))

const { setClaudeInTerminal, claudeBusy } = await import('./claude-terminal')
const idle: Session = { id: 's', worktreeId: 'w', kind: 'claude', title: 't', status: 'idle', phase: 'ready', startedAt: 0, lastActivityAt: 0 }

beforeEach(() => {
  Object.assign(claude.t, { writes: [], picker: null, typed: '', cursor: 0, model: 'opus', effort: 1, mode: 0, asks: true, savedDefault: false, note: '' })
  meta.settings = []
})

describe('Claude in a terminal', () => {
  it('picks a model for this session only, answering the second question', async () => {
    expect(await setClaudeInTerminal(idle, 'model', 'sonnet')).toEqual({ ok: true })
    expect(claude.t.model).toBe('sonnet')
    expect(claude.t.savedDefault).toBe(false)
    expect(claude.t.writes).toContain('s')
    expect(claude.t.writes).not.toContain('\r')
    expect(meta.settings).toEqual([{ model: 'sonnet' }])
  })

  it('sets the effort with the picker and s', async () => {
    expect(await setClaudeInTerminal(idle, 'effort', 'xhigh')).toEqual({ ok: true })
    expect(claude.EFFORTS[claude.t.effort]).toBe('xhigh')
    expect(claude.t.picker).toBeNull()
  })

  it('steps shift+tab until the footer shows the mode', async () => {
    expect(await setClaudeInTerminal(idle, 'permission', 'plan')).toEqual({ ok: true })
    expect(claude.t.writes.filter((w) => w === '\x1b[Z')).toHaveLength(2)
    expect(await setClaudeInTerminal(idle, 'permission', 'plan')).toEqual({ ok: true })
    expect(claude.t.writes.filter((w) => w === '\x1b[Z')).toHaveLength(2)
  })

  it('does nothing mid-turn, and backs out of a model Claude does not list', async () => {
    expect(claudeBusy({ ...idle, status: 'running' })).toBe('这一轮结束后可以改')
    expect(await setClaudeInTerminal({ ...idle, status: 'running' }, 'model', 'haiku')).toEqual({ ok: false, error: '这一轮结束后可以改' })
    expect(claude.t.writes).toEqual([])
    expect(await setClaudeInTerminal(idle, 'model', 'gpt')).toEqual({ ok: false, error: '没有这个模型' })
  })
})
