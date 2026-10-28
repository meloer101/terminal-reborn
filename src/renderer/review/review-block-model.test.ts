import { describe, expect, it } from 'vitest'
import type { ReviewComment } from '@shared/review-comments'
import { countsText, findingRow, headerText, reviewBlockView, sendLabel, shortPath, sortFindings, type BlockStatus } from './review-block-model'

const finding = (id: string, patch: Partial<ReviewComment> = {}): ReviewComment => ({
  id,
  group: 'uncommitted',
  path: 'src/auth.ts',
  side: 'new',
  line: 42,
  endLine: 42,
  code: '',
  text: '令牌没有过期检查\n过期的令牌仍然通过',
  createdAt: 1,
  severity: 'P1',
  origin: 'review',
  ...patch
})

const done: BlockStatus = { phase: 'done', agent: 'codex', message: '整体可以合并，有两处要先改。', reviewer: 'Codex', fileCount: 3, found: 2 }

describe('countsText', () => {
  it('spaces every count from its label, most severe first', () => {
    expect(countsText([{ severity: 'P2' }, { severity: 'P1' }])).toBe('1 个 P1 · 1 个 P2')
    expect(countsText([{ severity: 'P1' }, { severity: 'P1' }, { severity: 'P0' }, { severity: 'P3' }])).toBe('1 个 P0 · 2 个 P1 · 1 个 P3')
    // Never "P11": a count digit is not glued to the label.
    expect(countsText([{ severity: 'P1' }])).not.toMatch(/P1\d/)
    expect(countsText([{ severity: 'P1' }])).toBe('1 个 P1')
    expect(countsText([])).toBe('')
  })
})

describe('headerText', () => {
  it('names the reviewer and the files of the whole diff', () => {
    expect(headerText({ agent: 'codex', reviewer: 'Codex', fileCount: 3 })).toBe('Codex 审阅 · 3 个文件')
    expect(headerText({ agent: 'claude', fileCount: 1 })).toBe('Claude 审阅 · 1 个文件')
  })

  it('drops the file count of a result saved before it was recorded', () => {
    expect(headerText({ agent: 'claude' })).toBe('Claude 审阅')
    expect(headerText({ agent: 'claude', fileCount: 0 })).toBe('Claude 审阅')
  })
})

describe('findingRow', () => {
  it('shows severity, file:line, the first line of the text and whether it is ticked', () => {
    expect(findingRow(finding('a'))).toEqual({
      id: 'a',
      picked: true,
      severity: 'P1',
      tone: 'attention',
      location: 'src/auth.ts:42',
      locationTitle: 'src/auth.ts:42',
      title: '令牌没有过期检查'
    })
  })

  it('outlines P2 / P3, leaves them unticked until the user ticks them, and gives a range its span in the tooltip', () => {
    expect(findingRow(finding('b', { severity: 'P2', line: 7, endLine: 9 }))).toMatchObject({ picked: false, tone: 'quiet', location: 'src/auth.ts:7', locationTitle: 'src/auth.ts:7-9' })
    expect(findingRow(finding('c', { severity: 'P3', picked: true }))).toMatchObject({ picked: true, tone: 'quiet' })
    expect(findingRow(finding('d', { severity: 'P1', picked: false })).picked).toBe(false)
  })

  it('shortens a long path to its last two segments', () => {
    expect(shortPath('src/auth.ts')).toBe('src/auth.ts')
    expect(shortPath('src/renderer/panels/git/ChangesView.tsx')).toBe('…/git/ChangesView.tsx')
    expect(shortPath('averyveryverylongsinglefilenamethatgoeson.ts')).toBe('averyveryverylongsinglefilenamethatgoeson.ts')
  })
})

describe('sortFindings', () => {
  it('lists P0 first, then by file and line', () => {
    const rows = sortFindings([
      finding('p2', { severity: 'P2', path: 'a.ts' }),
      finding('p1b', { path: 'b.ts', line: 3 }),
      finding('p1a2', { path: 'a.ts', line: 9 }),
      finding('p0', { severity: 'P0', path: 'z.ts' }),
      finding('p1a1', { path: 'a.ts', line: 2 })
    ])
    expect(rows.map((c) => c.id)).toEqual(['p0', 'p1a1', 'p1a2', 'p1b', 'p2'])
  })
})

describe('reviewBlockView', () => {
  it('has nothing to show before a review, after a cancel, or when it was skipped', () => {
    expect(reviewBlockView(undefined, [])).toBeNull()
    expect(reviewBlockView({ ...done, phase: 'cancelled' }, [])).toBeNull()
    expect(reviewBlockView({ ...done, phase: 'skipped' }, [])).toBeNull()
  })

  it('shows progress while running, with the segment when the diff is read in parts', () => {
    expect(reviewBlockView({ ...done, phase: 'running' }, [])).toEqual({ kind: 'running', text: '审阅中…' })
    expect(reviewBlockView({ ...done, phase: 'running', segment: { index: 1, count: 3 } }, [])).toEqual({ kind: 'running', text: '审阅中… 2/3' })
  })

  it('says why a review failed, once', () => {
    expect(reviewBlockView({ ...done, phase: 'failed', message: '找不到 codex 命令，没有审阅' }, [])).toEqual({ kind: 'failed', text: '审阅失败：找不到 codex 命令，没有审阅' })
    expect(reviewBlockView({ ...done, phase: 'failed', message: '审阅失败：超时' }, [])).toEqual({ kind: 'failed', text: '审阅失败：超时' })
  })

  it('puts header, counts, summary and one row per finding in a finished review', () => {
    const view = reviewBlockView(done, [finding('b', { severity: 'P2', path: 'src/b.ts' }), finding('a')])
    expect(view).toMatchObject({
      kind: 'done',
      header: 'Codex 审阅 · 3 个文件',
      counts: '1 个 P1 · 1 个 P2',
      summary: '整体可以合并，有两处要先改。',
      picked: 1
    })
    expect(view?.kind === 'done' && view.rows.map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('says so when nothing was found, and counts what was left out because the user ignored it before', () => {
    expect(reviewBlockView({ ...done, found: 0, message: '没问题' }, [])).toMatchObject({ counts: '没有发现问题', summary: '没问题', rows: [] })
    expect(reviewBlockView({ ...done, found: 0, hidden: 2 }, [])).toMatchObject({ counts: '没有发现问题 · 另有 2 条你之前忽略过' })
    expect(reviewBlockView({ ...done, hidden: 1 }, [finding('a')])).toMatchObject({ counts: '1 个 P1 · 另有 1 条你之前忽略过' })
  })

  it('has no counts once the findings were sent on', () => {
    expect(reviewBlockView(done, [])).toMatchObject({ kind: 'done', counts: '', rows: [], picked: 0 })
  })
})

describe('sendLabel', () => {
  it('names the session’s agent and the ticked count', () => {
    expect(sendLabel('claude', 2)).toBe('发给 Claude · 2')
    expect(sendLabel('codex', 0)).toBe('发给 Codex · 0')
  })
})
