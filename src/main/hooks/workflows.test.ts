import { describe, expect, it } from 'vitest'
import type { WorkflowRun } from '@shared/workflow-run'
import { launchedRun, WorkflowWatcher } from './workflows'

// Shapes measured on Claude Code 2.1.322 (PRD §6.20).
const root = '/Users/me/.claude/projects'
const transcript = `${root}/-repo/sess-1.jsonl`
const runDir = `${root}/-repo/sess-1/subagents/workflows/wf_abcdef12`
const snapshotPath = `${root}/-repo/sess-1/workflows/wf_abcdef12.json`
const SCRIPT = "export const meta = { name: 'auth', phases: [{ title: '调研' }, { title: '改写' }] }\nphase('调研')"
const launch = {
  tool_name: 'Workflow',
  tool_use_id: 'toolu_1',
  tool_input: { script: SCRIPT },
  tool_response: { status: 'async_launched', taskId: 'w1', taskType: 'local_workflow', workflowName: 'auth', runId: 'wf_abcdef12', transcriptDir: runDir }
}
const started = (key: string, id: string, label: string, phase: string) => JSON.stringify({ type: 'started', key, agentId: id, label, phase })

function setup(files: Record<string, string>, dirs: Record<string, string[]> = {}) {
  let now = 0
  const sent: WorkflowRun[][] = []
  const timers: (() => void)[] = []
  const watcher = new WorkflowWatcher((_id, _agent, runs) => sent.push(runs), {
    dirs: { claudeProjects: [root], codexHome: '/nowhere' },
    files: {
      read: async (path) => files[path] ?? null,
      readFrom: async (path, offset, max) => (path in files ? Buffer.from(files[path]!).subarray(offset, offset + max) : null),
      list: async (dir) => dirs[dir] ?? []
    },
    now: () => now,
    schedule: (fn) => void timers.push(fn),
    skip: (id) => id === 'gui'
  })
  const hook = (event: string, extra: Record<string, unknown> = {}, session = 's1') => watcher.observe(session, 'claude', event, { transcript_path: transcript, ...extra })
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
  return { sent, hook, settle, tick: (ms: number) => (now += ms), fire: () => timers.splice(0).forEach((fn) => fn()) }
}

describe('launchedRun', () => {
  it('takes the run id, name, call id and declared phases from the Workflow PostToolUse', () => {
    expect(launchedRun(launch)).toEqual({ runId: 'wf_abcdef12', name: 'auth', toolUseId: 'toolu_1', phases: [{ title: '调研' }, { title: '改写' }] })
    expect(launchedRun({ ...launch, tool_response: { runId: '../x' } })).toBeNull()
    expect(launchedRun({ ...launch, tool_name: 'Bash' })).toBeNull()
  })
})

describe('WorkflowWatcher', () => {
  it('lists a run at launch, follows its journal on its agents’ hooks, and takes the snapshot at its end', async () => {
    const files: Record<string, string> = {}
    const { sent, hook, settle, tick } = setup(files)
    hook('PostToolUse', launch)
    expect(sent.at(-1)).toMatchObject([{ key: 'wf_abcdef12', toolUseId: 'toolu_1', name: 'auth', status: 'running', agents: [] }])
    files[`${runDir}/journal.jsonl`] = ['{"type":"launched"}', started('k1', 'a1', '登录', '改写'), started('k2', 'a2', '刷新', '改写'), ''].join('\n')
    tick(2_000)
    hook('PreToolUse', { agent_id: 'a1', agent_type: 'workflow-subagent', tool_name: 'Read' })
    await settle()
    expect(sent.at(-1)![0]!.agents.map((a) => [a.label, a.phase, a.state])).toEqual([
      ['登录', 1, 'running'],
      ['刷新', 1, 'running']
    ])
    // Many hooks a second: the journal is read at most every 1.5 s.
    const count = sent.length
    // A result line carries the agent's whole answer: only its key fields are kept, and only new bytes are read.
    files[`${runDir}/journal.jsonl`] += `${JSON.stringify({ type: 'result', key: 'k1', agentId: 'a1', result: 'x'.repeat(200_000) })}\n`
    hook('PostToolUse', { agent_id: 'a1', agent_type: 'workflow-subagent', tool_name: 'Read' })
    await settle()
    expect(sent).toHaveLength(count)
    tick(2_000)
    hook('PostToolUse', { agent_id: 'a2', agent_type: 'workflow-subagent', tool_name: 'Read' })
    await settle()
    expect(sent.at(-1)![0]!.agents.map((a) => a.state)).toEqual(['done', 'running'])
    files[snapshotPath] = JSON.stringify({
      runId: 'wf_abcdef12',
      workflowName: 'auth',
      status: 'completed',
      totalTokens: 5000,
      durationMs: 9000,
      phases: [{ title: '调研' }, { title: '改写' }],
      workflowProgress: [{ type: 'workflow_agent', label: '登录', phaseTitle: '改写', agentId: 'a1', state: 'done', startedAt: 1, durationMs: 5 }]
    })
    hook('UserPromptSubmit', { source: 'system' })
    await settle()
    expect(sent.at(-1)).toMatchObject([{ status: 'completed', tokens: 5000, toolUseId: 'toolu_1' }])
  })

  it('reads again a few times when the end is heard before the snapshot is written', async () => {
    const files: Record<string, string> = { [`${runDir}/journal.jsonl`]: `${started('k1', 'a1', '登录', '改写')}\n` }
    const { sent, hook, settle, fire } = setup(files)
    hook('PostToolUse', launch)
    hook('Stop')
    await settle()
    expect(sent.at(-1)![0]!.status).toBe('running')
    files[snapshotPath] = JSON.stringify({ runId: 'wf_abcdef12', workflowName: 'auth', status: 'killed', workflowProgress: [] })
    fire()
    await settle()
    expect(sent.at(-1)![0]!.status).toBe('stopped')
  })

  it('finds a run it missed the launch of from a workflow agent’s hook; skips GUI sessions; clears on a new conversation', async () => {
    const files = { [`${runDir}/journal.jsonl`]: `${started('k1', 'a1', '登录', '改写')}\n` }
    const { sent, hook, settle } = setup(files, { [`${root}/-repo/sess-1/subagents/workflows`]: ['wf_abcdef12', 'junk'] })
    hook('PreToolUse', { agent_id: 'a1', agent_type: 'workflow-subagent' }, 'gui')
    await settle()
    expect(sent).toEqual([])
    hook('SubagentStart', { agent_id: 'a1', agent_type: 'workflow-subagent' })
    await settle()
    expect(sent.at(-1)!.map((r) => [r.key, r.agents.length])).toEqual([['wf_abcdef12', 1]])
    hook('SessionStart', { source: 'clear' })
    expect(sent.at(-1)).toEqual([])
  })
})
