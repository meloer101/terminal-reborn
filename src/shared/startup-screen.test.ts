import { describe, expect, it } from 'vitest'
import { blockedAction, blockedReasonOf, readScreen } from './startup-screen'

// Captured from Claude Code 2.1.299 (docs: phase 2a lifecycle lab).
const CLAUDE_IDLE = `
 ▐▛███▛█   Claude Code v2.1.299
▝▜██████▀  Opus 5.5 · Claude Max
 ▝▝   ▝▝   /private/tmp/tr-hooks-lab
──────────────────────────────────────────────────
❯ Try "how does <filepath> work?"
──────────────────────────────────────────────────
  ⏸ manual mode on · ← for agents`

const CLAUDE_PERMISSION = `
 echo hi > /tmp/tr-hooks-lab/a4.txt
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and always allow access to /tmp/tr-hooks-lab from this project
   4. No

 Esc to cancel · Tab to amend`

describe('readScreen', () => {
  it('recognises Claude\'s idle screen: UI up, input footer showing', () => {
    expect(readScreen('claude', CLAUDE_IDLE)).toMatchObject({ dialog: null, prompt: false, agentUi: true, blank: false, idleFooter: true })
  })

  it('a permission dialog is the agent UI but not the idle footer', () => {
    const reading = readScreen('claude', CLAUDE_PERMISSION)
    expect(reading.idleFooter).toBe(false)
    expect(reading.dialog).toBeNull()
  })

  it('finds the first-run dialogs', () => {
    expect(readScreen('claude', 'Yes, I trust this folder').dialog).toBe('claude-trust')
    expect(readScreen('codex', 'Do you trust the contents of this directory?').dialog).toBe('codex-trust')
    expect(readScreen('codex', 'Update available!\nSkip until next version').dialog).toBe('codex-update')
  })

  it('finds a shell startup question at the end of the screen only', () => {
    expect(readScreen('claude', 'Last login: today\n[oh-my-zsh] Would you like to update? [Y/n] ').prompt).toBe(true)
    const old = ['[oh-my-zsh] Would you like to update? [Y/n] y', ...Array.from({ length: 10 }, (_, i) => `line ${i}`)].join('\n')
    expect(readScreen('claude', old).prompt).toBe(false)
  })

  it('codex UI: banner or prompt glyph; shells never have one', () => {
    expect(readScreen('codex', '>_ OpenAI Codex (v0.142.5)').agentUi).toBe(true)
    expect(readScreen('codex', '› Ask Codex').agentUi).toBe(true)
    expect(readScreen('codex', 'user@host ~ %').agentUi).toBe(false)
    expect(readScreen('shell', 'Claude Code v2').agentUi).toBe(false)
  })

  it('blank screens', () => {
    expect(readScreen('claude', ' \n\n ').blank).toBe(true)
  })
})

describe('blocked reasons', () => {
  it('dialog beats prompt; nothing recognised is not blocked', () => {
    expect(blockedReasonOf(readScreen('claude', 'Yes, I trust this folder'))).toEqual({ kind: 'dialog', dialog: 'claude-trust' })
    expect(blockedReasonOf(readScreen('claude', 'Continue? [Y/n]'))).toEqual({ kind: 'prompt' })
    expect(blockedReasonOf(readScreen('claude', CLAUDE_IDLE))).toBeNull()
  })

  it('has a status line for each', () => {
    expect(blockedAction({ kind: 'dialog', dialog: 'claude-trust' })).toBe('等你确认：信任此文件夹')
    expect(blockedAction({ kind: 'dialog', dialog: 'codex-update' })).toBe('等你确认：更新提示')
    expect(blockedAction({ kind: 'prompt' })).toBe('等你回答：终端里的提示')
  })
})
