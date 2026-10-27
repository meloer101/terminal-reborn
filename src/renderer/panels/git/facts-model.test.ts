import { describe, expect, it } from 'vitest'
import type { CheckKind, KindStatus, TurnCheckView } from '@shared/turn-checks'
import { checksRow } from './facts-model'

const view = (kinds: [CheckKind, KindStatus][], turn: TurnCheckView['turn'] = 'current'): TurnCheckView => ({
  turn,
  edited: true,
  kinds: kinds.map(([kind, status]) => ({ kind, status, runs: [] })),
  runs: []
})

describe('checksRow', () => {
  it('nothing ran is a dash, not a tick', () => {
    expect(checksRow(view([['test', 'not-run'], ['lint', 'not-run'], ['typecheck', 'not-run']]))).toEqual({ tone: 'none', text: '这一轮没跑检查' })
    expect(checksRow(view([], 'previous'))).toEqual({ tone: 'none', text: '上一轮没跑检查' })
  })

  it('a tick only when every check that ran passed', () => {
    expect(checksRow(view([['test', 'pass'], ['lint', 'pass'], ['typecheck', 'not-run']]))).toEqual({ tone: 'ok', text: '这一轮跑过：测试 ✓ · lint ✓ · 类型 未跑' })
    expect(checksRow(view([['test', 'pass'], ['lint', 'unknown']])).tone).toBe('none')
  })

  it('a failure wins', () => {
    expect(checksRow(view([['test', 'fail'], ['lint', 'unknown']]))).toEqual({ tone: 'fail', text: '这一轮跑过：测试 ✗ · lint ?' })
  })
})
