import { describe, expect, it } from 'vitest'
import { assertCwdExists } from './preflight'

const only = (...dirs: string[]) => (path: string) => dirs.includes(path)

describe('assertCwdExists', () => {
  it('accepts an existing directory, with ~ expanded', () => {
    expect(() => assertCwdExists('/work/app', '/Users/me', only('/work/app'))).not.toThrow()
    expect(() => assertCwdExists('~', '/Users/me', only('/Users/me'))).not.toThrow()
    expect(() => assertCwdExists('~/code', '/Users/me', only('/Users/me/code'))).not.toThrow()
  })

  it('refuses a missing directory with a coded message carrying the path', () => {
    expect(() => assertCwdExists('/gone', '/Users/me', only())).toThrow('TR_CWD_MISSING:/gone')
  })

  it('refuses a relative path', () => {
    expect(() => assertCwdExists('work', '/Users/me', () => true)).toThrow('TR_CWD_MISSING:work')
  })
})
