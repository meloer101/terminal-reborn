import { describe, expect, it } from 'vitest'
import { applySettingsPatch, DEFAULT_SETTINGS, sanitizeSettings } from './settings'

describe('sanitizeSettings', () => {
  it('returns defaults for garbage', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(sanitizeSettings('nope')).toEqual(DEFAULT_SETTINGS)
    expect(sanitizeSettings({ appearance: 42 })).toEqual(DEFAULT_SETTINGS)
  })

  it('clamps numbers and rejects bad values field by field', () => {
    const s = sanitizeSettings({
      appearance: { fontSize: 100, lineHeight: 0.2, terminalOpacity: 0.1, theme: 'neon', latinFont: '  Menlo ', ligatures: 'yes' }
    })
    expect(s.appearance.fontSize).toBe(28)
    expect(s.appearance.lineHeight).toBe(1)
    expect(s.appearance.terminalOpacity).toBe(0.5)
    expect(s.appearance.theme).toBe('system')
    expect(s.appearance.latinFont).toBe('Menlo')
    expect(s.appearance.ligatures).toBe(false)
  })

  it('drops the old gradient / image background: the terminal follows the theme (v1.2)', () => {
    const s = sanitizeSettings({ appearance: { background: { kind: 'gradient', from: '#1f1f1f', to: '#050505', angle: 160 }, fontSize: 14 } })
    expect(s.appearance).not.toHaveProperty('background')
    expect(s.appearance.fontSize).toBe(14)
  })
})

describe('applySettingsPatch', () => {
  it('merges appearance fields and keeps the rest', () => {
    const next = applySettingsPatch(DEFAULT_SETTINGS, { appearance: { cjkFont: 'Noto Sans SC', fontSize: 14 } })
    expect(next.appearance.cjkFont).toBe('Noto Sans SC')
    expect(next.appearance.fontSize).toBe(14)
    expect(next.appearance.latinFont).toBe(DEFAULT_SETTINGS.appearance.latinFont)
  })

  it('keeps the TR_PORT base whole and in range (PRD F4)', () => {
    expect(DEFAULT_SETTINGS.ports.base).toBe(41000)
    expect(applySettingsPatch(DEFAULT_SETTINGS, { ports: { base: 50000 } }).ports.base).toBe(50000)
    expect(applySettingsPatch(DEFAULT_SETTINGS, { ports: { base: 80 } }).ports.base).toBe(1024)
    expect(applySettingsPatch(DEFAULT_SETTINGS, { ports: { base: 'x' } }).ports.base).toBe(41000)
    expect(applySettingsPatch(DEFAULT_SETTINGS, { appearance: { fontSize: 14 } }).ports).toEqual(DEFAULT_SETTINGS.ports)
  })

  it('ignores junk patches', () => {
    expect(applySettingsPatch(DEFAULT_SETTINGS, 'x')).toEqual(DEFAULT_SETTINGS)
    expect(applySettingsPatch(DEFAULT_SETTINGS, { appearance: { fontSize: 'big' } })).toEqual(DEFAULT_SETTINGS)
  })

  it('keeps code review off unless a real switch is set (PRD F13)', () => {
    expect(DEFAULT_SETTINGS.review).toEqual({
      beforeMerge: false,
      beforePush: false,
      afterTurnWithCommits: false,
      mode: 'builtin',
      rules: 'default',
      customRules: '',
      reviewer: 'same',
      model: '',
      codexModel: ''
    })
    const next = applySettingsPatch(DEFAULT_SETTINGS, { review: { beforeMerge: true, mode: 'agent-command', model: 'haiku', customRules: '只看空指针' } })
    expect(next.review.beforeMerge).toBe(true)
    expect(next.review.beforePush).toBe(false)
    expect(next.review.mode).toBe('agent-command')
    expect(next.review.model).toBe('haiku')
    expect(next.review.rules).toBe('default')
    expect(applySettingsPatch(DEFAULT_SETTINGS, { review: { model: 'not a model', mode: 'nope' } }).review.model).toBe('')
    expect(applySettingsPatch(DEFAULT_SETTINGS, { review: { mode: 'nope' } }).review.mode).toBe('builtin')
    expect(applySettingsPatch(DEFAULT_SETTINGS, { appearance: { fontSize: 14 } }).review).toEqual(DEFAULT_SETTINGS.review)
  })

  it('picks the other CLI as reviewer only when asked, and moves an old OpenAI model to Codex (PRD F13 v1.63)', () => {
    expect(applySettingsPatch(DEFAULT_SETTINGS, { review: { reviewer: 'other' } }).review.reviewer).toBe('other')
    expect(applySettingsPatch(DEFAULT_SETTINGS, { review: { reviewer: 'nope' as 'other' } }).review.reviewer).toBe('same')
    const legacy = sanitizeSettings({ review: { model: 'gpt-5.5-codex' } }).review
    expect([legacy.model, legacy.codexModel]).toEqual(['', 'gpt-5.5-codex'])
    const claude = sanitizeSettings({ review: { model: 'opus' } }).review
    expect([claude.model, claude.codexModel]).toEqual(['opus', ''])
    expect(sanitizeSettings({ review: { model: 'gpt-5', codexModel: '' } }).review.model).toBe('gpt-5')
  })
})

describe('archive settings (F15)', () => {
  it('starts with 合并后自动归档 off and takes a boolean patch only', () => {
    expect(DEFAULT_SETTINGS.archive.afterMerge).toBe(false)
    expect(applySettingsPatch(DEFAULT_SETTINGS, { archive: { afterMerge: true } }).archive.afterMerge).toBe(true)
    expect(applySettingsPatch(DEFAULT_SETTINGS, { archive: { afterMerge: 'yes' } }).archive.afterMerge).toBe(false)
    expect(sanitizeSettings({}).archive).toEqual({ afterMerge: false })
  })
})

describe('alert settings (F11 · 额度提醒)', () => {
  it('turns usage alerts on by default and keeps only booleans', () => {
    expect(DEFAULT_SETTINGS.alerts.usage).toBe(true)
    expect(applySettingsPatch(DEFAULT_SETTINGS, { alerts: { usage: false } }).alerts.usage).toBe(false)
    expect(applySettingsPatch(DEFAULT_SETTINGS, { alerts: { usage: 'no' } }).alerts.usage).toBe(true)
    expect(sanitizeSettings({}).alerts).toEqual({ usage: true })
  })
})

describe('设置 · 自动化 · PR (PRD F16 v1.63)', () => {
  it('starts with the evidence block on and both automations off', () => {
    expect(DEFAULT_SETTINGS.pr).toEqual({
      evidence: true,
      autoFix: false,
      mergeWhenGreen: false,
      maxAutoFixes: 3,
      bots: [],
      writer: 'session',
      writerClaudeModel: 'haiku',
      writerCodexModel: '',
      writeOnOpen: false
    })
  })

  it('AI 写 (v1.68): the session\'s agent on Haiku by default, never writing on open unless asked, and only model names', () => {
    const pr = applySettingsPatch(DEFAULT_SETTINGS, { pr: { writer: 'codex', writerCodexModel: 'gpt-5-mini', writerClaudeModel: 'rm -rf /', writeOnOpen: true } }).pr
    expect(pr).toMatchObject({ writer: 'codex', writerCodexModel: 'gpt-5-mini', writerClaudeModel: 'haiku', writeOnOpen: true })
    expect(sanitizeSettings({ pr: { writer: 'gemini' } }).pr.writer).toBe('session')
  })

  it('keeps the cap within 1–5 and only valid bot logins', () => {
    const pr = applySettingsPatch(DEFAULT_SETTINGS, { pr: { maxAutoFixes: 9, bots: ['coderabbitai[bot]', 'coderabbitai[bot]', 'not a login', 'copilot'] } }).pr
    expect(pr.maxAutoFixes).toBe(5)
    expect(pr.bots).toEqual(['coderabbitai[bot]', 'copilot'])
    expect(sanitizeSettings({ pr: { autoFix: true } }).pr).toMatchObject({ autoFix: true, evidence: true })
  })
})
