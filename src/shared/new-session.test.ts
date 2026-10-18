import { describe, expect, it } from 'vitest'
import {
  branchNameProblem,
  branchPrefix,
  defaultBase,
  folderNameFor,
  generateBranchName,
  groupBranches,
  initialWorkdir,
  isSafeFolderName,
  parseCreateRequest,
  rememberWorkdir,
  slugify,
  type NewSessionBranch
} from './new-session'

const local = (name: string, worktreePath: string | null = null): NewSessionBranch => ({ name, remote: false, worktreePath, inMainCheckout: false })
const remote = (name: string): NewSessionBranch => ({ name, remote: true, worktreePath: null, inMainCheckout: false })

/** A fixed sequence of "random" numbers, repeated. */
const sequence = (...values: number[]) => {
  let i = 0
  return () => values[i++ % values.length]!
}

describe('branch names', () => {
  it('slugifies to lowercase ASCII words', () => {
    expect(slugify('Jacob Yu')).toBe('jacob-yu')
    expect(slugify('  Élodie ')).toBe('elodie')
    expect(slugify('余家')).toBe('')
  })

  it('takes the prefix from git user.name, then the login name', () => {
    expect(branchPrefix('Jacob Yu', 'm')).toBe('jacob')
    expect(branchPrefix('', 'jacob')).toBe('jacob')
    expect(branchPrefix('余', 'm')).toBe('') // a one-letter login name is no better than none
  })

  it('generates <prefix>/<adjective>-<noun>', () => {
    expect(generateBranchName('jacob', new Set(), sequence(0.85, 0.55))).toMatch(/^jacob\/[a-z]+-[a-z]+$/)
    expect(generateBranchName('', new Set(), sequence(0, 0))).toBe('amber-badger')
  })

  it('avoids taken names, and still returns when every draw is taken', () => {
    const always = sequence(0, 0)
    expect(generateBranchName('j', new Set(['j/amber-badger']), sequence(0, 0, 0.99, 0.99))).toBe('j/zesty-yak')
    expect(generateBranchName('j', new Set(['j/amber-badger', 'j/amber-badger-2']), always)).toBe('j/amber-badger-3')
  })

  it('names the folder after the branch, uniquely', () => {
    expect(folderNameFor('jacob/swift-otter', new Set())).toBe('swift-otter')
    expect(folderNameFor('jacob/swift-otter', new Set(['swift-otter']))).toBe('swift-otter-2')
    expect(folderNameFor('feat/中文', new Set())).toBe('worktree')
    expect(isSafeFolderName('swift-otter')).toBe(true)
    expect(isSafeFolderName('..')).toBe(false)
    expect(isSafeFolderName('a/b')).toBe(false)
  })

  it('says why a typed branch name cannot be created', () => {
    const branches = [local('main'), local('jacob/swift-otter'), remote('origin/feat/x')]
    expect(branchNameProblem('', branches)).toBe('empty')
    expect(branchNameProblem('bad name', branches)).toBe('invalid')
    expect(branchNameProblem('a..b', branches)).toBe('invalid')
    expect(branchNameProblem('-x', branches)).toBe('invalid')
    expect(branchNameProblem('jacob/swift-otter', branches)).toBe('exists')
    expect(branchNameProblem('feat/x', branches)).toBeNull() // only the remote has it
    expect(branchNameProblem('jacob/new', branches)).toBeNull()
  })
})

describe('groupBranches', () => {
  const branches = [
    local('release/1.4'),
    local('jacob/checkout-coupon', '/w/checkout-coupon'),
    local('main', '/repo'),
    remote('origin/HEAD'),
    remote('origin/main'),
    remote('origin/release/1.5'),
    remote('origin/feat/coupon-v2')
  ]

  it('puts the default branch first and leaves out remotes that exist locally', () => {
    const groups = groupBranches(branches, 'main')
    expect(groups.local.map((b) => b.name)).toEqual(['main', 'jacob/checkout-coupon', 'release/1.4'])
    expect(groups.remote.map((b) => b.name)).toEqual(['origin/feat/coupon-v2', 'origin/release/1.5'])
  })

  it('filters both groups by a case-insensitive substring', () => {
    const groups = groupBranches(branches, 'main', 'COUPON')
    expect(groups.local.map((b) => b.name)).toEqual(['jacob/checkout-coupon'])
    expect(groups.remote.map((b) => b.name)).toEqual(['origin/feat/coupon-v2'])
  })

  it('defaults 基于 to the default branch, else the current one', () => {
    expect(defaultBase({ defaultBranch: 'main', currentBranch: 'dev', branches })).toBe('main')
    expect(defaultBase({ defaultBranch: null, currentBranch: 'dev', branches })).toBe('dev')
    expect(defaultBase({ defaultBranch: null, currentBranch: null, branches })).toBe('release/1.4')
    expect(defaultBase({ defaultBranch: null, currentBranch: null, branches: [] })).toBeNull()
  })
})

describe('remembered 工作目录', () => {
  it('starts with a new worktree and then follows the last choice per project', () => {
    expect(initialWorkdir({}, 'p1', true)).toBe('worktree')
    const after = rememberWorkdir({}, 'p1', 'current', true)
    expect(initialWorkdir(after, 'p1', true)).toBe('current')
    expect(initialWorkdir(after, 'p2', true)).toBe('worktree')
  })

  it('is always 当前目录 outside a git repository, without remembering that', () => {
    expect(initialWorkdir({ p1: 'worktree' }, 'p1', false)).toBe('current')
    const map = { p1: 'worktree' as const }
    expect(rememberWorkdir(map, 'p1', 'current', false)).toBe(map)
    expect(rememberWorkdir(map, 'p1', 'worktree', true)).toBe(map)
  })
})

describe('parseCreateRequest', () => {
  const ok = { root: '/repo', branch: 'jacob/swift-otter', base: 'origin/main', folder: 'swift-otter', prepare: true }

  it('accepts a well-formed request', () => {
    expect(parseCreateRequest(ok)).toEqual(ok)
  })

  it.each([
    ['a relative root', { root: 'repo' }],
    ['an option as branch', { branch: '--force' }],
    ['a full ref as branch', { branch: 'refs/heads/x' }],
    ['an option as base', { base: '-b' }],
    ['a path as folder', { folder: '../x' }],
    ['a non-boolean prepare', { prepare: 'yes' }]
  ])('rejects %s', (_label, patch) => {
    expect(parseCreateRequest({ ...ok, ...patch })).toBeNull()
  })

  it('rejects non-objects', () => {
    expect(parseCreateRequest(null)).toBeNull()
    expect(parseCreateRequest([ok])).toBeNull()
  })
})
