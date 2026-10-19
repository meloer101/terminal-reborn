import { describe, expect, it } from 'vitest'
import { archiveBlocker, archivedAgo, archiveRefName, newArchiveId, sessionIdsToStop, shouldRunArchiveScript } from './archive'

describe('shouldRunArchiveScript', () => {
  it('runs only an approved archive script and still lets the caller snapshot after a decline', () => {
    expect(shouldRunArchiveScript('approved')).toBe(true)
    expect(shouldRunArchiveScript('declined')).toBe(false)
    expect(shouldRunArchiveScript('none')).toBe(false)
  })
})

describe('archiveBlocker', () => {
  it('refuses the main checkout and a worktree whose agent is running or waiting (Figma 16D)', () => {
    expect(archiveBlocker([{ status: 'idle' }, { status: 'exited' }], false)).toBeNull()
    expect(archiveBlocker([{ status: 'done_unread' }], false)).toBeNull()
    expect(archiveBlocker([{ status: 'running' }], false)).toBe('会话还在运行，先停下来再归档')
    expect(archiveBlocker([{ status: 'needs_you' }], false)).toBe('会话还在运行，先停下来再归档')
    expect(archiveBlocker([], true)).toBe('项目主目录不能归档')
  })
})

describe('sessionIdsToStop', () => {
  it('stops every session of the worktree records', () => {
    const sessions = [
      { id: 's1', worktreeId: 'w1' },
      { id: 's2', worktreeId: 'w2' },
      { id: 's3', worktreeId: 'w1b' }
    ]
    expect(sessionIdsToStop(sessions, ['w1', 'w1b'])).toEqual(['s1', 's3'])
    expect(sessionIdsToStop(sessions, ['missing'])).toEqual([])
  })
})

describe('ids and ages', () => {
  it('makes ids that are safe ref names', () => {
    const id = newArchiveId(1_760_000_000_000, 0.5)
    expect(archiveRefName(id)).toBe(`refs/wavi/archive/${id}`)
    expect(archiveRefName('../heads/main')).toBeNull()
  })

  it('says how long ago', () => {
    expect(archivedAgo(0, 30_000)).toBe('刚刚归档')
    expect(archivedAgo(0, 5 * 60_000)).toBe('5 分钟前归档')
    expect(archivedAgo(0, 3 * 3_600_000)).toBe('3 小时前归档')
    expect(archivedAgo(0, 2 * 86_400_000)).toBe('2 天前归档')
  })
})
