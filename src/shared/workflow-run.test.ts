import { describe, expect, it } from 'vitest'
import { phaseViews, runFromJournal, runFromSnapshot, runOutcome, sanitizeWorkflowRun, scriptMeta, tokenLabel, workflowCounts, workflowLine, workflowRows } from './workflow-run'

// Row shapes as Claude Code 2.1.322 writes them in `workflows/<runId>.json` (trimmed; PRD §6.18).
const agentRow = (over: Record<string, unknown>) => ({
  type: 'workflow_agent',
  index: 1,
  label: 'research:cli',
  phaseIndex: 1,
  phaseTitle: 'Research',
  agentId: 'aa74a63e2ce3ba05d',
  model: 'claude-opus-5-5',
  state: 'done',
  startedAt: 1_000,
  queuedAt: 900,
  tokens: 278_892,
  durationMs: 60_000,
  ...over
})

const snapshot = {
  runId: 'wf_c3e02dc8-633',
  taskId: 'w6k3u3ud4',
  workflowName: 'ultracode-research',
  status: 'completed',
  startTime: 900,
  durationMs: 180_000,
  totalTokens: 1_923_654,
  phases: [
    { title: 'Research', detail: 'read the code' },
    { title: 'Verify', detail: 'try to refute' }
  ],
  workflowProgress: [
    { type: 'workflow_phase', index: 1, title: 'Research' },
    { type: 'workflow_phase', index: 2, title: 'Verify' },
    agentRow({}),
    agentRow({ index: 2, label: 'research:disk', agentId: 'a26c748da66b1b32b', startedAt: 2_000, durationMs: 30_000 }),
    agentRow({ index: 3, label: 'verify:cli', phaseIndex: 2, phaseTitle: 'Verify', agentId: 'ab6c70e489f0eab08', state: 'error', error: 'API Error: Overloaded', startedAt: 70_000, durationMs: 5_000 })
  ]
}

describe('runFromSnapshot (the file Claude writes when a run ends)', () => {
  it('reads name, status, totals, declared phases and each agent', () => {
    const run = runFromSnapshot(snapshot)!
    expect(run).toMatchObject({ key: 'wf_c3e02dc8-633', runId: 'wf_c3e02dc8-633', name: 'ultracode-research', status: 'completed', tokens: 1_923_654, ms: 180_000 })
    expect(run.phases).toEqual([
      { title: 'Research', detail: 'read the code' },
      { title: 'Verify', detail: 'try to refute' }
    ])
    expect(run.agents.map((a) => [a.label, a.phase, a.state])).toEqual([
      ['research:cli', 0, 'done'],
      ['research:disk', 0, 'done'],
      ['verify:cli', 1, 'error']
    ])
    expect(run.agents[2]!.error).toBe('API Error: Overloaded')
    // Completed with an agent that errored reads 有失败 (Figma 74C).
    expect(runOutcome(run)).toBe('partly-failed')
  })

  it('maps killed to stopped and refuses a run id that could become a path', () => {
    expect(runFromSnapshot({ ...snapshot, status: 'killed' })!.status).toBe('stopped')
    expect(runFromSnapshot({ ...snapshot, runId: '../../etc' })).toBeNull()
  })
})

describe('workflowRows (stream-json task_progress and the snapshot)', () => {
  it('tells queued, running, stopped-with-the-run and failed agents apart', () => {
    const { agents } = workflowRows([
      { type: 'workflow_phase', index: 1, title: '改写' },
      agentRow({ phaseTitle: '改写', state: 'start', startedAt: undefined }),
      agentRow({ phaseTitle: '改写', state: 'progress' }),
      agentRow({ phaseTitle: '改写', state: 'error', endedWithRun: 'stopped' }),
      agentRow({ phaseTitle: '改写', state: 'error', error: 'stalled' })
    ])
    expect(agents.map((a) => a.state)).toEqual(['queued', 'running', 'stopped', 'error'])
    expect(agents[2]!.error).toBeUndefined()
  })
})

describe('runFromJournal (a terminal session while the run goes)', () => {
  const journal = [
    '{"type":"launched"}',
    '{"type":"started","key":"v2:a","agentId":"a1","label":"登录","phase":"改写"}',
    '{"type":"started","key":"v2:b","agentId":"a2","label":"刷新","phase":"改写"}',
    '{"type":"started","key":"v2:c","agentId":"a3","label":"调研","phase":"调研"}',
    '{"type":"result","key":"v2:a","agentId":"a1","result":{}}',
    '{"type":"failed","key":"v2:c","agentId":"a3"}',
    '{"type":"started","key":"v2:c","agentId":"a4","label":"调研","phase":"调研"}',
    '{"type":"star' // being written
  ].join('\n')

  it('knows only the agents that started, and a retried key is one agent', () => {
    const run = runFromJournal(journal, { runId: 'wf_abcdef12', name: 'auth', phases: [{ title: '调研' }, { title: '改写' }, { title: '核对' }] })
    expect(run.partial).toBe(true)
    expect(run.agents.map((a) => [a.id, a.label, a.phase, a.state])).toEqual([
      ['a1', '登录', 1, 'done'],
      ['a2', '刷新', 1, 'running'],
      ['a4', '调研', 0, 'running']
    ])
    expect(workflowCounts(run)).toEqual({ running: 2, queued: 0, done: 1, failed: 0 })
    expect(workflowLine(run, 0)).toBe('workflow · 调研 0 / 1')
  })
})

describe('scriptMeta (the confirmation card before the run)', () => {
  it('reads name and phases from the meta literal: unquoted keys, either quote, comments, trailing commas', () => {
    const script = `export const meta = {
      name: 'auth-cookie-migration', // shown in the card
      description: "Move login state to cookies",
      phases: [
        { title: '调研', detail: '找出三处读写点' },
        /* no detail */ { title: "改写" },
      ],
    }
    phase('调研')`
    expect(scriptMeta(script)).toEqual({ name: 'auth-cookie-migration', phases: [{ title: '调研', detail: '找出三处读写点' }, { title: '改写' }] })
  })

  it('gives up on a meta that is not a pure literal', () => {
    expect(scriptMeta('export const meta = { name: `x-${y}` }')).toBeNull()
    expect(scriptMeta('const x = 1')).toBeNull()
  })
})

describe('phaseViews', () => {
  it('counts done of all per phase and spans each phase from its first start to its last end', () => {
    const views = phaseViews(runFromSnapshot(snapshot)!, 0)
    expect(views.map((v) => [v.title, v.done, v.total, v.state, v.ms])).toEqual([
      ['Research', 2, 2, 'done', 60_000],
      ['Verify', 0, 1, 'error', 5_000]
    ])
  })
})

it('tokenLabel', () => {
  expect([tokenLabel(412_300), tokenLabel(1_210_000), tokenLabel(1_000_000), tokenLabel(900)]).toEqual(['412k', '1.21M', '1M', '900'])
})

it('sanitizeWorkflowRun keeps a well-formed run and drops junk', () => {
  const run = runFromSnapshot(snapshot)!
  expect(sanitizeWorkflowRun(JSON.parse(JSON.stringify(run)))).toEqual(run)
  expect(sanitizeWorkflowRun({ key: 1 })).toBeNull()
})
