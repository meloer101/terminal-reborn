import { describe, expect, it } from 'vitest'
import { clipText, INPUT_HEAD_CHARS, RESPONSE_ARRAY_ITEMS, RESPONSE_TAIL_CHARS, trimHookPayload } from './hook-payload'
import { toolCallKey } from './tool-call'

const MB = 1024 * 1024
const big = (n: number, seed = 'x'): string => seed.repeat(Math.ceil(n / seed.length)).slice(0, n)
const sizeOf = (value: unknown): number => JSON.stringify(value).length
const post = (tool_name: string, tool_input: unknown, tool_response?: unknown): Record<string, unknown> => ({
  session_id: 's1',
  transcript_path: '/tmp/t.jsonl',
  cwd: '/repo',
  hook_event_name: 'PostToolUse',
  tool_name,
  tool_input,
  ...(tool_response !== undefined ? { tool_response } : {})
})
type Trimmed = { tool_input: Record<string, unknown>; tool_response: Record<string, unknown> }
const trim = (payload: unknown): Trimmed => trimHookPayload(payload) as Trimmed

describe('clipText', () => {
  it('keeps short text, clips long text to head + marker + tail', () => {
    expect(clipText('short', 10, 10)).toBe('short')
    const text = `${big(100, 'a')}${big(1000, 'm')}${big(100, 'z')}`
    const clipped = clipText(text, 100, 100)
    expect(clipped.startsWith(big(100, 'a'))).toBe(true)
    expect(clipped.endsWith(big(100, 'z'))).toBe(true)
    expect(clipped).toContain('[1200 chars]')
  })

  it('is idempotent', () => {
    const once = clipText(big(10 * MB), 1000, 1000)
    expect(clipText(once, 1000, 1000)).toBe(once)
  })
})

describe('trimHookPayload', () => {
  it('Read: drops the file contents, keeps the path and the other fields', () => {
    const payload = post('Read', { file_path: '/repo/src/a.ts' }, { type: 'text', file: { filePath: '/repo/src/a.ts', content: big(8 * MB), numLines: 9000 } })
    const out = trim(payload)
    expect(sizeOf(out)).toBeLessThan(20_000)
    expect(out.tool_input).toEqual({ file_path: '/repo/src/a.ts' })
    expect(out.tool_response.file).toMatchObject({ filePath: '/repo/src/a.ts', numLines: 9000 })
    expect(out).toMatchObject({ session_id: 's1', transcript_path: '/tmp/t.jsonl', cwd: '/repo', hook_event_name: 'PostToolUse' })
  })

  it('Write: clips the file contents in tool_input; the path survives', () => {
    const out = trim(post('Write', { file_path: '/repo/big.json', content: big(5 * MB) }, { type: 'create', filePath: '/repo/big.json', content: big(5 * MB) }))
    expect(out.tool_input.file_path).toBe('/repo/big.json')
    expect((out.tool_input.content as string).length).toBeLessThan(INPUT_HEAD_CHARS + 3000)
    expect(sizeOf(out)).toBeLessThan(45_000)
  })

  it('Edit: clips old and new text; calls with different text still key apart', () => {
    const a = trim(post('Edit', { file_path: '/repo/a.ts', old_string: big(MB, 'o'), new_string: big(MB, 'n') }))
    const b = trim(post('Edit', { file_path: '/repo/a.ts', old_string: big(MB + 1, 'o'), new_string: big(MB, 'n') }))
    expect(a.tool_input.file_path).toBe('/repo/a.ts')
    expect(sizeOf(a)).toBeLessThan(50_000)
    expect(toolCallKey('Edit', a.tool_input)).not.toBe(toolCallKey('Edit', b.tool_input))
  })

  it('PreToolUse, PermissionRequest and PostToolUse of one call trim to the same input', () => {
    const input = { file_path: '/repo/a.ts', content: big(3 * MB, 'abc') }
    const pre = trim({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: input })
    const perm = trim({ hook_event_name: 'PermissionRequest', tool_name: 'Write', tool_input: { ...input } })
    const postEnd = trim(post('Write', { ...input }, { type: 'create' }))
    expect(toolCallKey('Write', pre.tool_input)).toBe(toolCallKey('Write', perm.tool_input))
    expect(toolCallKey('Write', pre.tool_input)).toBe(toolCallKey('Write', postEnd.tool_input))
  })

  it('Bash: keeps the output tail normalize reads, and the exit-code head of a Codex string result', () => {
    const stdout = `${big(3 * MB, 'line\n')}PASS 12 tests\n`
    const out = trim(post('Bash', { command: 'npm test' }, { stdout, stderr: '', interrupted: false }))
    expect(out.tool_input).toEqual({ command: 'npm test' })
    expect((out.tool_response.stdout as string).endsWith(stdout.slice(-RESPONSE_TAIL_CHARS))).toBe(true)
    expect(out.tool_response.interrupted).toBe(false)

    const codex = trimHookPayload(post('Bash', { command: ['bash', '-lc', 'npm test'] }, `Exit code: 1\n${big(2 * MB)}FAIL`)) as Record<string, unknown>
    const text = codex.tool_response as string
    expect(text.startsWith('Exit code: 1\n')).toBe(true)
    expect(text.endsWith('FAIL')).toBe(true)
    expect(text.length).toBeLessThan(20_000)
  })

  it('TodoWrite / TaskCreate: input and response stay whole', () => {
    const todos = Array.from({ length: 300 }, (_, i) => ({ content: `step ${i}`, status: 'pending', activeForm: `doing ${i}` }))
    const payload = post('TodoWrite', { todos }, { oldTodos: [], newTodos: todos })
    expect(trimHookPayload(payload)).toEqual(payload)
    const task = post('TaskCreate', { subject: big(30_000) }, { task: { id: '1', subject: big(30_000) } })
    expect(trimHookPayload(task)).toEqual(task)
  })

  it('caps lists in a response (Glob filenames), not in the input (AskUserQuestion questions)', () => {
    const out = trim(post('Glob', { pattern: '**/*' }, { filenames: Array.from({ length: 50_000 }, (_, i) => `/repo/f${i}.ts`), numFiles: 50_000 }))
    expect(out.tool_response.filenames).toHaveLength(RESPONSE_ARRAY_ITEMS)
    expect(out.tool_response.numFiles).toBe(50_000)
    const questions = Array.from({ length: 150 }, (_, i) => ({ question: `q${i}`, options: [] }))
    expect(trim(post('AskUserQuestion', { questions })).tool_input.questions).toHaveLength(150)
  })

  it('Codex apply_patch keeps only the file header lines', () => {
    const patch = ['*** Begin Patch', '*** Update File: src/a.ts', big(MB, '+x\n'), '*** Add File: src/b.ts', big(MB, '+y\n'), '*** End Patch'].join('\n')
    const out = trim({ tool_name: 'apply_patch', tool_input: { command: patch } })
    expect(out.tool_input.command).toBe('*** Begin Patch\n*** Update File: src/a.ts\n*** Add File: src/b.ts\n*** End Patch')
    expect(trimHookPayload({ tool_name: 'apply_patch', tool_input: patch })).toMatchObject({ tool_input: '*** Begin Patch\n*** Update File: src/a.ts\n*** Add File: src/b.ts\n*** End Patch' })
  })

  it("Gemini's permission Notification details are clipped too", () => {
    const out = trimHookPayload({ notification_type: 'ToolPermission', details: { tool_name: 'write_file', tool_input: { file_path: '/a', content: big(MB) } } }) as {
      details: { tool_input: { file_path: string; content: string } }
    }
    expect(out.details.tool_input.file_path).toBe('/a')
    expect(out.details.tool_input.content.length).toBeLessThan(INPUT_HEAD_CHARS + 3000)
  })

  it('leaves payloads without tool fields untouched (same object) and is idempotent', () => {
    const stop = { session_id: 's1', last_assistant_message: big(100_000) }
    expect(trimHookPayload(stop)).toBe(stop)
    expect(trimHookPayload(null)).toBe(null)
    expect(trimHookPayload('x')).toBe('x')
    const once = trimHookPayload(post('Read', { file_path: '/a' }, { file: { content: big(MB) } }))
    expect(trimHookPayload(once)).toEqual(once)
  })
})
