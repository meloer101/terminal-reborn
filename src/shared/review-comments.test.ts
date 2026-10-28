import { describe, expect, it } from 'vitest'
import {
  clipCode,
  commentLocation,
  commentPicked,
  MAX_CODE_CHARS,
  replaceReviewComments,
  reviewPrompt,
  sanitizeReviewComments,
  withDefaultPicks,
  type ReviewComment
} from './review-comments'

const comment = (patch: Partial<ReviewComment> = {}): ReviewComment => ({
  id: 'c1',
  group: 'uncommitted',
  path: 'src/nav.ts',
  side: 'new',
  line: 28,
  endLine: 28,
  code: 'const max = document.body.scrollHeight',
  text: '窗口尺寸变化后 max 不会更新，改用 ResizeObserver',
  createdAt: 1,
  ...patch
})

describe('sanitizeReviewComments', () => {
  it('keeps valid comments of worktrees that exist', () => {
    const saved = { '/wt/a': [comment()], '/wt/gone': [comment({ id: 'c2' })] }
    expect(sanitizeReviewComments(saved, new Set(['/wt/a']))).toEqual({ '/wt/a': [comment()] })
  })

  it('drops malformed comments and empty lists', () => {
    const saved = {
      '/wt/a': [
        comment({ path: '/abs' }),
        comment({ side: 'left' as never }),
        comment({ line: 3, endLine: 2 }),
        comment({ text: '   ' }),
        { nope: true },
        comment({ id: 'ok', line: 1, endLine: 4 })
      ],
      '/wt/b': []
    }
    const result = sanitizeReviewComments(saved, new Set(['/wt/a', '/wt/b']))
    expect(result['/wt/a']?.map((c) => c.id)).toEqual(['ok'])
    expect(result['/wt/b']).toBeUndefined()
    expect(sanitizeReviewComments(null, new Set())).toEqual({})
  })
})

describe('texts', () => {
  it('locations say which lines and when they are removed ones', () => {
    expect(commentLocation(comment())).toBe('src/nav.ts:28')
    expect(commentLocation(comment({ line: 3, endLine: 5 }))).toBe('src/nav.ts:3-5')
    expect(commentLocation(comment({ side: 'old' }))).toBe('src/nav.ts:28（删除的行，旧文件行号）')
  })

  it('clips quoted code', () => {
    expect(clipCode(['1', '2', '3', '4', '5', '6'])).toBe('1\n2\n3\n4\n5')
    expect(clipCode(['x'.repeat(MAX_CODE_CHARS + 10)])).toHaveLength(MAX_CODE_CHARS + 1)
  })

  it('the prompt numbers the comments by file and line, with the code quoted', () => {
    const prompt = reviewPrompt([
      comment({ id: 'b', path: 'src/z.ts', line: 1, endLine: 1, code: 'z()', text: 'second file' }),
      comment({ id: 'a', line: 30, endLine: 31, code: 'a()\n\nb()', text: 'two\nlines' }),
      comment({ id: 'c', line: 2, endLine: 2, code: '', text: 'first' })
    ])
    expect(prompt).toBe(
      [
        '请按下面的审阅意见修改代码（行号是 diff 里的行号）：',
        '',
        '1. src/nav.ts:2',
        '   first',
        '',
        '2. src/nav.ts:30-31',
        '   > a()',
        '   > b()',
        '   two',
        '   lines',
        '',
        '3. src/z.ts:1',
        '   > z()',
        '   second file',
        '',
        '改完后告诉我改了什么。'
      ].join('\n')
    )
  })
})

describe('background review comments', () => {
  const base = { group: 'uncommitted' as const, path: 'a.ts', side: 'new' as const, line: 1, endLine: 1, code: '', text: 't', createdAt: 0 }
  const mine = { ...base, id: 'mine' }
  const p1 = { ...base, id: 'p1', origin: 'review' as const, severity: 'P1' as const }
  const p3 = { ...base, id: 'p3', origin: 'review' as const, severity: 'P3' as const }

  it('picks P0 / P1 by default', () => {
    expect(commentPicked(mine)).toBe(true)
    expect(commentPicked(p1)).toBe(true)
    expect(commentPicked(p3)).toBe(false)
    expect(commentPicked({ ...p3, picked: true })).toBe(true)
    expect(commentPicked({ ...p1, picked: false })).toBe(false)
  })

  it('replaces the previous review and keeps the user’s comments', () => {
    const next = { ...p1, id: 'next' }
    expect(replaceReviewComments([mine, p1, p3], [next]).map((c) => c.id)).toEqual(['mine', 'next'])
  })

  it('ticks the most severe findings of a review without P0 / P1, and keeps picks already made', () => {
    const p2 = { ...p3, id: 'p2', severity: 'P2' as const }
    const p2b = { ...p2, id: 'p2b', picked: false }
    const landed = withDefaultPicks([p2, p2b, p3])
    expect(landed.map(commentPicked)).toEqual([true, false, false])
    expect(withDefaultPicks([p1, p3]).map(commentPicked)).toEqual([true, false])
    expect(replaceReviewComments([mine], [p2, p3]).map(commentPicked)).toEqual([true, true, false])
  })

  it('keeps severity, confidence and picked through the workspace file', () => {
    const saved = sanitizeReviewComments({ '/w': [{ ...p3, confidence: 0.4, picked: true }, { ...mine, picked: false }] }, new Set(['/w']))
    expect(saved['/w']?.[0]).toMatchObject({ severity: 'P3', confidence: 0.4, picked: true, origin: 'review' })
    expect(saved['/w']?.[1]).not.toHaveProperty('picked')
  })
})
