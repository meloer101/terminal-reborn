import { describe, expect, it } from 'vitest'
import type { MetaReading } from '@shared/session-meta'
import { CodexUsageWatcher, codexRolloutPath } from './codex-usage'
import type { AgentDataDirs } from './agent-title'
import type { Scheduler } from './permission-registry'

const dirs: AgentDataDirs = { claudeProjects: ['/Users/u/.claude/projects'], codexHome: '/Users/u/.codex' }
const ROLLOUT = '/Users/u/.codex/sessions/2026/10/19/rollout-2026-10-19T07-41-24-01a1542e.jsonl'

// Rollout lines as Codex 0.142.5 writes them (scripts/spikes/42-codex-usage-lab.mjs).
const tokenCount = (percent: number) =>
  JSON.stringify({
    timestamp: '2026-10-19T12:41:25.000Z',
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: { last_token_usage: { total_tokens: 135200 }, model_context_window: 258400 },
      rate_limits: { limit_id: 'codex', primary: { used_percent: percent, window_minutes: 300, resets_at: 1792420883 }, secondary: null }
    }
  })

function fakeScheduler() {
  const queue: Array<{ fn: () => void; ms: number; cancelled: boolean }> = []
  const scheduler: Scheduler = {
    setTimeout: (fn, ms) => {
      const job = { fn, ms, cancelled: false }
      queue.push(job)
      return job
    },
    clearTimeout: (job) => ((job as { cancelled: boolean }).cancelled = true)
  }
  const runAll = async () => {
    for (const job of queue.splice(0)) if (!job.cancelled) job.fn()
    await new Promise((resolve) => setImmediate(resolve))
  }
  return { scheduler, runAll, queue }
}

describe('codexRolloutPath', () => {
  it('accepts only rollouts inside Codex’s sessions directories', () => {
    expect(codexRolloutPath(ROLLOUT, dirs)).toBe(ROLLOUT)
    expect(codexRolloutPath('/Users/u/.codex/archived_sessions/r.jsonl', dirs)).toBe('/Users/u/.codex/archived_sessions/r.jsonl')
    expect(codexRolloutPath('/Users/u/.codex/sessions/../auth.jsonl', dirs)).toBeNull()
    expect(codexRolloutPath('/etc/passwd', dirs)).toBeNull()
    expect(codexRolloutPath('relative/r.jsonl', dirs)).toBeNull()
    expect(codexRolloutPath(42, dirs)).toBeNull()
  })
})

describe('CodexUsageWatcher', () => {
  it('reads the rollout named by the hook after the hooks that follow a response', async () => {
    const { scheduler, runAll, queue } = fakeScheduler()
    const readings: Array<[string, MetaReading]> = []
    let content = tokenCount(40)
    const reads: string[] = []
    const watcher = new CodexUsageWatcher((id, r) => readings.push([id, r]), {
      dirs,
      scheduler,
      now: () => 7,
      read: async (path) => (reads.push(path), content)
    })
    watcher.observe('s1', 'codex', 'PreToolUse', { transcript_path: ROLLOUT })
    expect(queue).toHaveLength(0)
    watcher.observe('s1', 'codex', 'Stop', { transcript_path: ROLLOUT })
    expect(queue.map((j) => j.ms)).toEqual([300, 2000])
    await runAll()
    expect(reads).toEqual([ROLLOUT, ROLLOUT])
    expect(readings[0]).toEqual([
      's1',
      {
        context: { percent: 50, usedTokens: 135200, windowTokens: 258400, compactAt: 244800, compactPercent: 94 },
        usage: { vendor: 'codex', at: 7, windows: [{ minutes: 300, percent: 40, resetsAt: 1792420883_000 }] }
      }
    ])
    content = ''
    watcher.observe('s1', 'codex', 'Stop', {})
    await runAll()
    expect(readings).toHaveLength(2)
  })

  it('ignores Claude, foreign paths and forgotten sessions', async () => {
    const { scheduler, runAll } = fakeScheduler()
    const readings: unknown[] = []
    const watcher = new CodexUsageWatcher((id, r) => readings.push([id, r]), { dirs, scheduler, read: async () => tokenCount(10) })
    watcher.observe('s1', 'claude', 'Stop', { transcript_path: ROLLOUT })
    watcher.observe('s2', 'codex', 'Stop', { transcript_path: '/tmp/x.jsonl' })
    watcher.observe('s3', 'codex', 'Stop', { transcript_path: ROLLOUT })
    watcher.forget('s3')
    await runAll()
    expect(readings).toEqual([])
  })
})
