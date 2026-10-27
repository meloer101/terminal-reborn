import { describe, expect, it } from 'vitest'
import type { BaseCi } from '@shared/ship'
import { baseCiText, newerBaseCi } from './base-ci'

const ci = (state: BaseCi['checks']['state'], over: Partial<BaseCi['checks']> = {}, rest: Partial<BaseCi> = {}): BaseCi => ({
  worktree: '/w',
  base: 'main',
  sha: 'a'.repeat(40),
  checks: { state, total: 3, passed: 0, pending: 0, failing: [], ...over },
  url: null,
  checkedAt: 10,
  ...rest
})

describe('base CI rows (Figma 29E / 29F)', () => {
  it('says pending, passing and failing in the design words', () => {
    expect(baseCiText(ci('pending', { pending: 2, passed: 1 }))).toEqual({ mark: 'pending', text: 'main 上的 CI · 2 项在跑' })
    expect(baseCiText(ci('passing', { passed: 3 }))).toEqual({ mark: 'passing', text: 'main 上的 CI 通过' })
    expect(baseCiText(ci('failing', { failing: [{ name: 'test', runId: null, jobId: null }, { name: 'e2e/split.spec.ts', runId: null, jobId: null }] }))).toEqual({
      mark: 'failing',
      text: 'main 上的 CI 失败 · test · e2e/split.spec.ts'
    })
    expect(baseCiText(ci('none', { total: 0 }))).toEqual({ mark: 'none', text: 'main 上没有 CI 检查' })
  })

  it('names at most three failing checks', () => {
    const failing = ['a', 'b', 'c', 'd'].map((name) => ({ name, runId: null, jobId: null }))
    expect(baseCiText(ci('failing', { failing })).text).toBe('main 上的 CI 失败 · a · b · c 等 4 项')
  })

  it('keeps the fresher answer for one commit, and takes any answer for a new one', () => {
    const fresh = ci('passing', {}, { checkedAt: 20 })
    expect(newerBaseCi(fresh, ci('pending', {}, { checkedAt: 10 }))).toBe(fresh)
    const next = ci('pending', {}, { checkedAt: 10, sha: 'b'.repeat(40) })
    expect(newerBaseCi(fresh, next)).toBe(next)
    expect(newerBaseCi(undefined, next)).toBe(next)
  })
})
