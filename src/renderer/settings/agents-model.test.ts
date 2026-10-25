import { describe, expect, it } from 'vitest'
import { agentStatusNote, statusAccuracy, versionBelow } from './agents-model'

describe('设置 · 智能体 wording', () => {
  it('compares dotted versions', () => {
    expect(versionBelow('1.4.2', '2.0.0')).toBe(true)
    expect(versionBelow('2.1', '2.0.0')).toBe(false)
    expect(versionBelow('2.0.0-beta.1', '2.0.0')).toBe(false)
    expect(versionBelow('garbage', '2.0.0')).toBe(false)
  })

  it('says 准确 for hooks and OSC 7501, 估计 for titles or a version too old for its status source', () => {
    expect(statusAccuracy('gemini', '0.67.0')).toBe('准确')
    expect(statusAccuracy('grok', '1.0.67')).toBe('准确')
    expect(statusAccuracy('copilot', '1.0.103')).toBe('估计')
    expect(statusAccuracy('opencode', '1.4.2')).toBe('估计')
    expect(statusAccuracy('opencode', '2.1.4')).toBe('准确')
    expect(agentStatusNote('opencode', '1.4.2')).toBe('升级到 2.0.0 以上才有准确状态')
    expect(agentStatusNote('opencode', null)).toBeNull()
  })
})
