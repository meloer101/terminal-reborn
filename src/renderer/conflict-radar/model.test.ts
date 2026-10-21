import { describe, expect, it } from 'vitest'
import { MAX_PROMPT_CHARS } from '../panels/merge/model'
import { radarDetailLines, radarTargets, rebasePrompt } from './model'

describe('rebasePrompt', () => {
  const self = { base: 'main', branch: 'jacob/otter', behind: 2, baseConflicts: [], uncommitted: false }

  it('says the base moved and how to rebase without an editor', () => {
    expect(rebasePrompt(self)).toBe(
      'main 已经合入了别的改动，jacob/otter 落后 2 个提交。预计不会冲突。请在当前 worktree 里运行 GIT_EDITOR=true git rebase main，有冲突就解决后 git add 并 GIT_EDITOR=true git rebase --continue，确认构建和测试通过，完成后告诉我。'
    )
  })

  it('lists the files that will conflict and asks to commit first when there is uncommitted work', () => {
    const text = rebasePrompt({ ...self, uncommitted: true, baseConflicts: [{ path: 'src/app.ts', type: 'content' }, { path: 'a.md', type: 'modify/delete' }] })
    expect(text).toContain('rebase 时会冲突：src/app.ts（两边都改了同一处）、a.md（一边修改、一边删除）。')
    expect(text).toContain('先提交当前的改动，再运行 GIT_EDITOR=true git rebase main')
    expect(text).not.toContain('\n')
  })

  it('stays under the paste-placeholder threshold with many files', () => {
    const baseConflicts = Array.from({ length: 40 }, (_, i) => ({ path: `src/some/rather/long/path/number-${i}.ts`, type: 'content' }))
    const text = rebasePrompt({ ...self, baseConflicts })
    expect(text.length).toBeLessThanOrEqual(MAX_PROMPT_CHARS)
    expect(text).toContain('等 40 个文件')
  })
})

describe('radarTargets', () => {
  it('sends worktrees with sessions that are not archived, stamped with their latest turn end', () => {
    const projects = [{ id: 'p', name: 'demo', rootPath: '/r' }]
    const worktrees = [
      { id: 'w1', projectId: 'p', branch: 'a', path: '/w1', isMain: false },
      { id: 'w2', projectId: 'p', branch: 'b', path: '/w2', isMain: false },
      { id: 'w3', projectId: 'p', branch: 'c', path: '/w3', isMain: false, archived: { id: 'x', at: 1 } },
      { id: 'w4', projectId: 'p', branch: 'd', path: '/w4', isMain: false }
    ]
    const session = (id: string, worktreeId: string, finishedAt?: number) => ({ id, worktreeId, kind: 'claude' as const, title: id, status: 'idle' as const, startedAt: 1, lastActivityAt: 1, finishedAt })
    const sessions = [session('s1', 'w1', 10), session('s2', 'w1', 30), session('s3', 'w2'), session('s4', 'w3', 5)]
    expect(radarTargets({ projects, worktrees, sessions } as never)).toEqual([
      { root: '/r', worktree: '/w1', stamp: 30 },
      { root: '/r', worktree: '/w2', stamp: 0 }
    ])
  })
})

describe('radarDetailLines', () => {
  it('one line per partner and for the base, files in the value and reasons in the tooltip', () => {
    const self = {
      worktree: '/a',
      branch: 'jacob/a',
      base: 'main',
      ahead: 1,
      behind: 2,
      uncommitted: true,
      baseConflicts: [{ path: 'app.txt', type: 'content' }],
      baseMoved: true
    }
    const lines = radarDetailLines({
      tone: 'conflict',
      label: '和 jacob/b 会冲突',
      detail: '',
      pairs: [{ worktree: '/b', name: 'jacob/b', conflicts: [{ path: 'x.ts', type: 'content' }, { path: 'y.ts', type: 'add/add' }] }],
      self
    })
    expect(lines).toEqual([
      { label: '冲突', value: 'jacob/b · x.ts、y.ts', title: '和 jacob/b 会冲突：\nx.ts（两边都改了同一处）\ny.ts（两边都新增了这个文件）' },
      { label: '冲突', value: 'main · app.txt', title: '合并到 main 会冲突：\napp.txt（两边都改了同一处）' },
      { label: '落后', value: 'main 已前进，落后 2 个提交', title: 'main 已前进，落后 2 个提交' },
      { label: '', value: '含未提交的改动', title: '冲突检查包括还没提交的改动' }
    ])
  })
})
