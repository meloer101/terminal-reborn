import { describe, expect, it } from 'vitest'
import { beforeFix, brakeDecision, brakeLabel, failureKey, type BrakeInput } from './auto-fix-brakes'

const cleanDiff = ['diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1 +1 @@', '-const a = 1', '+const a = 2', ''].join('\n')
const deletedTestDiff = [
  'diff --git a/src/a.test.ts b/src/a.test.ts',
  '--- a/src/a.test.ts',
  '+++ b/src/a.test.ts',
  '@@ -1,2 +1 @@',
  "-it('one', () => {",
  ' })',
  ''
].join('\n')
const depsDiff = ['diff --git a/package.json b/package.json', '--- a/package.json', '+++ b/package.json', '@@ -1 +1 @@', '-a', '+b', ''].join('\n')

function input(patch: Partial<BrakeInput> = {}): BrakeInput {
  return {
    fixDiff: cleanDiff,
    failureKey: 'test#abc',
    previousKeys: [],
    attempts: 0,
    maxAttempts: 3,
    headMoved: true,
    failingChecks: ['test'],
    baseFailing: null,
    ...patch
  }
}

describe('brakeDecision', () => {
  it('pushes a clean fix', () => {
    expect(brakeDecision(input())).toEqual({ kind: 'push' })
  })

  it('stops when the agent committed nothing', () => {
    expect(brakeDecision(input({ headMoved: false }))).toEqual({ kind: 'stop', reason: 'no-progress' })
  })

  it('stops a fix that deletes a test, with the markers', () => {
    expect(brakeDecision(input({ fixDiff: deletedTestDiff }))).toEqual({
      kind: 'stop',
      reason: 'weakened',
      markers: [{ kind: 'test-deleted', path: 'src/a.test.ts', count: 1 }]
    })
  })

  it('stops a fix that touches CI config or silences a check', () => {
    const ci = ['diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml', '--- a/.github/workflows/ci.yml', '+++ b/.github/workflows/ci.yml', '@@ -1 +1 @@', '-a', '+b', ''].join('\n')
    expect(brakeDecision(input({ fixDiff: ci }))).toMatchObject({ kind: 'stop', reason: 'weakened' })
    const silenced = cleanDiff.replace('+const a = 2', '+// @ts-ignore')
    expect(brakeDecision(input({ fixDiff: silenced }))).toMatchObject({ kind: 'stop', reason: 'weakened' })
  })

  it('does not treat dependency or migration changes as weakening', () => {
    expect(brakeDecision(input({ fixDiff: depsDiff }))).toEqual({ kind: 'push' })
  })

  it('stops on the same failure answered before', () => {
    expect(brakeDecision(input({ previousKeys: ['other', 'test#abc'] }))).toEqual({ kind: 'stop', reason: 'repeated' })
    expect(brakeDecision(input({ previousKeys: ['other'] }))).toEqual({ kind: 'push' })
  })

  it('stops at the attempt cap', () => {
    expect(brakeDecision(input({ attempts: 3 }))).toEqual({ kind: 'stop', reason: 'limit', attempts: 3 })
    expect(brakeDecision(input({ attempts: 2 }))).toEqual({ kind: 'push' })
  })

  it('checks in order: no-progress, weakened, repeated, limit', () => {
    const all = input({ fixDiff: deletedTestDiff, previousKeys: ['test#abc'], attempts: 9 })
    expect(brakeDecision({ ...all, headMoved: false })).toMatchObject({ reason: 'no-progress' })
    expect(brakeDecision(all)).toMatchObject({ reason: 'weakened' })
    expect(brakeDecision({ ...all, fixDiff: cleanDiff })).toMatchObject({ reason: 'repeated' })
    expect(brakeDecision({ ...all, fixDiff: cleanDiff, previousKeys: [] })).toMatchObject({ reason: 'limit' })
  })
})

describe('beforeFix', () => {
  it('fixes when the base is not known to fail', () => {
    expect(beforeFix({ failingChecks: ['test'], baseFailing: null })).toEqual({ kind: 'fix' })
  })

  it('fixes when the base is green or fails something else', () => {
    expect(beforeFix({ failingChecks: ['test'], baseFailing: [] })).toEqual({ kind: 'fix' })
    expect(beforeFix({ failingChecks: ['test'], baseFailing: ['lint'] })).toEqual({ kind: 'fix' })
  })

  it('fixes when only some failing checks also fail on the base', () => {
    expect(beforeFix({ failingChecks: ['test', 'lint'], baseFailing: ['lint'] })).toEqual({ kind: 'fix' })
  })

  it('asks when every failing check also fails on the base', () => {
    expect(beforeFix({ failingChecks: ['test', 'lint'], baseFailing: ['lint', 'test', 'build'] })).toEqual({
      kind: 'ask',
      reason: 'base-broken',
      checks: ['test', 'lint']
    })
  })

  it('fixes when there are no failing checks to compare', () => {
    expect(beforeFix({ failingChecks: [], baseFailing: ['test'] })).toEqual({ kind: 'fix' })
  })
})

describe('failureKey', () => {
  const log = ['FAIL src/a.test.ts', 'expected 1 to be 2', '  at src/a.test.ts:12:5'].join('\n')

  it('does not depend on the order of the checks', () => {
    expect(failureKey(['b', 'a'], log)).toBe(failureKey(['a', 'b'], log))
    expect(failureKey(['b', 'a'], log).startsWith('a,b#')).toBe(true)
  })

  it('is stable', () => {
    expect(failureKey(['test'], log)).toBe(failureKey(['test'], log))
  })

  it('ignores timestamps, durations, hex ids and numbers', () => {
    const a = ['build\tstep\t2026-10-20T10:00:01.123Z Run 12345 failed in 1.5s', 'commit deadbeef1234 tests: 3 failed (212ms)', 'at 10:01:02 on 0xabcdef'].join('\n')
    const b = ['build\tstep\t2026-10-21T22:15:59.999Z Run 99999 failed in 12s', 'commit 0123456789ab tests: 7 failed (5ms)', 'at 23:59:00 on 0x123'].join('\n')
    expect(failureKey(['test'], a)).toBe(failureKey(['test'], b))
  })

  it('differs for a different failure or different checks', () => {
    expect(failureKey(['test'], log)).not.toBe(failureKey(['test'], 'FAIL src/b.test.ts\nTypeError: x is not a function'))
    expect(failureKey(['test'], log)).not.toBe(failureKey(['lint'], log))
  })

  it('only looks at the last 20 lines', () => {
    const tail = Array.from({ length: 20 }, (_, i) => `line ${String.fromCharCode(97 + i)}`).join('\n')
    expect(failureKey(['t'], `early noise\n${tail}`)).toBe(failureKey(['t'], `different noise\nmore\n${tail}`))
    expect(failureKey(['t'], `${tail}\nnew last line`)).not.toBe(failureKey(['t'], tail))
  })

  it('handles an empty log', () => {
    expect(failureKey(['test'], '')).toMatch(/^test#/)
  })
})

describe('brakeLabel', () => {
  it('weakened names the first marker', () => {
    const decision = brakeDecision(input({ fixDiff: deletedTestDiff }))
    if (decision.kind !== 'stop') throw new Error('expected stop')
    expect(brakeLabel(decision)).toBe('自动修复已停：这次修复删了 1 个测试')
  })

  it('weakened without markers still reads', () => {
    expect(brakeLabel({ kind: 'stop', reason: 'weakened' })).toBe('自动修复已停：这次修复放宽了检查')
  })

  it('the other reasons', () => {
    expect(brakeLabel({ kind: 'stop', reason: 'repeated' })).toBe('自动修复已停：同一个失败又出现了')
    expect(brakeLabel({ kind: 'stop', reason: 'limit' }, 3)).toBe('自动修复已停：已经修了 3 次')
    expect(brakeLabel({ kind: 'stop', reason: 'limit', attempts: 2 })).toBe('自动修复已停：已经修了 2 次')
    expect(brakeLabel({ kind: 'stop', reason: 'no-progress' })).toBe('自动修复已停：这一轮没有新的提交')
    expect(brakeLabel({ kind: 'ask', reason: 'base-broken', checks: ['test', 'lint'] })).toBe('基线上本来就失败：test、lint')
  })
})
