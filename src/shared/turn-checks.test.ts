import { describe, expect, it } from 'vitest'
import {
  beginTurn,
  checksDescription,
  checksText,
  checksVerdict,
  emptyTurnChecks,
  kindStatus,
  MAX_RUNS,
  recordEdit,
  recordRuns,
  runNote,
  turnCheckView,
  type CheckRun,
  type TurnChecks
} from './turn-checks'

const run = (kind: CheckRun['kind'], command: string, outcome: CheckRun['outcome'], at: number, full = true): CheckRun => ({
  kind,
  command,
  outcome,
  basis: outcome === 'unknown' ? 'none' : 'exit',
  full,
  at
})

const view = (checks: TurnChecks) => {
  const v = turnCheckView(checks)
  return v && { turn: v.turn, text: checksText(v) }
}

describe('turn checks', () => {
  it('says nothing for a turn that neither edited nor checked', () => {
    expect(turnCheckView(emptyTurnChecks())).toBeNull()
    expect(turnCheckView(undefined)).toBeNull()
  })

  it('says 没跑检查 when the turn edited files and ran none', () => {
    const t = recordEdit(beginTurn(emptyTurnChecks(), 10))
    expect(view(t)).toEqual({ turn: 'current', text: '没跑检查' })
    const v = turnCheckView(t)
    expect(v && checksDescription(v)).toBe('这一轮改了文件，没跑检查')
    expect(v && checksVerdict(v, 'Claude')).toEqual({ tone: 'warn', text: 'Claude 这一轮改了文件，没跑检查' })
  })

  it('keeps the latest run of each check and orders kinds test · lint · typecheck · build', () => {
    let t = beginTurn(emptyTurnChecks(), 10)
    t = recordRuns(t, [run('lint', 'npm run lint', 'fail', 11)])
    t = recordRuns(t, [run('test', 'npm test', 'pass', 12)])
    t = recordRuns(t, [run('lint', 'npm run lint', 'pass', 13)])
    expect(t.runs.map((r) => `${r.kind}:${r.outcome}`)).toEqual(['test:pass', 'lint:pass'])
    expect(view(t)?.text).toBe('测试 ✓ · lint ✓')
  })

  it('fails a kind while one of its checks last failed, unless a later full run passed', () => {
    expect(kindStatus([run('test', 'npm test', 'fail', 1), run('test', 'vitest run a.test.ts', 'pass', 2, false)])).toBe('fail')
    expect(kindStatus([run('test', 'vitest run a.test.ts', 'fail', 1, false), run('test', 'npm test', 'pass', 2)])).toBe('pass')
    expect(kindStatus([run('test', 'npm test', 'pass', 1), run('test', 'vitest run a.test.ts', 'fail', 2, false)])).toBe('fail')
    expect(kindStatus([run('test', 'npm test | tail', 'unknown', 1), run('test', 'pytest a', 'pass', 2, false)])).toBe('unknown')
  })

  it('says 未跑 for kinds the session ran in earlier turns', () => {
    let t = beginTurn(emptyTurnChecks(), 1)
    t = recordRuns(t, [run('test', 'npm test', 'pass', 2), run('typecheck', 'tsc', 'pass', 2), run('build', 'vite build', 'pass', 2)])
    t = beginTurn(t, 10)
    t = recordEdit(t)
    t = recordRuns(t, [run('test', 'npm test', 'pass', 11), run('lint', 'eslint .', 'fail', 12)])
    expect(t.known).toEqual(['test', 'typecheck', 'build'])
    // A build is not expected every turn.
    expect(view(t)?.text).toBe('测试 ✓ · lint ✗ · 类型 未跑')
    const v = turnCheckView(t)
    expect(v && checksDescription(v)).toBe('这一轮：测试通过，lint 没过，类型检查没跑')
    expect(v && checksVerdict(v, 'Codex')).toEqual({ tone: 'error', text: 'Codex 这一轮的 lint 没过' })
  })

  it('shows the last turn that did something while this one has not (上一轮), and drops it once this one edits', () => {
    let t = beginTurn(emptyTurnChecks(), 1)
    t = recordEdit(t)
    t = recordRuns(t, [run('test', 'npm test', 'fail', 2)])
    t = beginTurn(t, 10)
    expect(view(t)).toEqual({ turn: 'previous', text: '测试 ✗' })
    // A turn that only answered a question keeps the same 上一轮.
    t = beginTurn(t, 20)
    expect(view(t)).toEqual({ turn: 'previous', text: '测试 ✗' })
    const v = turnCheckView(t)
    expect(v && checksVerdict(v, 'Claude').text).toBe('Claude 上一轮的测试没过')
    t = recordEdit(t)
    expect(t.previous).toBeUndefined()
    expect(view(t)).toEqual({ turn: 'current', text: '测试 未跑' })
  })

  it('words the merge line by the worst outcome', () => {
    const at = (runs: CheckRun[], known: CheckRun['kind'][] = []) => {
      const v = turnCheckView({ since: 1, edited: true, runs, known })
      return v && checksVerdict(v, 'Claude')
    }
    expect(at([run('test', 'npm test', 'pass', 2), run('lint', 'eslint .', 'pass', 3)])).toEqual({ tone: 'ok', text: 'Claude 这一轮跑过的检查都通过了' })
    expect(at([run('test', 'npm test | tail', 'unknown', 2)])).toEqual({ tone: 'warn', text: 'Claude 这一轮跑了测试，看不出结果' })
    expect(at([run('test', 'npm test', 'pass', 2)], ['typecheck'])).toEqual({ tone: 'warn', text: 'Claude 这一轮没跑类型检查' })
  })

  it('caps the runs it keeps', () => {
    let t = beginTurn(emptyTurnChecks(), 1)
    for (let i = 0; i < MAX_RUNS + 5; i++) t = recordRuns(t, [run('test', `vitest run f${i}.test.ts`, 'pass', i + 2, false)])
    expect(t.runs).toHaveLength(MAX_RUNS)
    expect(t.runs[0]?.command).toBe('vitest run f5.test.ts')
  })

  it('notes how a result is known when no exit code said it', () => {
    expect(runNote({ ...run('test', 'pytest', 'pass', 1), basis: 'output' })).toBe('按输出判断')
    expect(runNote(run('test', 'pytest | tail', 'unknown', 1))).toBe('看不出结果')
    expect(runNote(run('test', 'pytest', 'fail', 1))).toBeUndefined()
  })
})
