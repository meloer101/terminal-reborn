import { describe, expect, it } from 'vitest'
import type { NewSessionInfo } from '@shared/new-session'
import { branchProblemText, createFailureText, planCreate, prepareText, tilde, type SheetForm } from './model'

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
  includeCount: 1
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
    expect(prepareText({ includeFiles: [], includeCount: 0 })).toBeNull()
    expect(prepareText({ includeFiles: ['.env.local'], includeCount: 1 })).toBe('复制 .env.local')
    expect(prepareText({ includeFiles: ['.env', '.env.local', 'node_modules/'], includeCount: 3 })).toBe('复制 .env、.env.local 等 3 项')
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
