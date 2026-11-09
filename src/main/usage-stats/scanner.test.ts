import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { tokensOf } from '@shared/usage-stats'
import { UsageScanner } from './scanner'
import { SOURCES, type StatsDirs } from './sources'

let home: string
let dirs: StatsDirs

const jsonl = (rows: unknown[]): string => rows.map((r) => JSON.stringify(r)).join('\n') + '\n'
const T = '2026-11-09T02:15:00.000Z'

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'wavi-usage-'))
  dirs = {
    home,
    claudeProjects: [join(home, '.claude', 'projects')],
    codexHome: join(home, '.codex'),
    opencodeData: join(home, '.local', 'share', 'opencode'),
    piSessions: join(home, '.pi', 'agent', 'sessions'),
    grokSessions: join(home, '.grok', 'sessions')
  }
})
afterEach(() => rm(home, { recursive: true, force: true }))

const claudeLine = (id: string, output: number, extra: Record<string, unknown> = {}) => ({
  type: 'assistant',
  timestamp: T,
  sessionId: 's1',
  cwd: `${home}/code/wavi/.claude/worktrees/x`,
  requestId: 'r',
  message: { id, model: 'claude-opus-5-5', usage: { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: output } },
  ...extra
})

describe('UsageScanner', () => {
  it('counts a Claude message once, adds output growth, and joins a subagent file to its conversation', async () => {
    const dir = join(dirs.claudeProjects[0]!, '-code-wavi')
    await mkdir(join(dir, 's1', 'subagents'), { recursive: true })
    await writeFile(join(dir, 's1.jsonl'), jsonl([claudeLine('m1', 5), claudeLine('m1', 5), claudeLine('m1', 9), { type: 'user', message: { content: 'hi' } }]) + '{"usage": broken\n')
    await writeFile(join(dir, 's1', 'subagents', 'agent-a.jsonl'), jsonl([claudeLine('m2', 1, { isSidechain: true })]))
    const data = await new UsageScanner(dirs).scan()
    const claude = data.buckets.filter((b) => b.agent === 'claude')
    expect(claude.reduce((s, b) => s + b.output, 0)).toBe(10)
    expect(claude.reduce((s, b) => s + b.cacheRead, 0)).toBe(2000)
    expect(claude[0]!.project).toBe('wavi')
    expect(claude[0]!.cost).toBeGreaterThan(0)
    expect(data.sessions).toHaveLength(1)
    expect(data.skipped).toBe(1)
    expect(data.firstAt.claude).toBe(Date.parse(T))
  })

  it('counts each Codex response once from last_token_usage, cached input apart', async () => {
    const dir = join(dirs.codexHome, 'sessions', '2026', '11', '09')
    await mkdir(dir, { recursive: true })
    const tc = (total: number, input: number, cached: number, output: number) => ({
      type: 'event_msg',
      timestamp: T,
      payload: { type: 'token_count', info: { total_token_usage: { total_tokens: total }, last_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output, total_tokens: input + output } } }
    })
    await writeFile(
      join(dir, 'rollout-2026-11-09-a.jsonl'),
      jsonl([
        { type: 'session_meta', timestamp: T, payload: { id: 'c1', cwd: `${home}/code/api` } },
        { type: 'turn_context', timestamp: T, payload: { model: 'gpt-6-sol' } },
        tc(110, 100, 60, 10),
        tc(110, 100, 60, 10),
        tc(330, 200, 150, 20)
      ])
    )
    const data = await new UsageScanner(dirs).scan()
    const [b] = data.buckets
    expect(b).toMatchObject({ agent: 'codex', model: 'gpt-6-sol', project: 'api', input: 90, cacheRead: 210, output: 30 })
    expect(tokensOf(b!)).toBe(330)
  })

  it('reads Pi, Grok (one count per turn, ticks as USD) and OpenCode', async () => {
    const pi = join(dirs.piSessions, '--code-pi--')
    await mkdir(pi, { recursive: true })
    await writeFile(
      join(pi, 'a.jsonl'),
      jsonl([
        { type: 'session', id: 'p1', timestamp: T, cwd: `${home}/code/pi` },
        { type: 'message', timestamp: T, message: { model: 'deepseek-v4-pro', usage: { input: 10, output: 2, cacheRead: 30, cacheWrite: 0, cost: { total: 0.5 } } } }
      ])
    )
    const grok = join(dirs.grokSessions, encodeURIComponent(`${home}/code/grok`), 'g1')
    await mkdir(grok, { recursive: true })
    const turn = (input: number) => ({
      timestamp: 1794257204,
      method: '_x.ai/session/update',
      _meta: { eventId: 'e1' },
      params: { update: { sessionUpdate: 'turn_completed', usage: { inputTokens: input, outputTokens: 5, cachedReadTokens: 40, costUsdTicks: 1e10, modelUsage: { 'grok-4.7': { inputTokens: input, outputTokens: 5, cachedReadTokens: 40 } } } } }
    })
    await writeFile(join(grok, 'updates.jsonl'), jsonl([turn(80), turn(100)]))
    await mkdir(dirs.opencodeData, { recursive: true })
    const db = new DatabaseSync(join(dirs.opencodeData, 'opencode.db'))
    db.exec('CREATE TABLE session (id TEXT, directory TEXT); CREATE TABLE message (id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT)')
    db.prepare('INSERT INTO session VALUES (?, ?)').run('o1', `${home}/code/oc`)
    const msg = { role: 'assistant', modelID: 'deepseek-v4-pro', tokens: { input: 7, output: 3, reasoning: 2, cache: { read: 8, write: 0 } }, time: { created: Date.parse(T) } }
    db.prepare('INSERT INTO message VALUES (?, ?, 0, 0, ?)').run('m1', 'o1', JSON.stringify(msg))
    db.prepare('INSERT INTO message VALUES (?, ?, 0, 0, ?)').run('m2', 'o1', JSON.stringify({ role: 'user' }))
    db.close()

    const data = await new UsageScanner(dirs).scan()
    const by = (agent: string) => data.buckets.filter((b) => b.agent === agent)
    expect(by('pi')[0]).toMatchObject({ project: 'pi', input: 10, cacheRead: 30, cost: 0.5 })
    expect(by('grok')).toHaveLength(1)
    expect(by('grok')[0]).toMatchObject({ project: 'grok', model: 'grok-4.7', input: 60, cacheRead: 40, output: 5, cost: 1 })
    expect(by('opencode')[0]).toMatchObject({ project: 'oc', input: 7, output: 5, cacheRead: 8 })
    expect(Object.keys(data.firstAt).sort()).toEqual(['grok', 'opencode', 'pi'])
  })

  it('counts a message repeated in a resumed conversation’s file once, and splits a conversation idle over half an hour', async () => {
    const dir = join(dirs.claudeProjects[0]!, 'p')
    await mkdir(dir, { recursive: true })
    const later = new Date(Date.parse(T) + 3 * 60 * 60_000).toISOString()
    await writeFile(join(dir, 'old.jsonl'), jsonl([claudeLine('m1', 5)]))
    await writeFile(join(dir, 'resumed.jsonl'), jsonl([claudeLine('m1', 5), claudeLine('m2', 7, { timestamp: later })]))
    const data = await new UsageScanner(dirs).scan()
    expect(data.buckets.reduce((s, b) => s + b.output, 0)).toBe(12)
    expect(data.sessions.map((s) => s.id)).toEqual(['s1', 's1'])
    expect(data.sessions[1]!.start).toBe(Date.parse(later))
  })

  it('rereads only changed files and forgets deleted ones', async () => {
    const dir = join(dirs.claudeProjects[0]!, 'p')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'a.jsonl'), jsonl([claudeLine('m1', 1)]))
    await writeFile(join(dir, 'b.jsonl'), jsonl([claudeLine('m2', 1, { sessionId: 's2' })]))
    let reads = 0
    const counting = SOURCES.map((s) => ({ ...s, read: (p: string, a: Parameters<typeof s.read>[1]) => (reads++, s.read(p, a)) }))
    const scanner = new UsageScanner(dirs, counting)
    await scanner.scan()
    expect(reads).toBe(2)
    await scanner.scan()
    expect(reads).toBe(2)
    await rm(join(dir, 'b.jsonl'))
    const data = await scanner.scan()
    expect(reads).toBe(2)
    expect(data.sessions).toHaveLength(1)
  })
})

describe('defaultStatsDirs', () => {
  it('puts every log folder under TR_USAGE_STATS_HOME and ignores the agents’ own overrides then', async () => {
    const { defaultStatsDirs } = await import('./sources')
    const d = defaultStatsDirs({ TR_USAGE_STATS_HOME: '/tmp/h', CODEX_HOME: '/x/codex', CLAUDE_CONFIG_DIR: '/x/claude' }, '/Users/m')
    expect(d).toMatchObject({ home: '/tmp/h', claudeProjects: ['/tmp/h/.claude/projects'], codexHome: '/tmp/h/.codex', opencodeData: '/tmp/h/.local/share/opencode' })
    expect(defaultStatsDirs({ CODEX_HOME: '/x/codex' }, '/Users/m').codexHome).toBe('/x/codex')
  })
})
