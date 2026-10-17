import { describe, expect, it } from 'vitest'
import {
  closeSessionConfirmation,
  countActive,
  decideQuit,
  hostRestartDelay,
  quitConfirmation,
  endSessionsQuitConfirmation,
  removeProjectConfirmation,
  removeProjectMenuLabel,
  viewMenuItems
} from './lifecycle'

describe('countActive', () => {
  it('counts running and needs_you only', () => {
    expect(countActive(['running', 'needs_you', 'idle', 'done_unread', 'error', 'exited'])).toBe(2)
    expect(countActive([])).toBe(0)
  })
})

describe('decideQuit', () => {
  it('quits straight away with nothing active', () => {
    expect(decideQuit({ active: 0, forced: false })).toBe('quit')
  })
  it('asks while sessions are active', () => {
    expect(decideQuit({ active: 3, forced: false })).toBe('confirm')
  })
  it('never blocks an OS-forced quit', () => {
    expect(decideQuit({ active: 3, forced: true })).toBe('quit')
  })

  it('does not ask when the sessions keep running in the pty daemon', () => {
    expect(decideQuit({ active: 3, forced: false, keepsSessions: true })).toBe('quit')
  })
})

describe('confirmations', () => {
  it('words the quit prompt with the count', () => {
    const c = quitConfirmation(2)
    expect(c.message).toBe('有 2 个会话正在运行或等你处理，退出会中断它们。')
    expect(c.confirmLabel).toBe('退出')
    expect(c.cancelLabel).toBe('取消')
  })
  it('confirms closing only running / waiting sessions', () => {
    expect(closeSessionConfirmation('a', 'running')).not.toBeNull()
    expect(closeSessionConfirmation('a', 'needs_you')).not.toBeNull()
    for (const status of ['idle', 'done_unread', 'error', 'exited'] as const) {
      expect(closeSessionConfirmation('a', status)).toBeNull()
    }
  })
  it('confirms removing a project only when it has active sessions', () => {
    expect(removeProjectConfirmation('p', 0)).toBeNull()
    expect(removeProjectConfirmation('p', 2)?.message).toContain('2 个会话')
  })
  it('labels the remove-project menu item with the session count', () => {
    expect(removeProjectMenuLabel(0)).toBe('从侧栏移除项目')
    expect(removeProjectMenuLabel(3)).toBe('移除项目并关闭 3 个会话')
  })
})

describe('viewMenuItems', () => {
  it('drops reload and devtools from packaged builds', () => {
    expect(viewMenuItems(true)).toEqual(['togglefullscreen'])
    expect(viewMenuItems(false)).toContain('reload')
    expect(viewMenuItems(false)).toContain('toggleDevTools')
  })
})

describe('hostRestartDelay', () => {
  it('backs off and caps', () => {
    expect(hostRestartDelay(1)).toBe(500)
    expect(hostRestartDelay(2)).toBe(1000)
    expect(hostRestartDelay(20)).toBe(30_000)
  })
})

describe('endSessionsQuitConfirmation', () => {
  it('asks only while sessions are active', () => {
    expect(endSessionsQuitConfirmation(0)).toBeNull()
    expect(endSessionsQuitConfirmation(2)).toMatchObject({ confirmLabel: '结束并退出', destructive: true })
  })
})
