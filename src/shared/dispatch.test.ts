import { describe, expect, it } from 'vitest'
import {
  ackReport,
  childBrief,
  childEvent,
  confirmLabels,
  DISPATCH_LIMITS,
  dispatchToolDefs,
  emptyQueue,
  enqueueReport,
  looksLikeReport,
  messagePage,
  parseStartArgs,
  parseToolResult,
  planChildren,
  reportText,
  startRefusal,
  takeAll,
  takeDue,
  titleFor,
  type ChildReport
} from './dispatch'

const both = ['claude', 'codex'] as const

describe('parseStartArgs', () => {
  it('accepts a batch in any direction and names each session', () => {
    const parsed = parseStartArgs(
      { sessions: [{ agent: 'codex', task: 'Fix the login bug\nin src/auth' }, { agent: 'claude', task: 'Write tests', title: '  Login   tests ', model: 'opus' }], reason: 'split work' },
      both
    )
    expect(parsed).toEqual({
      ok: true,
      request: {
        items: [
          { agent: 'codex', task: 'Fix the login bug\nin src/auth', title: 'Fix the login bug' },
          { agent: 'claude', task: 'Write tests', title: 'Login tests', model: 'opus' }
        ],
        reason: 'split work'
      }
    })
  })

  it('refuses an agent that is not installed, an empty task, a bad model and too many sessions', () => {
    expect(parseStartArgs({ sessions: [{ agent: 'codex', task: 'x' }] }, ['claude'])).toMatchObject({ ok: false, result: { failure: 'agent_unavailable' } })
    expect(parseStartArgs({ sessions: [{ agent: 'gemini', task: 'x' }] }, both)).toMatchObject({ ok: false, result: { failure: 'invalid_request' } })
    expect(parseStartArgs({ sessions: [{ agent: 'claude', task: '   ' }] }, both)).toMatchObject({ ok: false, result: { failure: 'invalid_request' } })
    expect(parseStartArgs({ sessions: [{ agent: 'claude', task: 'x', model: '--dangerously' }] }, both)).toMatchObject({ ok: false, result: { failure: 'invalid_request' } })
    expect(parseStartArgs({ sessions: Array.from({ length: 5 }, () => ({ agent: 'claude', task: 'x' })) }, both)).toMatchObject({ ok: false, result: { failure: 'limit' } })
    expect(parseStartArgs({}, both)).toMatchObject({ ok: false, result: { failure: 'invalid_request' } })
  })

  it('refuses a report fed back as a task', () => {
    expect(parseStartArgs({ sessions: [{ agent: 'claude', task: reportText([report({})]) }] }, both)).toMatchObject({ ok: false, result: { failure: 'not_allowed' } })
  })
})

describe('startRefusal', () => {
  const item = (task: string) => ({ agent: 'claude' as const, task, title: task })
  it('lets a dispatcher start up to the open limit', () => {
    expect(startRefusal({ isChild: false, toolsOn: true, openTasks: ['a'], items: [item('b'), item('c'), item('d')] })).toBeNull()
    expect(startRefusal({ isChild: false, toolsOn: true, openTasks: ['a', 'b'], items: [item('c'), item('d'), item('e')] })).toMatchObject({ failure: 'limit' })
  })
  it('keeps dispatch one level deep, off when the user turned it off, and refuses duplicates', () => {
    expect(startRefusal({ isChild: true, toolsOn: true, openTasks: [], items: [item('a')] })).toMatchObject({ failure: 'not_allowed' })
    expect(startRefusal({ isChild: false, toolsOn: false, openTasks: [], items: [item('a')] })).toMatchObject({ failure: 'not_allowed' })
    expect(startRefusal({ isChild: false, toolsOn: true, openTasks: ['Fix  the bug'], items: [item('Fix the bug ')] })).toMatchObject({ failure: 'duplicate' })
    expect(startRefusal({ isChild: false, toolsOn: true, openTasks: [], items: [item('x'), item('x')] })).toMatchObject({ failure: 'duplicate' })
  })
})

describe('childEvent', () => {
  const s = (status: Parameters<typeof childEvent>[0]['status'], exited = false) => ({ status, exited })
  it('reports a finished turn, an error and an exit once', () => {
    expect(childEvent(s('running'), s('done_unread'))).toBe('done')
    expect(childEvent(s('needs_you'), s('idle'))).toBe('done')
    expect(childEvent(s('running'), s('error'))).toBe('error')
    expect(childEvent(s('error'), s('error'))).toBeNull()
    expect(childEvent(s('idle'), s('idle', true))).toBe('exited')
    expect(childEvent(s('idle', true), s('exited', true))).toBeNull()
  })
  it('does not wake the dispatcher for a child that starts or waits for the user', () => {
    expect(childEvent(s('idle'), s('running'))).toBeNull()
    expect(childEvent(s('running'), s('needs_you'))).toBeNull()
    expect(childEvent(s('idle'), s('idle'))).toBeNull()
  })
})

function report(over: Partial<ChildReport>): ChildReport {
  return { childId: 's1', title: 'Fix login', agent: 'codex', event: 'done', branch: 'jacob/fix-login', turn: 1, ...over }
}

describe('reportText', () => {
  it('lists facts per child, frames them as not from the user and points to the tools', () => {
    const text = reportText([report({ changes: '+12 −3 · 2 个文件', checks: '测试 ✓', message: 'Fixed it.\nRan npm test.' })], [{ title: 'Write tests' }])
    expect(looksLikeReport(text)).toBe(true)
    expect(text).toContain('不是用户的指示')
    expect(text).toContain('— 「Fix login」 · Codex · 一轮结束 · 分支 jacob/fix-login · +12 −3 · 2 个文件 · 测试 ✓ · id s1')
    expect(text).toContain('  Fixed it.\n  Ran npm test.')
    expect(text).toContain('仍在进行：「Write tests」')
    expect(text).toContain('read_result')
  })
  it('says when a turn ended without a reply (a provider error, say)', () => {
    expect(reportText([report({})])).toContain('这一轮结束时没有留下回复，可能出错了')
    expect(reportText([report({ event: 'exited' })])).not.toContain('没有留下回复')
  })

  it('keeps excerpts within the shared budget', () => {
    const long = 'x'.repeat(DISPATCH_LIMITS.excerpt * 2)
    const text = reportText(Array.from({ length: 4 }, (_, i) => report({ childId: `s${i}`, message: long })))
    expect(text.length).toBeLessThan(DISPATCH_LIMITS.reportBudget + 2_000)
    expect(text).toContain('用 read_result 读')
  })
})

describe('report queue', () => {
  it('coalesces settles, supersedes per child and never repeats a turn', () => {
    let q = enqueueReport(emptyQueue(), report({ childId: 'a', turn: 1 }), 0)
    q = enqueueReport(q, report({ childId: 'a', turn: 2 }), 500)
    q = enqueueReport(q, report({ childId: 'b', turn: 1 }), 1000)
    expect(takeDue(q, 2000)).toMatchObject({ kind: 'wait', ms: DISPATCH_LIMITS.debounceMs - 1000 })
    const due = takeDue(q, 1000 + DISPATCH_LIMITS.debounceMs)
    expect(due.kind).toBe('send')
    if (due.kind !== 'send') return
    expect(due.batch.map((r) => `${r.childId}:${r.turn}`)).toEqual(['a:2', 'b:1'])
    expect(enqueueReport(due.queue, report({ childId: 'a', turn: 2 }), 9000).pending).toEqual([])
  })

  it('drops a pending report the dispatcher read itself', () => {
    const q = ackReport(enqueueReport(emptyQueue(), report({ childId: 'a' }), 0), 'a')
    expect(takeDue(q, 60_000).kind).toBe('none')
  })

  it('holds reports over the hourly wake budget until the user sends them', () => {
    let q = { ...emptyQueue(), sent: Array.from({ length: DISPATCH_LIMITS.wakesPerHour }, (_, i) => i * 1000) }
    q = enqueueReport(q, report({}), 30_000)
    expect(takeDue(q, 40_000).kind).toBe('held')
    expect(takeAll(q).batch).toHaveLength(1)
    expect(takeDue(q, 2 * 60 * 60_000).kind).toBe('send')
  })
})

describe('the rest', () => {
  it('pages long messages', () => {
    const message = 'y'.repeat(DISPATCH_LIMITS.readPage + 10)
    expect(messagePage(message)).toEqual({ text: 'y'.repeat(DISPATCH_LIMITS.readPage), nextOffset: DISPATCH_LIMITS.readPage })
    expect(messagePage(message, DISPATCH_LIMITS.readPage)).toEqual({ text: 'y'.repeat(10), nextOffset: null })
  })
  it('briefs the child with where it works and what its last message is for', () => {
    const brief = childBrief({ task: 'Do X', parentTitle: 'Plan auth', parentAgent: 'claude', branch: 'jacob/x', base: 'main' })
    expect(brief).toContain('Claude Code（会话「Plan auth」）')
    expect(brief).toContain('分支 jacob/x，基于 main')
    expect(brief).toContain('\n\nDo X\n\n')
    expect(brief).toContain('BLOCKED:')
  })
  it('lists the installed agents in the start tool and validates results', () => {
    const [start] = dispatchToolDefs(['codex'])
    expect(JSON.stringify(start?.inputSchema)).toContain('"enum":["codex"]')
    expect(start?.description).toContain('end your turn')
    expect(parseToolResult({ ok: false, failure: 'declined', text: 'no' })).toEqual({ ok: false, failure: 'declined', text: 'no' })
    expect(parseToolResult({ ok: false, failure: 'nope', text: 'no' })).toBeNull()
    expect(titleFor('a'.repeat(200)).length).toBe(DISPATCH_LIMITS.title)
  })
})

describe('planChildren', () => {
  it('names each worktree after its title, unique against the repository and the batch', () => {
    const plans = planChildren({
      items: [
        { agent: 'codex', task: 'a', title: 'Fix login' },
        { agent: 'claude', task: 'b', title: 'Fix login' },
        { agent: 'claude', task: 'c', title: '修复登录' }
      ],
      root: '/code/acme',
      base: 'jacob/plan',
      prefix: 'jacob',
      branches: ['main', 'jacob/fix-login'],
      worktreesDir: '/h/.tr/worktrees/acme',
      takenFolders: [],
      prepare: true,
      random: () => 0
    })
    expect(plans.map((p) => p.branch)).toEqual(['jacob/fix-login-2', 'jacob/fix-login-3', 'jacob/amber-badger'])
    expect(plans[0]?.request).toEqual({ root: '/code/acme', branch: 'jacob/fix-login-2', base: 'jacob/plan', folder: plans[0]?.request.folder, prepare: true })
    expect(new Set(plans.map((p) => p.path)).size).toBe(3)
  })
})

describe('confirmLabels', () => {
  it('says how many sessions each dispatcher is waiting to start, adding up its batches', () => {
    const labels = confirmLabels([
      { parentId: 'a', count: 2 },
      { parentId: 'b', count: 1 },
      { parentId: 'a', count: 1 }
    ])
    expect([...labels]).toEqual([
      ['a', '想开 3 个会话'],
      ['b', '想开 1 个会话']
    ])
    expect(confirmLabels([]).size).toBe(0)
  })
})
