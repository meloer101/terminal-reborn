import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { SubagentInfo } from '@shared/agent-events'
import { claudeModelLabel, parseSubagentMeta, transcriptModel, SubagentWatcher, subagentIdOf } from './subagents'

// Shapes measured on Claude Code 2.1.316 (PRD §6.14 v1.109).
const META = {
  agentType: 'Explore',
  isBuiltIn: true,
  description: 'Map ship/merge code paths',
  toolUseId: 'toolu_01T5TCe4k5hq9gCT2DkRqDdZ',
  spawnDepth: 1,
  requestShape: 'background',
  requestNonInteractive: true
}
const ASSISTANT = JSON.stringify({ type: 'assistant', agentId: 'ab1', isSidechain: true, message: { role: 'assistant', model: 'claude-fable-5-1' } })

describe('subagent files', () => {
  it('reads the task, the model and the shape from the meta file', () => {
    expect(parseSubagentMeta(JSON.stringify(META))).toEqual({ title: 'Map ship/merge code paths', foreground: false })
    expect(parseSubagentMeta(JSON.stringify({ ...META, model: 'claude-opus-5-5', requestShape: 'foreground' }))).toEqual({
      title: 'Map ship/merge code paths',
      model: 'Opus 5.5',
      foreground: true
    })
    // No description: the agent's name, then its type.
    expect(parseSubagentMeta(JSON.stringify({ agentType: 'general-purpose', name: 'code-review' }))?.title).toBe('code-review')
    expect(parseSubagentMeta(JSON.stringify({ agentType: 'Plan' }))?.title).toBe('Plan')
    expect(parseSubagentMeta('{"desc')).toBeNull()
    expect(parseSubagentMeta('[]')).toBeNull()
  })

  it('names Claude models the way the CLI shows them', () => {
    expect(claudeModelLabel('claude-opus-5-5')).toBe('Opus 5.5')
    expect(claudeModelLabel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
    expect(claudeModelLabel('claude-sonnet-5')).toBe('Sonnet 5')
    expect(claudeModelLabel('claude-opus-5-5[1m]')).toBe('Opus 5.5')
    expect(claudeModelLabel('kimi-k3')).toBe('kimi-k3')
    expect(claudeModelLabel(42)).toBeUndefined()
  })

  it('takes the model attachment’s display name, else the first assistant line’s model, skipping a line cut short', () => {
    const user = JSON.stringify({ type: 'user', message: { role: 'user', content: 'go' } })
    // 2.1.316: listings first, then `model`, then the first request and reply.
    const listing = JSON.stringify({ type: 'attachment', attachment: { type: 'skill_listing', content: 'x'.repeat(2000) } })
    const model = JSON.stringify({ type: 'attachment', attachment: { type: 'model', identity: { modelId: 'claude-haiku-5-5', marketingName: 'Haiku 5.5' } } })
    expect(transcriptModel([user, listing, model, ASSISTANT].join('\n'))).toBe('Haiku 5.5')
    expect(transcriptModel([user, listing, ASSISTANT, '{"type":"assistant","mess'].join('\n'))).toBe('Fable 5.1')
    expect(transcriptModel([user, '{"type":"assistant","mess'].join('\n'))).toBeUndefined()
  })

  it('only takes agent ids that are safe in a file name, and not a compaction’s', () => {
    expect(subagentIdOf({ agent_id: 'abb8e4b1e03a90f34' })).toBe('abb8e4b1e03a90f34')
    expect(subagentIdOf({ agent_id: '../../etc' })).toBeNull()
    expect(subagentIdOf({ agent_id: 'acompact-1f2e' })).toBeNull()
    expect(subagentIdOf({})).toBeNull()
  })
})

describe('SubagentWatcher', () => {
  const root = '/Users/me/.claude/projects'
  const transcript = `${root}/-repo/sess-1.jsonl`
  const dir = `${root}/-repo/sess-1/subagents`

  function setup(files: Record<string, string>) {
    let now = 0
    const sent: SubagentInfo[][] = []
    const reads: string[] = []
    const timers: (() => void)[] = []
    const watcher = new SubagentWatcher((_id, _agent, items) => sent.push(items), {
      schedule: (fn) => void timers.push(fn),
      dirs: { claudeProjects: [root], codexHome: '/nowhere' },
      read: async (path) => {
        reads.push(path)
        return files[path] ?? ''
      },
      now: () => now
    })
    const hook = (event: string, extra: Record<string, unknown> = {}) => watcher.observe('s1', 'claude', event, { transcript_path: transcript, ...extra })
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
    const fire = () => timers.splice(0).forEach((fn) => fn())
    return { watcher, sent, reads, hook, settle, fire, tick: (ms: number) => (now += ms) }
  }

  it('lists a subagent from its meta once it first speaks, and drops it at SubagentStop', async () => {
    const { sent, hook, settle } = setup({ [`${dir}/agent-ab1.meta.json`]: JSON.stringify(META), [`${dir}/agent-ab1.jsonl`]: ASSISTANT })
    hook('SessionStart')
    hook('PreToolUse', { agent_id: 'ab1', tool_name: 'Grep' })
    await settle()
    expect(sent.at(-1)).toEqual([{ id: 'ab1', title: 'Map ship/merge code paths', model: 'Fable 5.1' }])
    hook('SubagentStop', { agent_id: 'ab1' })
    expect(sent.at(-1)).toEqual([])
    // A late PostToolUse of a stopped subagent does not bring it back.
    hook('PostToolUse', { agent_id: 'ab1', tool_name: 'Grep' })
    await settle()
    expect(sent.at(-1)).toEqual([])
  })

  it('reads a missing meta again on a later hook, at most every 2 s, and sends only changes', async () => {
    const files: Record<string, string> = {}
    const { sent, reads, hook, settle, tick } = setup(files)
    hook('PreToolUse', { agent_id: 'ab1' })
    await settle()
    hook('PostToolUse', { agent_id: 'ab1' })
    await settle()
    expect(reads.filter((p) => p.endsWith('.meta.json'))).toHaveLength(1)
    expect(sent).toEqual([[]])
    files[`${dir}/agent-ab1.meta.json`] = JSON.stringify({ ...META, model: 'claude-opus-5-5' })
    tick(2_000)
    hook('PreToolUse', { agent_id: 'ab1' })
    await settle()
    expect(sent).toEqual([[], [{ id: 'ab1', title: 'Map ship/merge code paths', model: 'Opus 5.5' }]])
    tick(5_000)
    hook('PreToolUse', { agent_id: 'ab1' })
    await settle()
    expect(sent).toHaveLength(2)
  })

  it('reads again on its own when a subagent goes quiet in one long call, a few times', async () => {
    const files: Record<string, string> = {}
    const { sent, reads, hook, settle, fire } = setup(files)
    hook('PreToolUse', { agent_id: 'ab1', tool_name: 'Bash' })
    await settle()
    files[`${dir}/agent-ab1.meta.json`] = JSON.stringify({ ...META, model: 'claude-opus-5-5' })
    fire()
    await settle()
    expect(sent.at(-1)).toEqual([{ id: 'ab1', title: 'Map ship/merge code paths', model: 'Opus 5.5' }])
    // Nothing missing any more: no further timed reads.
    const count = reads.length
    fire()
    await settle()
    expect(reads).toHaveLength(count)
  })

  it('gives up timed reads after three tries', async () => {
    const { reads, hook, settle, fire } = setup({})
    hook('PreToolUse', { agent_id: 'ab1' })
    await settle()
    for (let i = 0; i < 5; i++) {
      fire()
      await settle()
    }
    expect(reads.filter((p) => p.endsWith('.meta.json'))).toHaveLength(4)
  })

  it('tells a restarted session once that nothing runs, and clears on SessionEnd', async () => {
    const { watcher, sent, hook, settle } = setup({ [`${dir}/agent-ab1.meta.json`]: JSON.stringify(META) })
    hook('PreToolUse', { agent_id: 'ab1' })
    await settle()
    expect(sent.at(-1)).toHaveLength(1)
    hook('SessionEnd', { reason: 'prompt_input_exit' })
    expect(sent.at(-1)).toEqual([])
    // The PTY is spawned again under the same id: the window still shows what it had, so the first list is sent.
    hook('PreToolUse', { agent_id: 'ab1' })
    await settle()
    watcher.forget('s1')
    const before = sent.length
    hook('SessionStart', { source: 'startup' })
    expect(sent.length).toBe(before + 1)
    expect(sent.at(-1)).toEqual([])
  })

  it('ignores a subagent’s own transcript as the session’s', async () => {
    const { reads, hook, settle } = setup({})
    hook('UserPromptSubmit', { prompt: 'go' })
    hook('PreToolUse', { agent_id: 'ab1', transcript_path: `${dir}/agent-ab1.jsonl` })
    await settle()
    expect(reads[0]).toBe(`${dir}/agent-ab1.meta.json`)
  })

  it('ends foreground subagents with the turn and keeps background ones', async () => {
    const { sent, hook, settle } = setup({
      [`${dir}/agent-fg.meta.json`]: JSON.stringify({ ...META, description: 'fg', requestShape: 'foreground' }),
      [`${dir}/agent-bg.meta.json`]: JSON.stringify({ ...META, description: 'bg' })
    })
    hook('PreToolUse', { agent_id: 'fg' })
    hook('PreToolUse', { agent_id: 'bg' })
    await settle()
    expect(sent.at(-1)?.map((s) => s.title)).toEqual(['fg', 'bg'])
    hook('Stop')
    expect(sent.at(-1)?.map((s) => s.title)).toEqual(['bg'])
    // An interrupted turn has no Stop: the next prompt ends what ran in the foreground.
    hook('PreToolUse', { agent_id: 'fg2' })
    await settle()
    hook('UserPromptSubmit', { prompt: 'go on' })
    expect(sent.at(-1)?.map((s) => s.title)).toEqual(['bg'])
    hook('SessionStart', { source: 'clear' })
    expect(sent.at(-1)).toEqual([])
  })

  it('ignores other agents, transcripts outside Claude’s projects and forgotten sessions', async () => {
    const { watcher, sent, reads, settle } = setup({ [`${dir}/agent-ab1.meta.json`]: JSON.stringify(META) })
    watcher.observe('s1', 'codex', 'PreToolUse', { transcript_path: transcript, agent_id: 'ab1' })
    watcher.observe('s2', 'claude', 'PreToolUse', { transcript_path: '/tmp/x/sess.jsonl', agent_id: 'ab1' })
    await settle()
    expect(reads).toEqual([])
    watcher.observe('s3', 'claude', 'PreToolUse', { transcript_path: transcript, agent_id: 'ab1' })
    watcher.forget('s3')
    await settle()
    expect(sent).toEqual([])
  })
})

describe('on disk', () => {
  let tmp = ''
  afterEach(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true })
  })

  it('reads a real subagent folder the way Claude lays it out', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'wavi-subagents-'))
    const projects = join(tmp, 'projects')
    const subagents = join(projects, '-repo', 'sess-1', 'subagents')
    await mkdir(subagents, { recursive: true })
    await writeFile(join(subagents, 'agent-ab1.meta.json'), JSON.stringify(META))
    await writeFile(join(subagents, 'agent-ab1.jsonl'), `${JSON.stringify({ type: 'user' })}\n${ASSISTANT}\n`)
    const sent: SubagentInfo[][] = []
    const watcher = new SubagentWatcher((_id, _agent, items) => sent.push(items), { dirs: { claudeProjects: [projects], codexHome: tmp } })
    watcher.observe('s1', 'claude', 'PreToolUse', { transcript_path: join(projects, '-repo', 'sess-1.jsonl'), agent_id: 'ab1' })
    // Real file reads: waited for, not timed (a busy machine in a full run takes longer than a fixed wait).
    await expect.poll(() => sent, { timeout: 5_000 }).toEqual([[{ id: 'ab1', title: 'Map ship/merge code paths', model: 'Fable 5.1' }]])
  })
})
