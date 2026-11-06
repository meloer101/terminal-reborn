import { describe, expect, it } from 'vitest'
import { CHAT_LIMITS, createChatParser, toolArg, toolLabel, type ChatItem } from './transcript-chat'

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

  it('shows slash commands, interruptions, compaction and API errors as one line each', () => {
    const items = parse([
      line({ type: 'user', message: { content: '<command-name>/clear</command-name>\n<command-message>clear</command-message>\n<command-args></command-args>' } }),
      line({ type: 'user', message: { content: '<local-command-stdout></local-command-stdout>' } }),
      line({ type: 'user', message: { content: [{ type: 'text', text: '[Request interrupted by user]' }] } }),
      line({ type: 'system', subtype: 'compact_boundary', compactMetadata: { preTokens: 1 } }),
      line({ type: 'system', subtype: 'api_error', content: 'Overloaded' })
    ])
    expect(items.map((i) => (i.kind === 'system' ? i.text : i.kind))).toEqual(['/clear', '已中断', '对话已压缩', 'Overloaded'])
  })

  it('counts the photos sent with a prompt', () => {
    const items = parse([
      line({ type: 'user', message: { content: [{ type: 'text', text: '[Image #1] 按钮被挡住了' }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } }] } })
    ])
    expect(items[0]).toMatchObject({ kind: 'user', text: '[Image #1] 按钮被挡住了', images: 1 })
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
