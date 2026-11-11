import { describe, expect, it } from 'vitest'
import { CHAT_LIMITS, createChatParser, fileDiffs, lineDiff, toolArg, toolLabel, type ChatItem } from './transcript-chat'

const CWD = '/Users/me/.tr/worktrees/acme/session-refresh'
const T = '2026-11-01T10:00:00.000Z'
const base = { cwd: CWD, timestamp: T, sessionId: 's1', version: '2.1.316', isSidechain: false }
const line = (o: object): string => JSON.stringify({ ...base, ...o })

type Tool = Extract<ChatItem, { kind: 'tool' }>
function toolAt(items: ChatItem[], i: number): Tool {
  const item = items[i]
  if (item?.kind !== 'tool') throw new Error(`item ${i} is not a tool`)
  return item
}

function parse(lines: string[], agent: 'claude' | 'codex' = 'claude'): ChatItem[] {
  const p = createChatParser(agent, () => 0)
  for (const l of lines) p.push(l)
  return [...p.items]
}

describe('Claude transcript → chat', () => {
  it('turns a prompt, thinking, a tool call and its result, and the reply into items (PRD §6.16 shapes)', () => {
    const items = parse([
      line({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'token 过期前 5 分钟续期' } }),
      line({ type: 'assistant', thinkingDurationMs: 6200, message: { id: 'm1', content: [{ type: 'thinking', thinking: 'look at session.ts' }] } }),
      line({ type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'pnpm vitest run auth', description: 'x' } }] } }),
      line({
        type: 'user',
        toolUseResult: { stdout: '✓ 12 passed', stderr: '', interrupted: false, isImage: false },
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: '✓ 12 passed', is_error: false }] }
      }),
      line({ type: 'assistant', message: { id: 'm2', content: [{ type: 'text', text: '改好了。' }] } })
    ])
    expect(items.map((i) => i.kind)).toEqual(['user', 'thinking', 'tool', 'text'])
    expect(items[0]).toMatchObject({ kind: 'user', id: 'u1', text: 'token 过期前 5 分钟续期', images: 0, at: Date.parse(T) })
    expect(items[1]).toMatchObject({ kind: 'thinking', ms: 6200 })
    expect(items[2]).toMatchObject({ kind: 'tool', id: 'tu1', name: 'Bash', arg: 'pnpm vitest run auth', state: 'ok', output: '✓ 12 passed' })
  })

  it('keeps a shell call’s whole command, line breaks and all, beside the one-line row text', () => {
    const command = 'cd server &&\n  pnpm vitest run auth'
    const items = parse([line({ type: 'assistant', message: { id: 'm', content: [{ type: 'tool_use', id: 'b', name: 'Bash', input: { command } }] } })])
    expect(items[0]).toMatchObject({ arg: 'cd server && pnpm vitest run auth', input: command })
    expect(items[0]).not.toHaveProperty('exit')
    const long = parse([line({ type: 'assistant', message: { id: 'm', content: [{ type: 'tool_use', id: 'b', name: 'Bash', input: { command: 'x'.repeat(5000) } }] } })])
    expect(toolAt(long, 0).input).toHaveLength(CHAT_LIMITS.input + 1)
    const read = parse([line({ type: 'assistant', message: { id: 'm', content: [{ type: 'tool_use', id: 'r', name: 'Read', input: { file_path: 'a.ts' } }] } })])
    expect(read[0]).not.toHaveProperty('input')
  })

  it('keeps TodoWrite’s tasks with their status', () => {
    const todos = [
      { content: '改成 Set-Cookie', status: 'completed', activeForm: '改' },
      { content: '跑测试', status: 'in_progress', activeForm: '跑' },
      { content: '查 Safari', status: 'pending', activeForm: '查' },
      { content: 7, status: 'pending' }
    ]
    const items = parse([line({ type: 'assistant', message: { id: 'm', content: [{ type: 'tool_use', id: 't', name: 'TodoWrite', input: { todos } }] } })])
    expect(items[0]).toMatchObject({
      name: 'TodoWrite',
      arg: '3 项',
      todos: [
        { text: '改成 Set-Cookie', status: 'completed' },
        { text: '跑测试', status: 'in_progress' },
        { text: '查 Safari', status: 'pending' }
      ]
    })
  })

  it('reports which items a line added or changed, so main can push just those', () => {
    const p = createChatParser('claude', () => 0)
    expect(p.push(line({ type: 'assistant', message: { id: 'm', content: [{ type: 'tool_use', id: 'a', name: 'Read', input: { file_path: `${CWD}/src/a.ts` } }] } }))).toEqual([0])
    expect(p.push(line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'a', content: 'x' }] } }))).toEqual([0])
    expect(p.items[0]).toMatchObject({ arg: 'src/a.ts', state: 'ok' })
  })

  it('draws an Edit from structuredPatch and a new file from its content', () => {
    const items = parse([
      line({ type: 'assistant', message: { id: 'm', content: [{ type: 'tool_use', id: 'e', name: 'Edit', input: { file_path: `${CWD}/src/session.ts` } }] } }),
      line({
        type: 'user',
        toolUseResult: {
          filePath: `${CWD}/src/session.ts`,
          structuredPatch: [{ oldStart: 12, oldLines: 3, newStart: 12, newLines: 4, lines: [' a', '-b', '+c', '+d'] }]
        },
        message: { content: [{ type: 'tool_result', tool_use_id: 'e', content: 'ok' }] }
      }),
      line({ type: 'assistant', message: { id: 'n', content: [{ type: 'tool_use', id: 'w', name: 'Write', input: { file_path: `${CWD}/new.ts` } }] } }),
      line({
        type: 'user',
        toolUseResult: { type: 'create', filePath: `${CWD}/new.ts`, content: 'x\ny\n', structuredPatch: [] },
        message: { content: [{ type: 'tool_result', tool_use_id: 'w', content: 'ok' }] }
      })
    ])
    expect(items[0]).toMatchObject({ kind: 'tool', diff: { path: 'src/session.ts', added: 2, removed: 1, truncated: false, hunks: [{ oldStart: 12, newStart: 12, lines: [' a', '-b', '+c', '+d'] }] } })
    expect(items[1]).toMatchObject({ kind: 'tool', diff: { path: 'new.ts', added: 2, removed: 0, hunks: [{ lines: ['+x', '+y'] }] } })
  })

  it('caps a long diff and keeps the counts of the whole', () => {
    const lines = Array.from({ length: CHAT_LIMITS.diffLines + 50 }, (_, i) => `+l${i}`)
    const items = parse([
      line({ type: 'assistant', message: { id: 'm', content: [{ type: 'tool_use', id: 'e', name: 'Write', input: { file_path: '/x/y.ts' } }] } }),
      line({ type: 'user', toolUseResult: { filePath: '/x/y.ts', structuredPatch: [{ oldStart: 0, newStart: 1, lines }] }, message: { content: [{ type: 'tool_result', tool_use_id: 'e', content: '' }] } })
    ])
    const tool = toolAt(items, 0)
    expect(tool.diff?.added).toBe(CHAT_LIMITS.diffLines + 50)
    expect(tool.diff?.truncated).toBe(true)
    expect(tool.diff?.hunks[0]?.lines.length).toBe(CHAT_LIMITS.diffLines)
  })

  it('marks a failed tool and keeps the end of a long output', () => {
    const long = 'a'.repeat(5000) + 'END'
    const items = parse([
      line({ type: 'assistant', message: { id: 'm', content: [{ type: 'tool_use', id: 'b', name: 'Bash', input: { command: 'false' } }] } }),
      line({ type: 'user', toolUseResult: 'Error: exit 1', message: { content: [{ type: 'tool_result', tool_use_id: 'b', content: long, is_error: true }] } })
    ])
    expect(items[0]).toMatchObject({ state: 'error' })
    expect(toolAt(items, 0).output?.endsWith('END')).toBe(true)
    expect(toolAt(items, 0).output?.length).toBeLessThanOrEqual(CHAT_LIMITS.output + 1)
  })

  it('skips bookkeeping lines, subagent lines and meta messages, and keeps unknown types visible', () => {
    const items = parse([
      line({ type: 'attachment', attachment: { type: 'hook_success' } }),
      line({ type: 'file-history-snapshot' }),
      line({ type: 'ai-title', aiTitle: 'x' }),
      line({ type: 'system', subtype: 'turn_duration' }),
      line({ type: 'user', isMeta: true, message: { content: 'caveat' } }),
      line({ type: 'assistant', isSidechain: true, message: { id: 'z', content: [{ type: 'text', text: 'subagent says' }] } }),
      line({ type: 'brand-new-thing' }),
      'not json',
      ''
    ])
    expect(items).toEqual([{ kind: 'unknown', id: 'x0', at: Date.parse(T), type: 'brand-new-thing' }])
  })

  it('parses a subagent’s lines that name the Agent call they belong to, under it (Figma 59J)', () => {
    const sub = { isSidechain: true, parentToolUseId: 'ag' }
    const items = parse([
      line({ type: 'assistant', message: { id: 'm', content: [{ type: 'tool_use', id: 'ag', name: 'Agent', input: { description: '查 SameSite', prompt: 'look it up' } }] } }),
      // The prompt the subagent gets: the Agent call says it already.
      line({ ...sub, type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'look it up' }] } }),
      line({ ...sub, type: 'assistant', message: { id: 's1', content: [{ type: 'thinking', thinking: 'search first' }, { type: 'tool_use', id: 'g', name: 'Grep', input: { pattern: 'SameSite' } }] } }),
      line({ ...sub, type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'g', content: '3 matches' }] } }),
      line({ ...sub, type: 'assistant', message: { id: 's2', content: [{ type: 'text', text: 'Safari 17 起不带 Lax cookie' }] } }),
      line({ ...sub, type: 'system', subtype: 'informational', content: 'inner note' }),
      line({
        type: 'user',
        toolUseResult: { status: 'completed', totalDurationMs: 42_000, totalTokens: 900, content: [{ type: 'text', text: 'done' }] },
        message: { content: [{ type: 'tool_result', tool_use_id: 'ag', content: [{ type: 'text', text: 'done' }] }] }
      })
    ])
    expect(items.map((i) => [i.kind, 'parent' in i ? i.parent : undefined])).toEqual([
      ['tool', undefined],
      ['thinking', 'ag'],
      ['tool', 'ag'],
      ['text', 'ag']
    ])
    expect(items[0]).toMatchObject({ name: 'Agent', arg: '查 SameSite', state: 'ok', ms: 42_000, output: 'done' })
    expect(items[2]).toMatchObject({ name: 'Grep', state: 'ok', output: '3 matches' })
    // Transcript files (the phone, history) mark subagent lines without a parent: still left out.
    expect(parse([line({ type: 'assistant', isSidechain: true, message: { id: 'z', content: [{ type: 'text', text: 'x' }] } })])).toEqual([])
    // Only Agent / Task carry a duration.
    const bash = parse([
      line({ type: 'assistant', message: { id: 'm', content: [{ type: 'tool_use', id: 'b', name: 'Bash', input: { command: 'ls' } }] } }),
      line({ type: 'user', toolUseResult: { stdout: 'a', stderr: '', totalDurationMs: 5 }, message: { content: [{ type: 'tool_result', tool_use_id: 'b', content: 'a' }] } })
    ])
    expect(bash[0]).not.toHaveProperty('ms')
  })

  it('shows slash commands as the user’s own messages, without their markup', () => {
    const items = parse([
      line({ type: 'user', uuid: 'c1', message: { content: '<command-message>archify</command-message>\n<command-name>/archify</command-name>\n<command-args>画一下这个项目</command-args>' } }),
      line({ type: 'user', isMeta: true, message: { content: [{ type: 'text', text: 'Base directory for this skill: …' }] } }),
      line({ type: 'system', subtype: 'local_command', uuid: 'c2', content: '<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args></command-args>' }),
      line({ type: 'system', subtype: 'local_command', content: '<local-command-stdout>Kept model as `Opus 5.5`</local-command-stdout>' }),
      line({ type: 'user', message: { content: '<command-name>/clear</command-name>\n<command-message>clear</command-message>\n<command-args></command-args>' } }),
      line({ type: 'user', message: { content: '<local-command-stdout></local-command-stdout>' } })
    ])
    expect(items.map((i) => (i.kind === 'user' ? [i.id, i.text] : i.kind))).toEqual([
      ['c1', '/archify 画一下这个项目'],
      ['c2', '/model'],
      'text',
      ['m1', '/clear']
    ])
  })

  it('shows a background task’s notification as a system line, not as the user’s message', () => {
    const notice = (status: string, summary: string): string =>
      `<task-notification>\n<task-id>ac69</task-id>\n<output-file>/private/tmp/x/tasks/ac69.output</output-file>\n<status>${status}</status>\n<summary>${summary}</summary>\n<note>…</note>\n</task-notification>`
    const sys = { origin: { kind: 'task-notification' }, promptSource: 'system' }
    const items = parse([
      line({ ...sys, type: 'user', message: { content: notice('completed', 'Agent "Audit GUI composer" finished') } }),
      line({ ...sys, type: 'user', message: { content: notice('stopped', 'Background agent "Research chat UI" didn\'t finish before the previous session ended') } }),
      line({ ...sys, type: 'user', message: { content: [{ type: 'text', text: notice('failed', 'Background command "npm test" failed with exit code 1') }] } }),
      line({ ...sys, type: 'user', message: { content: notice('weird', 'no name here') } })
    ])
    expect(items.map((i) => [i.kind, i.kind === 'system' ? i.text : ''])).toEqual([
      ['system', '后台任务「Audit GUI composer」已完成'],
      ['system', '后台任务「Research chat UI」已停止'],
      ['system', '后台任务「npm test」失败'],
      ['system', '后台任务已结束']
    ])
  })

  it('shows interruptions, compaction and API errors as one line each', () => {
    const items = parse([
      line({ type: 'user', message: { content: [{ type: 'text', text: '[Request interrupted by user]' }] } }),
      line({ type: 'system', subtype: 'compact_boundary', compactMetadata: { preTokens: 1 } }),
      line({ type: 'system', subtype: 'api_error', content: 'Overloaded' })
    ])
    expect(items.map((i) => (i.kind === 'system' ? i.text : i.kind))).toEqual(['已中断', '对话已压缩', 'Overloaded'])
  })

  it('shows what a local command printed (/cost, /context) as a reply, as the live stream does', () => {
    const items = parse([
      line({ type: 'user', message: { content: '<local-command-caveat>The command below was run directly in Claude Code</local-command-caveat>' } }),
      line({ type: 'user', message: { content: '<command-name>/usage</command-name>\n<command-message>usage</command-message>\n<command-args></command-args>' } }),
      line({ type: 'system', subtype: 'local_command', content: '<local-command-stdout>Current session: 23% used\n\nCurrent week: 36% used</local-command-stdout>' }),
      line({ type: 'user', message: { content: '<local-command-stdout>Set model to `Opus`</local-command-stdout>' } }),
      line({
        type: 'system',
        subtype: 'local_command',
        content: '<local-command-stdout>Running in the background as @code-review</local-command-stdout>\n<forked-skill-launch>{"agentId":"a"}</forked-skill-launch>'
      })
    ])
    expect(items.map((i) => [i.kind, i.kind === 'system' || i.kind === 'text' ? i.text : ''])).toEqual([
      ['user', ''],
      ['text', 'Current session: 23% used\n\nCurrent week: 36% used'],
      ['text', 'Set model to `Opus`'],
      ['text', 'Running in the background as @code-review']
    ])
  })

  it('counts the photos sent with a prompt', () => {
    const items = parse([
      line({ type: 'user', message: { content: [{ type: 'text', text: '[Image #1] 按钮被挡住了' }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } }] } })
    ])
    expect(items[0]).toMatchObject({ kind: 'user', text: '[Image #1] 按钮被挡住了', images: 1 })
    expect(items[0]).not.toHaveProperty('attachments')
  })

  it('keeps the photos sent with a prompt as files for the chat to draw (Figma 71A)', () => {
    const kept: string[] = []
    const p = createChatParser('claude', () => 0, (image) => {
      kept.push(`${image.mediaType} ${image.data}`)
      return image.mediaType === 'image/png' ? `/tmp/sent-${image.data}.png` : null
    })
    const image = (mediaType: string, data: string): object => ({ type: 'image', source: { type: 'base64', media_type: mediaType, data } })
    p.push(line({ type: 'user', message: { content: [{ type: 'text', text: '看图' }, image('image/png', 'AAAA'), image('image/heic', 'BBBB'), image('image/png', 'CCCC')] } }))
    expect(kept).toEqual(['image/png AAAA', 'image/heic BBBB', 'image/png CCCC'])
    expect(p.items[0]).toMatchObject({ kind: 'user', text: '看图', images: 3, attachments: ['/tmp/sent-AAAA.png', '/tmp/sent-CCCC.png'] })
  })

  it('leaves out thinking with no text (signature only, display omitted): there is nothing to open', () => {
    const items = parse([
      line({ type: 'assistant', thinkingDurationMs: 2687, message: { id: 'm1', content: [{ type: 'thinking', thinking: '', signature: 'EsYB' }] } }),
      line({ type: 'assistant', message: { id: 'm1', content: [{ type: 'thinking', thinking: ' \n', signature: 'EsYB' }] } }),
      line({ type: 'assistant', thinkingDurationMs: 3204, message: { id: 'm2', content: [{ type: 'thinking', thinking: 'Checking divisors', signature: 'EsYB' }] } })
    ])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'thinking', text: 'Checking divisors', ms: 3204 })
  })
})

describe('fileDiffs', () => {
  it('counts each file and caps all of them together at CHAT_LIMITS.diffLines lines', () => {
    const big = { oldStart: 1, newStart: 1, lines: Array.from({ length: CHAT_LIMITS.diffLines - 1 }, (_, i) => `+${i}`) }
    const [a, b, c] = fileDiffs([
      { path: 'a.ts', hunks: [big] },
      { path: 'b.ts', hunks: [{ oldStart: 3, newStart: 3, lines: [' x', '-y', '+z'] }] },
      { path: 'c.ts', hunks: [{ oldStart: 1, newStart: 1, lines: ['-gone'] }] }
    ])
    expect(a).toMatchObject({ path: 'a.ts', added: CHAT_LIMITS.diffLines - 1, removed: 0, truncated: false })
    expect(b).toMatchObject({ path: 'b.ts', added: 1, removed: 1, truncated: true, hunks: [{ lines: [' x'] }] })
    expect(c).toMatchObject({ path: 'c.ts', added: 0, removed: 1, truncated: true, hunks: [] })
  })
})

describe('Codex rollout → chat', () => {
  const r = (type: string, payload: object): string => JSON.stringify({ timestamp: T, type, payload })
  it('reads prompts, shell calls with their output, replies and interruptions; skips its own context', () => {
    const items = parse(
      [
        r('session_meta', { cwd: CWD }),
        r('response_item', { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'You are Codex' }] }),
        r('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>\n<cwd>x</cwd>' }] }),
        r('response_item', { type: 'message', id: 'q', role: 'user', content: [{ type: 'input_text', text: '加个测试' }] }),
        r('response_item', { type: 'function_call', name: 'exec_command', call_id: 'c1', arguments: JSON.stringify({ cmd: 'npm test' }) }),
        r('response_item', { type: 'function_call_output', call_id: 'c1', output: 'ok 3 passed' }),
        r('response_item', { type: 'message', id: 'a', role: 'assistant', content: [{ type: 'output_text', text: 'DONE' }] }),
        r('event_msg', { type: 'agent_message', message: 'DONE' }),
        r('event_msg', { type: 'turn_aborted', reason: 'interrupted' })
      ],
      'codex'
    )
    expect(items.map((i) => i.kind)).toEqual(['user', 'tool', 'text', 'system'])
    expect(items[1]).toMatchObject({ name: 'Bash', arg: 'npm test', state: 'ok', output: 'ok 3 passed' })
  })

  it('reads a shell call’s exit code before guessing from its output', () => {
    const call = (id: string): string => r('response_item', { type: 'function_call', name: 'exec_command', call_id: id, arguments: JSON.stringify({ cmd: 'rg error' }) })
    const out = (id: string, output: string): string => r('response_item', { type: 'function_call_output', call_id: id, output })
    const items = parse(
      [
        call('a'),
        out('a', 'Exit code: 0\nWall time: 0.1 seconds\nOutput:\nerror.ts: export class AuthError'),
        call('b'),
        out('b', 'Chunk ID: dff8d5\nWall time: 0.0006 seconds\nProcess exited with code 2\nOriginal token count: 0\nOutput:\n'),
        call('c'),
        out('c', 'Chunk ID: 232234\nWall time: 1.0 seconds\nProcess running with session ID 50328\nOutput:\nfailed to bind, retrying'),
        call('d'),
        out('d', 'aborted by user after 5.6s')
      ],
      'codex'
    )
    expect(items.map((i) => (i.kind === 'tool' ? i.state : i.kind))).toEqual(['ok', 'error', 'ok', 'error'])
    expect(items.map((i) => (i.kind === 'tool' ? i.exit : undefined))).toEqual([0, 2, undefined, undefined])
    expect(items[0]).toMatchObject({ input: 'rg error' })
  })

  it('reads update_plan as the task list, like the live session’s plan', () => {
    const plan = { explanation: null, plan: [{ step: 'Read', status: 'completed' }, { step: 'Edit', status: 'in_progress' }] }
    const items = parse([r('response_item', { type: 'function_call', name: 'update_plan', call_id: 'p1', arguments: JSON.stringify(plan) })], 'codex')
    expect(items[0]).toMatchObject({
      kind: 'tool',
      name: 'Plan',
      arg: '2 项',
      todos: [
        { text: 'Read', status: 'completed' },
        { text: 'Edit', status: 'in_progress' }
      ]
    })
  })

  it('leaves out reasoning with an empty summary', () => {
    const items = parse(
      [
        r('response_item', { type: 'reasoning', summary: [], encrypted_content: 'gAAA' }),
        r('response_item', { type: 'reasoning', summary: [{ type: 'summary_text', text: '**Checking tests**' }] })
      ],
      'codex'
    )
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'thinking', text: '**Checking tests**' })
  })
})

describe('tool rows', () => {
  it('names the one argument worth showing', () => {
    expect(toolArg('Grep', { pattern: 'refresh', path: '/x' })).toBe('refresh')
    expect(toolArg('Agent', { description: '审阅刷新逻辑', prompt: 'long' })).toBe('审阅刷新逻辑')
    expect(toolArg('TodoWrite', { todos: [1, 2, 3] })).toBe('3 项')
    expect(toolArg('Bash', { command: 'a\n  b' })).toBe('a b')
    expect(toolArg('mcp__figma__use_figma', { fileKey: 'abc', code: 'x' })).toBe('abc')
    expect(toolLabel('mcp__599cb545__use_figma')).toBe('use_figma')
    expect(toolLabel('Bash')).toBe('Bash')
  })
})

describe('lineDiff', () => {
  it('keeps three lines of context and splits distant changes into hunks', () => {
    const before = Array.from({ length: 20 }, (_, i) => `l${i + 1}`).join('\n')
    const after = before.replace('l2', 'L2').replace('l18', 'L18')
    const hunks = lineDiff(before, after)
    expect(hunks.map((h) => [h.oldStart, h.lines[0]])).toEqual([
      [1, ' l1'],
      [15, ' l15']
    ])
    expect(hunks[0]?.lines).toEqual([' l1', '-l2', '+L2', ' l3', ' l4', ' l5'])
  })

  it('treats a new file as all additions', () => {
    expect(lineDiff('', 'a\nb\n')).toEqual([{ oldStart: 1, newStart: 1, lines: ['+a', '+b'] }])
  })
})
