import { describe, expect, it } from 'vitest'
import type { MergePrecheck } from '@shared/git-merge'
import { agentSessionFor, checkLines, conflictPrompt, failureText, MAX_PROMPT_CHARS, methodOptions, removeBlocker, resultLines } from './model'

const check = (patch: Partial<MergePrecheck> = {}): MergePrecheck => ({
  branch: 'jacob/nav',
  base: 'main',
  head: 'h',
  baseHead: 'b',
  ahead: 3,
  behind: 0,
  conflicts: [],
  uncommitted: 0,
  baseCheckout: '/repo',
  upstream: null,
  upstreamAhead: 0,
  hasOrigin: true,
  blocker: null,
  ...patch
})

describe('checkLines', () => {
  it('a clean branch: ahead only', () => {
    expect(checkLines(check())).toEqual([{ tone: 'ok', text: '领先 main 3 个提交', meta: '↑3' }])
  })

  it('behind without conflicts merges cleanly; with conflicts it warns', () => {
    expect(checkLines(check({ behind: 2 }))[1]).toEqual({ tone: 'ok', text: 'main 有 2 个新提交，可以自动合并', meta: '↓2' })
    expect(checkLines(check({ behind: 1, conflicts: [{ path: 'a.ts', type: 'content' }] }))[1]).toEqual({
      tone: 'warn',
      text: 'main 有 1 个新提交，与本分支冲突',
      meta: '↓1'
    })
  })

  it('warns about uncommitted work and an upstream that was not pulled', () => {
    const lines = checkLines(check({ uncommitted: 2, upstream: 'origin/main', upstreamAhead: 4 }))
    expect(lines.map((l) => l.text)).toEqual(['领先 main 3 个提交', 'worktree 里有 2 个未提交的改动，不会合并进去', 'origin/main 有 4 个提交还没拉到本地 main'])
  })

  it('a blocker is the only line', () => {
    expect(checkLines(check({ blocker: { kind: 'busy', where: 'base', operation: 'rebase' } }))).toEqual([
      { tone: 'error', text: 'main 所在的目录正在变基，先完成或中止它' }
    ])
    expect(checkLines(check({ ahead: 0, blocker: { kind: 'nothing' } }))[0]).toMatchObject({ tone: 'error', text: 'jacob/nav 没有 main 之外的提交，没有要合并的内容' })
  })
})

describe('options', () => {
  it('rebase is off with uncommitted changes', () => {
    expect(methodOptions(check()).find((o) => o.value === 'rebase')?.disabled).toBe(false)
    expect(methodOptions(check({ uncommitted: 1 })).find((o) => o.value === 'rebase')?.disabled).toBe(true)
    expect(methodOptions(check({ uncommitted: null })).find((o) => o.value === 'rebase')?.disabled).toBe(true)
  })

  it('keeps the worktree when it has work or a running session', () => {
    expect(removeBlocker(check(), [{ status: 'done_unread' }], false)).toBeNull()
    expect(removeBlocker(check(), [], true)).toMatch('主目录')
    expect(removeBlocker(check({ uncommitted: 1 }), [], false)).toMatch('未提交')
    expect(removeBlocker(check(), [{ status: 'running' }], false)).toMatch('运行')
  })

  it('hands conflicts to the active agent session, else the first one', () => {
    const sessions = [
      { id: 's', kind: 'shell' as const },
      { id: 'a', kind: 'claude' as const },
      { id: 'b', kind: 'codex' as const }
    ]
    expect(agentSessionFor(sessions, 'b')?.id).toBe('b')
    expect(agentSessionFor(sessions, 's')?.id).toBe('a')
    expect(agentSessionFor([sessions[0]!], null)).toBeNull()
  })
})

describe('texts', () => {
  it('the conflict prompt is one line with files, reasons and GIT_EDITOR', () => {
    const prompt = conflictPrompt(check({ conflicts: [{ path: 'src/nav.css', type: 'content' }, { path: 'b.ts', type: 'modify/delete' }] }))
    expect(prompt).not.toContain('\n')
    expect(prompt).toContain('src/nav.css（两边都改了同一处）、b.ts（一边修改、一边删除）')
    expect(prompt).toContain('GIT_EDITOR=true git merge main')
  })

  it('the conflict prompt stays under the paste-placeholder threshold, counting the files it drops', () => {
    const conflicts = Array.from({ length: 30 }, (_, i) => ({ path: `src/components/very/deeply/nested/folder/file-${i}.tsx`, type: 'content' }))
    const prompt = conflictPrompt(check({ conflicts }))
    expect(prompt.length).toBeLessThanOrEqual(MAX_PROMPT_CHARS)
    expect(prompt).toContain('等 30 个文件')
    expect(prompt).toContain('file-0.tsx')
  })

  it('result lines: commit, push, removal', () => {
    expect(resultLines({ ok: true, commit: 'abcdef1234', push: '' }, 'main', 'removed').map((l) => l.text)).toEqual([
      '已合并到 main',
      '已推送到 origin/main',
      '已删除 worktree，分支保留'
    ])
    expect(resultLines({ ok: true, commit: 'abcdef1234', push: 'rejected' }, 'main', null)[1]).toEqual({ tone: 'warn', text: '推送失败：rejected' })
  })

  it('failure text says when a rebase already happened', () => {
    expect(failureText({ ok: false, reason: 'git', message: 'boom', rebased: true }, check())).toBe('没能合并（jacob/nav 已经变基到最新的 main 上）：boom')
  })
})
