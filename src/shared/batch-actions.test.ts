import { describe, expect, it } from 'vitest'
import { batchButtonLabel, batchConfirmation, batchPlan, batchResultText, rangeBetween, recipientsLine, skippedText, togglePicked, type BatchCandidate } from './batch-actions'

const c = (id: string, patch: Partial<BatchCandidate> = {}): BatchCandidate => ({ id, kind: 'claude', title: id, status: 'idle', ...patch })

const picked = [
  c('登录页', { status: 'running' }),
  c('修测试', { kind: 'codex', status: 'done_unread' }),
  c('终端', { kind: 'shell' }),
  c('旧会话', { status: 'exited', phase: 'exited' })
]

describe('batchPlan', () => {
  it('sends to agents that have not exited, and says why the others are skipped', () => {
    const plan = batchPlan('send', picked)
    expect(plan.targets.map((t) => t.id)).toEqual(['登录页', '修测试'])
    expect(skippedText(plan)).toBe('跳过 2 个：终端不是 agent（终端）；已退出（旧会话）')
    expect(recipientsLine(plan)).toBe('发给：登录页、修测试')
  })

  it('stops only agents that are running; closes everything', () => {
    expect(batchPlan('stop', picked).targets.map((t) => t.id)).toEqual(['登录页'])
    expect(batchPlan('close', picked).targets).toHaveLength(4)
  })
})

describe('labels and confirmations', () => {
  it('names the count on every button', () => {
    expect(batchButtonLabel('send', 2)).toBe('发送给 2 个…')
    expect(batchButtonLabel('stop', 1)).toBe('停止 1 个')
    expect(batchButtonLabel('close', 4)).toBe('关闭 4 个')
  })

  it('quotes the message and lists every recipient before sending', () => {
    const confirm = batchConfirmation(batchPlan('send', picked), '先别改 API，\n只改界面')
    expect(confirm).toEqual({
      message: '把这段话发给 2 个会话并按回车？',
      detail: '“先别改 API， 只改界面”\n\n发给：登录页、修测试\n每个会话各算一轮，用你自己的额度。\n跳过 2 个：终端不是 agent（终端）；已退出（旧会话）',
      confirmLabel: '发送给 2 个',
      cancelLabel: '取消'
    })
  })

  it('keeps the dialog within what main accepts', () => {
    const many = Array.from({ length: 30 }, (_, i) => c(`一个很长很长的会话标题 ${i}`))
    const confirm = batchConfirmation(batchPlan('send', many), 'x'.repeat(5000))
    expect([...(confirm?.detail ?? '')].length).toBeLessThanOrEqual(480)
  })

  it('warns before closing running sessions and asks nothing when no session is reached', () => {
    expect(batchConfirmation(batchPlan('close', picked))).toMatchObject({
      message: '关闭 4 个会话？',
      destructive: true,
      detail: '其中 1 个正在运行或等你处理，关闭会中断它们。\nworktree 和分支都留着。\n关闭：登录页、修测试、终端、旧会话'
    })
    expect(batchConfirmation(batchPlan('stop', [c('a')]))).toBeNull()
  })

  it('reports what did not go through', () => {
    expect(batchResultText('send', 3, [])).toBe('已发送给 3 个')
    expect(batchResultText('send', 1, [{ title: '修测试', message: '终端里有选择框' }])).toBe('已发送给 1 个，1 个没发出去：修测试（终端里有选择框）')
  })
})

describe('picking', () => {
  it('⇧ picks the range from the anchor, ⌘ toggles one', () => {
    const order = ['a', 'b', 'c', 'd']
    expect(rangeBetween(order, 'c', 'a')).toEqual(['a', 'b', 'c'])
    expect(rangeBetween(order, null, 'b')).toEqual(['b'])
    expect(togglePicked(['a', 'c'], 'c')).toEqual(['a'])
    expect(togglePicked(['a'], 'd')).toEqual(['a', 'd'])
  })
})
