import { describe, expect, it } from 'vitest'
import { classifyChange, isInside, normalizeRelative } from './worktree-files'

describe('normalizeRelative', () => {
  it('accepts plain relative paths and the root', () => {
    expect(normalizeRelative('')).toBe('')
    expect(normalizeRelative('.')).toBe('')
    expect(normalizeRelative('src/components/')).toBe('src/components')
    expect(normalizeRelative('src/./a/../b.ts')).toBe('src/b.ts')
  })

  it('rejects anything that leaves the root or is not a string path', () => {
    expect(normalizeRelative('..')).toBeNull()
    expect(normalizeRelative('../x')).toBeNull()
    expect(normalizeRelative('src/../../x')).toBeNull()
    expect(normalizeRelative('/etc/passwd')).toBeNull()
    expect(normalizeRelative('a\0b')).toBeNull()
    expect(normalizeRelative(42)).toBeNull()
    expect(normalizeRelative('x'.repeat(5000))).toBeNull()
  })
})

describe('isInside', () => {
  it('compares resolved paths', () => {
    expect(isInside('/code/app', '/code/app')).toBe(true)
    expect(isInside('/code/app', '/code/app/src/a.ts')).toBe(true)
    expect(isInside('/code/app', '/code/app-other/a.ts')).toBe(false)
    expect(isInside('/code/app', '/code')).toBe(false)
    expect(isInside('/code/app', '/etc/passwd')).toBe(false)
  })

  it('allows names that merely start with two dots', () => {
    expect(isInside('/code/app', '/code/app/..hidden')).toBe(true)
  })
})

describe('classifyChange', () => {
  it('maps a changed file to the folder whose listing it affects', () => {
    expect(classifyChange('src/components/Nav.tsx')).toEqual({ dir: 'src/components', git: false })
    expect(classifyChange('README.md')).toEqual({ dir: '', git: false })
  })

  it('keeps only git bookkeeping that changes the status', () => {
    expect(classifyChange('.git/index')).toEqual({ dir: '', git: true })
    expect(classifyChange('.git/HEAD')).toEqual({ dir: '', git: true })
    expect(classifyChange('.git/refs/heads/main')).toEqual({ dir: '', git: true })
    expect(classifyChange('.git/objects/ab/cdef')).toBeNull()
    expect(classifyChange('.git/logs/HEAD')).toBeNull()
  })
})
