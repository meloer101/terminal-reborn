import { describe, expect, it, vi } from 'vitest'
import type { ReviewStatus } from '@shared/background-review'

vi.mock('../state/review-comments', () => ({ landReviewComments: vi.fn() }))
vi.mock('../state/workspace', () => ({ useWorkspace: { getState: () => ({ sessions: [], worktrees: [] }) } }))

const { nextReviewState, reviewLine } = await import('./background')

const base: ReviewStatus = { root: '/w', phase: 'running', trigger: 'manual', agent: 'claude', hash: 'h', message: '正在审阅…', startedAt: 1 }

describe('nextReviewState', () => {
  it('ignores a late running copy of a run that already ended', () => {
    expect(nextReviewState({ ...base, phase: 'done', found: 2 }, base)).toBeNull()
    expect(nextReviewState({ ...base, phase: 'done' }, { ...base, startedAt: 2 })).toMatchObject({ phase: 'running', startedAt: 2 })
  })

  it('keeps the earlier result when the same diff is asked for again', () => {
    const done = { ...base, phase: 'done' as const, found: 2, costUsd: 0.01 }
    expect(nextReviewState(done, { ...base, phase: 'skipped', message: '这份改动已经审过' })).toEqual({ ...done, note: '这份改动已经审过' })
  })

  it('shows a saved result as the earlier review, marked as already reviewed', () => {
    const saved = { ...base, phase: 'done' as const, found: 2, cached: true as const }
    expect(nextReviewState(undefined, saved)).toEqual({ ...base, phase: 'done', found: 2, note: '这份改动已经审过' })
  })

  it('counts the landed comments instead of keeping them', () => {
    const next = nextReviewState(undefined, { ...base, phase: 'done', comments: [] })
    expect(next).toEqual({ ...base, phase: 'done', found: 0 })
  })
})

describe('reviewLine', () => {
  it('says what was found with the P0–P3 counts, time and cost', () => {
    expect(reviewLine({ ...base, phase: 'done', found: 3, durationMs: 11_000, costUsd: 0.039 }, 'P0 1 · P2 2')).toEqual({
      tone: 'warn',
      text: '审阅找到 3 条（P0 1 · P2 2）',
      meta: '用时 11 秒 · 花费 $0.039',
      detail: '正在审阅…'
    })
    expect(reviewLine({ ...base, phase: 'done', found: 0 }, '').text).toBe('审阅完成，没有发现问题')
    expect(reviewLine({ ...base, phase: 'failed', message: '找不到 codex 命令，没有审阅' }, '')).toMatchObject({ tone: 'error', text: '审阅失败：找不到 codex 命令，没有审阅' })
  })

  it('names the reviewer only when it is not the session\'s CLI, and counts ignored findings', () => {
    const done = { ...base, phase: 'done' as const, agent: 'codex' as const, found: 1, hidden: 2 }
    expect(reviewLine(done, 'P1 1', 'claude').text).toBe('Codex 审阅找到 1 条（P1 1） · 另有 2 条你之前忽略过')
    expect(reviewLine(done, 'P1 1', 'codex').text).toBe('审阅找到 1 条（P1 1） · 另有 2 条你之前忽略过')
  })
})
