import { describe, expect, it } from 'vitest'
import { CLI_AGENTS } from '@shared/agents'
import type { NewSessionInfo } from '@shared/new-session'
import { binaryInstalled, branchProblemText, createFailureText, hereChoice, hereMenu, planCreate, prepareText, tilde, uiRow, type SheetForm } from './model'

const info: NewSessionInfo = {
  repo: true,
  currentBranch: 'main',
  defaultBranch: 'main',
  branches: [
    { name: 'main', remote: false, worktreePath: '/code/acme', inMainCheckout: true },
    { name: 'jacob/checkout-coupon', remote: false, worktreePath: '/w/checkout-coupon', inMainCheckout: false },
    { name: 'release/1.4', remote: false, worktreePath: null, inMainCheckout: false },
    { name: 'origin/feat/coupon-v2', remote: true, worktreePath: null, inMainCheckout: false }
  ],
  prefix: 'jacob',
  worktreesDir: '/Users/j/.tr/worktrees/acme',
  takenFolders: ['swift-otter'],
  includeFiles: ['.env.local'],
  includeCount: 1,
  hasSetup: false
}

const form = (patch: Partial<SheetForm> = {}): SheetForm => ({ workdir: 'worktree', base: 'main', branch: 'jacob/brave-heron', prepare: true, ...patch })

describe('planCreate', () => {
  it('creates a worktree on a new branch by default', () => {
    expect(planCreate('/code/acme', info, form())).toEqual({
      plan: {
        type: 'worktree',
        path: '/Users/j/.tr/worktrees/acme/brave-heron',
        request: { root: '/code/acme', branch: 'jacob/brave-heron', base: 'main', folder: 'brave-heron', prepare: true }
      },
      problem: null
    })
  })

  it('picks a free folder when the name is taken', () => {
    const result = planCreate('/code/acme', info, form({ branch: 'other/swift-otter' }))
    expect(result.plan?.type === 'worktree' && result.plan.request.folder).toBe('swift-otter-2')
  })

  it('branches off a remote branch', () => {
    const result = planCreate('/code/acme', info, form({ base: 'origin/feat/coupon-v2' }))
    expect(result.plan?.type === 'worktree' && result.plan.request.base).toBe('origin/feat/coupon-v2')
  })

  it('opens the worktree that already has the chosen branch', () => {
    expect(planCreate('/code/acme', info, form({ base: 'jacob/checkout-coupon', branch: 'main' })).plan).toEqual({
      type: 'existing',
      path: '/w/checkout-coupon',
      branch: 'jacob/checkout-coupon'
    })
  })

  it('uses the main checkout for 当前目录 and outside git, even while loading', () => {
    expect(planCreate('/code/acme', null, form({ workdir: 'current' })).plan).toEqual({ type: 'current' })
    expect(planCreate('/code/notes', { ...info, repo: false }, form()).plan).toEqual({ type: 'current' })
  })

  it('blocks on loading, a missing base and an unusable branch name', () => {
    expect(planCreate('/code/acme', null, form()).problem).toBe('loading')
    expect(planCreate('/code/acme', info, form({ base: 'gone' })).problem).toBe('no-base')
    expect(planCreate('/code/acme', info, form({ branch: 'release/1.4' })).problem).toBe('exists')
    expect(planCreate('/code/acme', info, form({ branch: 'a b' })).problem).toBe('invalid')
    expect(planCreate('/code/acme', info, form({ branch: '' })).problem).toBe('empty')
  })
})

describe('copy', () => {
  it('explains an unusable branch name', () => {
    expect(branchProblemText('exists', 'jacob/swift-otter')).toBe('分支 jacob/swift-otter 已经存在。换个名字，或在「基于」里直接选它')
    expect(branchProblemText(null, 'x')).toBeNull()
  })

  it('says what 准备 copies', () => {
    expect(prepareText({ includeFiles: [], includeCount: 0, hasSetup: false })).toBeNull()
    expect(prepareText({ includeFiles: ['.env.local'], includeCount: 1, hasSetup: false })).toBe('复制 .env.local')
    expect(prepareText({ includeFiles: ['.env', '.env.local', 'node_modules/'], includeCount: 3, hasSetup: false })).toBe('复制 .env、.env.local 等 3 项')
    expect(prepareText({ includeFiles: [], includeCount: 0, hasSetup: true })).toBe('运行 setup 脚本')
    expect(prepareText({ includeFiles: ['.env.local'], includeCount: 1, hasSetup: true })).toBe('复制 .env.local，运行 setup 脚本')
  })

  it('shortens the home folder', () => {
    expect(tilde('/Users/j/.tr/worktrees/acme/x', '/Users/j')).toBe('~/.tr/worktrees/acme/x')
    expect(tilde('/Users/jo/x', '/Users/j')).toBe('/Users/jo/x')
  })

  it('puts a git failure in one line', () => {
    expect(createFailureText({ ok: false, reason: 'git', message: "fatal: '/x' already exists\nmore" })).toBe("'/x' already exists")
    expect(createFailureText({ ok: false, reason: 'branch-exists' })).toBe('分支已经存在')
  })
})

describe('uiRow (PRD F23, Figma 49″A / B)', () => {
  const none = () => false

  it('offers GUI for agents that have one, and keeps the choice', () => {
    expect(uiRow('grok', 'gui', none)).toEqual({ value: 'gui', guiDisabled: false, forced: false })
    expect(uiRow('claude', 'cli', none)).toEqual({ value: 'cli', guiDisabled: false, forced: false })
  })

  it('turns GUI off until the adapter is installed, with its install command (Amp); Pi needs none', () => {
    expect(uiRow('amp', 'gui', none)).toEqual({ value: 'cli', guiDisabled: true, adapter: { binary: 'amp-acp', install: 'npm install -g amp-acp' }, forced: true })
    expect(uiRow('amp', 'gui', (b) => b === 'amp-acp')).toEqual({ value: 'gui', guiDisabled: false, forced: false })
    expect(uiRow('pi', 'gui', none)).toEqual({ value: 'gui', guiDisabled: false, forced: false })
  })

  it('says why on hover for a CLI-only agent; a CLI chosen there is not forced', () => {
    expect(uiRow('crush', 'gui', none)).toMatchObject({ value: 'cli', guiDisabled: true, guiTitle: 'Crush 没有 ACP，只能用 CLI', forced: true })
    expect(uiRow('crush', 'cli', none)?.forced).toBe(false)
  })

  it('has no row for a plain terminal', () => {
    expect(uiRow('shell', 'gui', none)).toBeNull()
  })

  it('reads agent binaries and ACP adapters from the detection result', () => {
    const installed = binaryInstalled({ claude: true, amp: true, adapters: { 'amp-acp': true } })
    expect(installed('claude')).toBe(true)
    expect(installed('amp')).toBe(true)
    expect(installed('amp-acp')).toBe(true)
    expect(binaryInstalled({ amp: true })('amp-acp')).toBe(false)
    expect(binaryInstalled(null)('claude')).toBe(false)
  })
})

describe('在此新建会话 (Figma 58C)', () => {
  const labels = (entries: ReturnType<typeof hereMenu>['items']) =>
    entries.map((e) => (e.type === 'item' ? `${e.muted ? '~' : ''}${e.label}` : e.type === 'header' ? `[${e.label}]` : e.type === 'separator' ? '—' : e.label))

  it('lists every agent: 已安装 in 新建会话 order, 没装 grey after them, 终端 under the list', () => {
    const menu = hereMenu({ claude: true, codex: false, gemini: true, grok: true }, 'here:')
    const shown = labels(menu.items)
    expect(shown.slice(0, 6)).toEqual(['[已安装]', 'Claude Code', 'Codex', 'Gemini CLI', 'Grok', '—'])
    expect(shown[6]).toBe('[没装]')
    expect(shown.slice(7)).toHaveLength(CLI_AGENTS.length - 4)
    expect(shown.slice(7).every((l) => l.startsWith('~'))).toBe(true)
    expect(labels(menu.footer ?? [])).toEqual(['—', '终端'])
  })

  it('has no 没装 group when everything is installed, and disables only the rows that start a session', () => {
    const all = Object.fromEntries(CLI_AGENTS.map((id) => [id, true]))
    expect(labels(hereMenu(all, 'new:').items)).not.toContain('[没装]')
    const off = hereMenu({}, 'new:', false)
    expect(off.items.find((e) => e.type === 'item' && e.id === 'new:claude')).toMatchObject({ enabled: false })
    expect(off.items.find((e) => e.type === 'item' && e.id === 'new:install:pi')).not.toHaveProperty('enabled')
  })

  it('reads a choice back, and nothing it did not offer', () => {
    expect(hereChoice('here:gemini', 'here:')).toEqual({ kind: 'gemini' })
    expect(hereChoice('here:shell', 'here:')).toEqual({ kind: 'shell' })
    expect(hereChoice('here:install:amp', 'here:')).toEqual({ install: 'amp' })
    expect(hereChoice('here:install:shell', 'here:')).toBeNull()
    expect(hereChoice('here:nope', 'here:')).toBeNull()
    expect(hereChoice('close', 'here:')).toBeNull()
    expect(hereChoice(null, 'here:')).toBeNull()
  })
})
