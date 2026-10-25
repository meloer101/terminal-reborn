import { describe, expect, it } from 'vitest'
import { autoBody, shipAction, shipBlocker, shipButtonLabel } from './ship-model'

describe('shipAction', () => {
  it('commits first when there is uncommitted work, pushes to an open PR, and only opens a PR with nothing to send', () => {
    expect(shipAction({ uncommitted: 3, openPr: null, unpushed: false })).toEqual({ kind: 'sheet', mode: 'pr', commit: true, label: '提交并创建 PR' })
    expect(shipAction({ uncommitted: 0, openPr: null, unpushed: false })).toEqual({ kind: 'sheet', mode: 'pr', commit: false, label: '创建 PR' })
    expect(shipAction({ uncommitted: 1, openPr: { number: 7 }, unpushed: false })).toEqual({ kind: 'sheet', mode: 'push', commit: true, label: '提交并推送' })
    expect(shipAction({ uncommitted: 0, openPr: { number: 7 }, unpushed: true })).toEqual({ kind: 'sheet', mode: 'push', commit: false, label: '推送到 PR #7' })
    expect(shipAction({ uncommitted: 0, openPr: { number: 7 }, unpushed: false })).toEqual({ kind: 'open', number: 7, label: '打开 PR #7' })
  })

  it('names the primary button after what it will do', () => {
    expect(shipButtonLabel('pr', true)).toBe('提交并创建 PR')
    expect(shipButtonLabel('pr', false)).toBe('创建 PR')
    expect(shipButtonLabel('push', true)).toBe('提交并推送')
    expect(shipButtonLabel('push', false)).toBe('推送')
  })
})

describe('shipBlocker', () => {
  const ok = { mode: 'pr' as const, ticked: 2, message: 'Fix nav', title: '导航', ahead: 0, unpushed: null, remoteAhead: 0, remote: 'origin' }
  it('lets a commit stand in for the commits a PR needs', () => {
    expect(shipBlocker(ok)).toBeNull()
    expect(shipBlocker({ ...ok, ticked: 0 })).toBe('没有比基线新的提交：勾选要提交的文件')
    expect(shipBlocker({ ...ok, ticked: 0, ahead: 2 })).toBeNull()
  })

  it('wants a message to commit, a title for a PR, something to push, and no commits only the remote has', () => {
    expect(shipBlocker({ ...ok, message: '  \n' })).toBe('写一句提交说明')
    expect(shipBlocker({ ...ok, title: ' ' })).toBe('写一个标题')
    expect(shipBlocker({ ...ok, mode: 'push', title: '', ticked: 0, unpushed: 0 })).toBe('没有要推送的提交')
    expect(shipBlocker({ ...ok, mode: 'push', title: '', ticked: 0, unpushed: 2 })).toBeNull()
    expect(shipBlocker({ ...ok, remoteAhead: 1 })).toBe('origin 上的分支有 1 个本地没有的提交：先拉取或 rebase')
  })
})

describe('autoBody', () => {
  it('lists the commit about to be made after the ones already there', () => {
    expect(autoBody(['Make nav sticky'], 'Test nav\n\nmore')).toBe('- Make nav sticky\n- Test nav')
    expect(autoBody(['Make nav sticky'], null)).toBe('- Make nav sticky')
    expect(autoBody([], '')).toBe('')
  })
})
