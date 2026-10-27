import { describe, expect, it } from 'vitest'
import {
  addDismissed,
  addReviewRecord,
  beginReview,
  commentDismissKey,
  countSeverities,
  dismissKey,
  DEFAULT_REVIEW_RULES,
  diffFileCount,
  latestRecord,
  planReview,
  reviewerLabel,
  MAX_REVIEW_RECORDS,
  otherAgent,
  recordFor,
  recordStatus,
  removeDismissed,
  sanitizeReviewResults,
  type ReviewRecord,
  type ReviewResultsStore,
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
  REVIEW_SEGMENT_CHARS,
  reviewPromptBudget,
  severityCounts,
  stampDiffGroup,
  reviewUserPrompt,
  segmentReviewDiff,
  shouldCancelForDiff,
  untrackedFileDiff,
  type DiffFile,
  type ReviewCommandResult
} from './background-review'
import type { ReviewComment } from './review-comments'

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

  it('holds a segment to about half a model window, below either client ceiling', () => {
    expect(reviewPromptBudget('claude')).toBe(REVIEW_SEGMENT_CHARS)
    expect(reviewPromptBudget('codex')).toBe(REVIEW_SEGMENT_CHARS)
    expect(REVIEW_SEGMENT_CHARS).toBeLessThan(CODEX_PROMPT_CHAR_LIMIT)
  })
})

describe('stampDiffGroup', () => {
  it('marks every file, and the comments take the group from the mark', () => {
    const uncommitted = stampDiffGroup(untrackedFileDiff('a.ts', 'one\n'), 'uncommitted')
    const committed = stampDiffGroup(untrackedFileDiff('b.ts', 'two\n'), 'committed')
    expect(uncommitted).toContain('diff --git a/a.ts b/a.ts\n# wavi-group: uncommitted\n')
    expect(stampDiffGroup('', 'committed')).toBe('')
    const both = uncommitted + committed
    const findings = [
      { path: 'a.ts', startLine: 1, endLine: 1, side: 'new' as const, group: 'committed' as const, severity: 'P2' as const, confidence: 0.5, title: 't', explanation: 'e' },
      { path: 'b.ts', startLine: 1, endLine: 1, side: 'new' as const, group: 'uncommitted' as const, severity: 'P0' as const, confidence: 0.9, title: 't', explanation: 'e' }
    ]
    const comments = findingsToComments(findings, both, 1, 'abcdef0123')
    expect(comments.map((c) => c.group)).toEqual(['uncommitted', 'committed'])
    expect(comments[1]?.code).toBe('two')
    expect(severityCounts(comments)).toBe('P0 1 · P2 1')
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
    expect(argv).toEqual(['codex', 'exec', '--ephemeral', '--sandbox', 'read-only', '--output-schema', '/tmp/schema.json', '-o', '/tmp/out.json', '--json', '-'])
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

describe('saved results and ignored findings (PRD F13 v1.63)', () => {
  const record = (hash: string, found = 0): ReviewRecord => ({ hash, agent: 'claude', trigger: 'manual', message: 'ok', startedAt: 1, endedAt: 2, found, counts: {} })

  it('matches an ignored finding by path and title, whatever the spacing and case', () => {
    expect(dismissKey('a.ts', '  Null  check\nlong explanation')).toBe(dismissKey('a.ts', 'null check'))
    expect(dismissKey('a.ts', 'x')).not.toBe(dismissKey('b.ts', 'x'))
    expect(commentDismissKey({ path: 'a.ts', text: '越界\ni 可能越界' })).toBe(dismissKey('a.ts', '越界'))
  })

  it('keeps the last ten records per worktree, one per diff', () => {
    let store: ReviewResultsStore = {}
    for (let i = 0; i < 12; i++) store = addReviewRecord(store, '/w', record(`0000000${i.toString(16)}`))
    store = addReviewRecord(store, '/w', record('0000000b', 3))
    expect(store['/w']!.records).toHaveLength(MAX_REVIEW_RECORDS)
    expect(latestRecord(store, '/w')).toMatchObject({ hash: '0000000b', found: 3 })
    expect(store['/w']!.records.filter((r) => r.hash === '0000000b')).toHaveLength(1)
    expect(recordFor(store, '/w', '00000000')).toBeNull()
    expect(recordStatus('/w', latestRecord(store, '/w')!, true)).toMatchObject({ phase: 'done', found: 3, cached: true })
  })

  it('adds and removes ignored keys without duplicates', () => {
    let store = addDismissed({}, '/w', ['k1', 'k1', 'k2'])
    expect(store['/w']!.dismissed).toEqual(['k1', 'k2'])
    expect(addDismissed(store, '/w', ['k1'])).toBe(store)
    store = removeDismissed(store, '/w', ['k1'])
    expect(store['/w']!.dismissed).toEqual(['k2'])
  })

  it('reads back only valid data from the file', () => {
    const store = sanitizeReviewResults({
      '/w': { records: [record('abcdef12', 2), { hash: 'nope' }, { ...record('abcdef13'), agent: 'bash' }], dismissed: ['k', 3, ''] },
      relative: { records: [record('abcdef14')] },
      '/empty': { records: [], dismissed: [] }
    })
    expect(Object.keys(store)).toEqual(['/w'])
    expect(store['/w']).toEqual({ records: [record('abcdef12', 2)], dismissed: ['k'] })
    expect(sanitizeReviewResults('garbage')).toEqual({})
  })

  it('counts severities and names the other CLI', () => {
    expect(countSeverities([{ severity: 'P1' }, { severity: 'P1' }, { severity: 'P3' }, {}])).toEqual({ P1: 2, P3: 1 })
    expect(otherAgent('claude')).toBe('codex')
    expect(otherAgent('codex')).toBe('claude')
  })
})

describe('planReview (incremental re-review, PRD F13 v1.78)', () => {
  const diffOf = (path: string, line: string): string =>
    `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1,1 +1,1 @@\n-old\n+${line}\n`
  const comment = (path: string, title: string): ReviewComment => ({
    id: `bg-${path}`,
    group: 'committed',
    path,
    side: 'new',
    line: 1,
    endLine: 1,
    code: '',
    text: title,
    createdAt: 1,
    severity: 'P1',
    origin: 'review'
  })
  const full = stampDiffGroup(diffOf('a.ts', 'a') + diffOf('b.ts', 'b') + diffOf('c.ts', 'c'), 'committed') + stampDiffGroup(diffOf('d.ts', 'd'), 'uncommitted')
  const previous = [comment('a.ts', '甲'), comment('b.ts', '乙'), comment('c.ts', '丙'), comment('gone.ts', '已不在')]

  it('reads everything when there is no usable previous review', () => {
    const plan = planReview({ full, since: null, previous, dismissed: new Set() })
    expect(plan).toMatchObject({ scope: 'full', carried: [], text: full })
    expect(plan.files.map((f) => f.path)).toEqual(['a.ts', 'b.ts', 'c.ts', 'd.ts'])
  })

  it('reads the files changed since the previous review plus every uncommitted file, and keeps the other findings', () => {
    // b.ts changed since; x.ts came in from the base and is not part of the worktree's diff.
    const plan = planReview({ full, since: diffOf('b.ts', 'b') + diffOf('x.ts', 'x'), previous, dismissed: new Set() })
    expect(plan.scope).toBe('incremental')
    expect(plan.files.map((f) => f.path)).toEqual(['b.ts', 'd.ts'])
    expect(plan.text).toContain('+++ b/b.ts')
    expect(plan.text).not.toContain('a.ts')
    expect(plan.text).not.toContain('x.ts')
    // gone.ts is no longer in the diff; b.ts is read again, so its old finding gives way to the new ones.
    expect(plan.carried.map((c) => c.path)).toEqual(['a.ts', 'c.ts'])
  })

  it('does not bring back a finding the user ignored', () => {
    const plan = planReview({ full, since: diffOf('b.ts', 'b'), previous, dismissed: new Set([commentDismissKey(comment('a.ts', '甲'))]) })
    expect(plan.carried.map((c) => c.path)).toEqual(['c.ts'])
  })

  it('has nothing to read when only the kept files remain', () => {
    const onlyCommitted = stampDiffGroup(diffOf('a.ts', 'a') + diffOf('b.ts', 'b'), 'committed')
    const plan = planReview({ full: onlyCommitted, since: '', previous, dismissed: new Set() })
    expect(plan).toMatchObject({ scope: 'incremental', files: [], text: '' })
    expect(plan.carried.map((c) => c.path)).toEqual(['a.ts', 'b.ts'])
  })

  it('is a full review when everything changed', () => {
    const plan = planReview({ full, since: diffOf('a.ts', 'a') + diffOf('b.ts', 'b') + diffOf('c.ts', 'c'), previous, dismissed: new Set() })
    expect(plan).toMatchObject({ scope: 'full', carried: [] })
  })

  it('counts files once and names the reviewer', () => {
    expect(diffFileCount(full)).toBe(4)
    expect(diffFileCount(full + diffOf('a.ts', 'again'))).toBe(4)
    expect(diffFileCount('')).toBe(0)
    expect(reviewerLabel('codex')).toBe('Codex')
    expect(reviewerLabel('claude')).toBe('Claude')
  })

  it('asks the reviewer for every problem in one pass', () => {
    expect(DEFAULT_REVIEW_RULES).toContain('一次把所有问题都列出来')
  })
})

describe('saved record: head, findings, file count (PRD F13 v1.78)', () => {
  const base: ReviewRecord = { hash: 'abcdef12', agent: 'codex', trigger: 'manual', message: 'ok', startedAt: 1, endedAt: 2, found: 1, counts: { P1: 1 } }
  const finding: ReviewComment = { id: 'bg-1', group: 'committed', path: 'a.ts', side: 'new', line: 3, endLine: 3, code: 'x', text: '越界', createdAt: 1, severity: 'P1', origin: 'review' }

  it('keeps the findings only on the newest record, and reads them back sanitized', () => {
    let store: ReviewResultsStore = addReviewRecord({}, '/w', { ...base, head: 'a'.repeat(40), fileCount: 3, reviewer: 'Codex', scope: 'full', comments: [finding] })
    store = addReviewRecord(store, '/w', { ...base, hash: 'abcdef13', comments: [] })
    expect(store['/w']!.records[0]).not.toHaveProperty('comments')
    expect(store['/w']!.records[1]!.comments).toEqual([])
    const again = sanitizeReviewResults({ '/w': { records: [{ ...base, head: 'a'.repeat(40), fileCount: 3, reviewer: 'Codex', scope: 'incremental', comments: [finding, { id: '' }] }] } })
    expect(again['/w']!.records[0]).toMatchObject({ head: 'a'.repeat(40), fileCount: 3, reviewer: 'Codex', scope: 'incremental', comments: [finding] })
    expect(sanitizeReviewResults({ '/w': { records: [{ ...base, head: 'not a hash', scope: 'x', fileCount: -1 }] } })['/w']!.records[0]).toEqual(base)
  })

  it('shows file count, reviewer and scope in the saved status', () => {
    expect(recordStatus('/w', { ...base, fileCount: 3, reviewer: 'Codex', scope: 'incremental' }, false)).toMatchObject({ fileCount: 3, reviewer: 'Codex', scope: 'incremental' })
  })
})
