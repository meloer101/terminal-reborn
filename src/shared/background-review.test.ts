import { describe, expect, it } from 'vitest'
import {
  beginReview,
  CLAUDE_PROMPT_CHAR_LIMIT,
  CODEX_PROMPT_CHAR_LIMIT,
  decideReview,
  diffHash,
  driveReview,
  emptyReviewMemory,
  findingsToComments,
  formatReviewStats,
  framingOverhead,
  parseReviewResult,
  parseUnifiedDiffFiles,
  promptCharLimit,
  rememberReview,
  reviewArgv,
  REVIEW_OUTPUT_SCHEMA,
  reviewUserPrompt,
  segmentReviewDiff,
  shouldCancelForDiff,
  untrackedFileDiff,
  type DiffFile,
  type ReviewCommandResult
} from './background-review'

const file = (path: string, hunks: string[]): DiffFile => ({
  path,
  preamble: `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n`,
  hunks: hunks.map((body) => ({ header: '@@ -1,1 +1,1 @@', body: body.endsWith('\n') ? body : `${body}\n` }))
})

describe('diffHash', () => {
  it('is SHA-256 and changes when the diff changes', () => {
    expect(diffHash('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(diffHash('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(diffHash('abc')).toBe(diffHash('abc'))
    expect(diffHash('abd')).not.toBe(diffHash('abc'))
  })
})

describe('segmentReviewDiff', () => {
  it('reviews a diff that fits in one pass', () => {
    const files = [file('a.ts', ['+a\n']), file('b.ts', ['+b\n'])]
    const segments = segmentReviewDiff(files, 10_000)
    expect(segments).toHaveLength(1)
    expect(segments[0]?.tooLarge).toBe(false)
    expect(segments[0]?.paths).toEqual(['a.ts', 'b.ts'])
    expect(segments[0]?.diff).toContain('a.ts')
    expect(segments[0]?.diff).toContain('b.ts')
  })

  it('splits by file when the two together exceed the budget', () => {
    const files = [file('a.ts', ['+a\n']), file('b.ts', ['+bbbb\n'])]
    const alone = (item: DiffFile) => segmentReviewDiff([item], 1_000_000)[0]!.diff.length
    const budget = Math.max(alone(files[0]!), alone(files[1]!))
    const segments = segmentReviewDiff(files, budget)
    expect(segments.map((segment) => segment.paths)).toEqual([['a.ts'], ['b.ts']])
    expect(segments.every((segment) => !segment.tooLarge)).toBe(true)
  })

  it('packs files that fit and starts a new segment for the one that does not', () => {
    const small = file('a.ts', ['+a\n'])
    const also = file('b.ts', ['+b\n'])
    const third = file('c.ts', ['+c\n'])
    const pair = segmentReviewDiff([small, also], 1_000_000)[0]!.diff.length
    const segments = segmentReviewDiff([small, also, third], pair)
    expect(segments).toHaveLength(2)
    expect(segments[0]?.paths).toEqual(['a.ts', 'b.ts'])
    expect(segments[1]?.paths).toEqual(['c.ts'])
  })

  it('splits one file into hunks, and does not cut a hunk that is still too big', () => {
    const wide = file('big.ts', ['+' + 'x'.repeat(80) + '\n', '+' + 'y'.repeat(80) + '\n'])
    const oneHunk = segmentReviewDiff([{ ...wide, hunks: [wide.hunks[0]!] }], 1_000_000)[0]!.diff
    const segments = segmentReviewDiff([wide], oneHunk.length)
    expect(segments).toHaveLength(2)
    expect(segments.map((segment) => segment.paths)).toEqual([['big.ts'], ['big.ts']])
    expect(segments[0]?.diff).toContain('@@')
    expect(segments[1]?.diff).toContain('y'.repeat(80))

    const huge = file('huge.ts', ['+' + 'z'.repeat(200) + '\n'])
    const tooBig = segmentReviewDiff([huge], 40)
    expect(tooBig).toHaveLength(1)
    expect(tooBig[0]?.tooLarge).toBe(true)
    expect(tooBig[0]?.diff).toContain('z'.repeat(200))
    expect(tooBig[0]?.diff.length).toBeGreaterThan(40)
  })

  it('uses the measured client ceilings', () => {
    expect(CLAUDE_PROMPT_CHAR_LIMIT).toBe(2_900_000)
    expect(CODEX_PROMPT_CHAR_LIMIT).toBe(1_048_576)
    expect(promptCharLimit('claude')).toBe(CLAUDE_PROMPT_CHAR_LIMIT)
    expect(promptCharLimit('codex')).toBe(CODEX_PROMPT_CHAR_LIMIT)
    const overhead = framingOverhead('rules', false)
    const diff = 'x'.repeat(CODEX_PROMPT_CHAR_LIMIT - overhead)
    const prompt = reviewUserPrompt('rules', diff, null)
    expect(prompt.length).toBe(CODEX_PROMPT_CHAR_LIMIT)
    expect(prompt.length).toBeLessThanOrEqual(CLAUDE_PROMPT_CHAR_LIMIT)
  })
})

describe('parseUnifiedDiffFiles', () => {
  it('keeps preamble and hunks per file', () => {
    const text = ['diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1,2 +1,2 @@', ' a', '-b', '+c', ''].join('\n')
    const files = parseUnifiedDiffFiles(text)
    expect(files).toHaveLength(1)
    expect(files[0]?.path).toBe('src/a.ts')
    expect(files[0]?.hunks).toHaveLength(1)
    expect(files[0]?.hunks[0]?.body).toContain('+c')
  })
})

const finding = {
  path: 'src/a.ts',
  startLine: 2,
  endLine: 2,
  side: 'new',
  group: 'uncommitted',
  severity: 'P1',
  confidence: 0.8,
  title: '越界',
  explanation: '下标没有检查'
}

describe('parseReviewResult', () => {
  it('reads Claude structured_output into P0–P3 comments', () => {
    const raw = JSON.stringify({
      structured_output: { findings: [finding, { ...finding, severity: 'P0', startLine: 1, endLine: 1, title: '崩溃', explanation: '空指针' }], summary: '有两处' },
      total_cost_usd: 0.039,
      duration_ms: 11000
    })
    const parsed = parseReviewResult(raw)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.findings.map((item) => item.severity)).toEqual(['P1', 'P0'])
    expect(parsed.costUsd).toBe(0.039)
    expect(parsed.durationMs).toBe(11000)
    const diff = ['diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1,2 +1,2 @@', ' keep', '-old', '+next', ''].join('\n')
    const comments = findingsToComments(parsed.findings, diff, 5, diffHash(diff))
    expect(comments[0]).toMatchObject({ severity: 'P1', origin: 'review', line: 2, side: 'new', group: 'uncommitted', confidence: 0.8 })
    expect(comments[0]?.text).toContain('越界')
    expect(comments.every((comment) => comment.id.startsWith('bg-'))).toBe(true)
  })

  it('reads a Codex schema document and a JSONL agent_message', () => {
    expect(parseReviewResult(JSON.stringify({ findings: [], summary: '没有问题' }))).toMatchObject({ ok: true, findings: [], summary: '没有问题' })
    const line = JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify({ findings: [finding], summary: '一处' }) } })
    const parsed = parseReviewResult(`${line}\nnot json\n`)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.findings).toHaveLength(1)
  })

  it('fails closed when the JSON is not the schema', () => {
    for (const raw of ['hello', '{"title":"nope"}', '{"findings":[{"path":"a.ts"}]}', '']) {
      const parsed = parseReviewResult(raw)
      expect(parsed.ok).toBe(false)
      if (!parsed.ok) expect(parsed).not.toHaveProperty('findings')
    }
    const comments = findingsToComments([], '', 0, 'abc')
    expect(comments).toEqual([])
  })
})

describe('decideReview', () => {
  it('reviews one hash once, and cancels the in-flight run when the diff changes', () => {
    let memory = emptyReviewMemory()
    expect(decideReview(memory, 'aaa')).toEqual({ kind: 'start' })
    memory = beginReview(memory, 'aaa')
    expect(decideReview(memory, 'aaa')).toEqual({ kind: 'skip', reason: 'in-flight' })
    expect(decideReview(memory, 'bbb')).toEqual({ kind: 'replace', cancelHash: 'aaa' })
    expect(shouldCancelForDiff('aaa', 'bbb')).toBe(true)
    expect(shouldCancelForDiff('aaa', 'aaa')).toBe(false)
    memory = rememberReview(memory, 'aaa', 'cancelled')
    expect(memory.inFlightHash).toBeNull()
    expect(memory.reviewed.has('aaa')).toBe(false)
    memory = beginReview(memory, 'bbb')
    memory = rememberReview(memory, 'bbb', 'failed')
    expect(decideReview(memory, 'bbb').kind).toBe('start')
    memory = beginReview(memory, 'bbb')
    memory = rememberReview(memory, 'bbb', 'done')
    expect(decideReview(memory, 'bbb')).toEqual({ kind: 'skip', reason: 'same-hash' })
    expect(decideReview(memory, 'ccc').kind).toBe('start')
  })
})

describe('reviewArgv', () => {
  it('builds a read-only Claude prompt command and does not touch user config', () => {
    const argv = reviewArgv({ agent: 'claude', model: 'haiku', schemaPath: '/tmp/schema.json', outputPath: '/tmp/out.json' })
    expect(argv.slice(0, 6)).toEqual(['claude', '-p', '--output-format', 'json', '--json-schema', JSON.stringify(REVIEW_OUTPUT_SCHEMA)])
    expect(argv).toEqual(expect.arrayContaining(['--no-session-persistence', '--permission-mode', 'plan', '--tools', 'Read,Grep,Glob', '--strict-mcp-config', '--setting-sources', 'project,local', '--model', 'haiku']))
    expect(argv.join('\n')).not.toMatch(/\.claude|\.codex|settings\.json/)
    expect(argv).not.toContain('/tmp/out.json')
    expect(reviewArgv({ agent: 'claude', model: 'bad model', schemaPath: '/tmp/s', outputPath: '/tmp/o' })).not.toContain('--model')
  })

  it('builds a read-only Codex exec command with the schema and output files', () => {
    const argv = reviewArgv({ agent: 'codex', schemaPath: '/tmp/schema.json', outputPath: '/tmp/out.json' })
    expect(argv).toEqual(['codex', 'exec', '--ephemeral', '--sandbox', 'read-only', '--output-schema', '/tmp/schema.json', '-o', '/tmp/out.json', '--json'])
    expect(argv.join('\n')).not.toMatch(/\.claude|\.codex/)
  })
})

describe('driveReview', () => {
  const diffText = untrackedFileDiff('src/a.ts', 'const n = items[i]\n')
  const files = parseUnifiedDiffFiles(diffText)

  it('sends one prompt under the ceiling and turns JSON into comments', async () => {
    const calls: string[] = []
    const result = await driveReview({
      agent: 'codex',
      rules: '',
      files,
      diffText,
      hash: diffHash(diffText),
      schemaPath: '/tmp/schema.json',
      outputPath: (index) => `/tmp/out-${index}.json`,
      now: 9,
      run: async (command) => {
        calls.push(command.prompt)
        expect(command.argv[0]).toBe('codex')
        expect(command.prompt.length).toBeLessThanOrEqual(CODEX_PROMPT_CHAR_LIMIT)
        expect(command.schemaJson).toContain('"findings"')
        const output: ReviewCommandResult = {
          code: 0,
          stdout: '',
          cancelled: false,
          outputText: JSON.stringify({ findings: [{ ...finding, startLine: 1, endLine: 1 }], summary: '一处' })
        }
        return output
      }
    })
    expect(calls).toHaveLength(1)
    expect(result.phase).toBe('done')
    expect(result.comments).toHaveLength(1)
    expect(result.comments[0]?.severity).toBe('P1')
    expect(result.comments[0]?.code).toContain('items[i]')
  })

  it('does not keep comments when the JSON cannot be parsed', async () => {
    const result = await driveReview({
      agent: 'claude',
      rules: 'rules',
      files,
      diffText,
      hash: 'h',
      schemaPath: '/tmp/schema.json',
      outputPath: () => '/tmp/out.json',
      run: async () => ({ code: 0, stdout: '{"title":"nope"}', outputText: '{"title":"nope"}', cancelled: false })
    })
    expect(result.phase).toBe('failed')
    expect(result.comments).toEqual([])
  })

  it('does not call the CLI when a hunk is over the budget', async () => {
    let calls = 0
    const huge = file('huge.ts', ['+' + 'z'.repeat(80) + '\n'])
    const result = await driveReview({
      agent: 'codex',
      rules: 'r'.repeat(CODEX_PROMPT_CHAR_LIMIT),
      files: [huge],
      diffText: 'z',
      hash: 'h',
      schemaPath: '/tmp/schema.json',
      outputPath: () => '/tmp/out.json',
      run: async () => {
        calls++
        return { code: 0, stdout: '', outputText: '', cancelled: false }
      }
    })
    expect(calls).toBe(0)
    expect(result.phase).toBe('failed')
    expect(result.comments).toEqual([])
  })

  it('stops when the run is cancelled and does not return comments', async () => {
    const result = await driveReview({
      agent: 'claude',
      rules: 'rules',
      files,
      diffText,
      hash: 'h',
      schemaPath: '/tmp/schema.json',
      outputPath: () => '/tmp/out.json',
      run: async () => ({ code: null, stdout: '', outputText: '', cancelled: true })
    })
    expect(result.phase).toBe('cancelled')
    expect(result.comments).toEqual([])
  })
})

describe('formatReviewStats', () => {
  it('prints duration and cost when the CLI reported them', () => {
    expect(formatReviewStats(11000, 0.039)).toBe('用时 11 秒 · 花费 $0.039')
    expect(formatReviewStats(undefined, undefined)).toBe('')
  })
})
