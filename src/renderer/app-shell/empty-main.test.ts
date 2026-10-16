import { describe, expect, it } from 'vitest'
import { recentFolders, tildePath } from './empty-main'

describe('recentFolders', () => {
  it('lists recent folders first, then the remaining projects, at most five', () => {
    const projects = [
      { id: 'p1', name: 'acme-web', rootPath: '/code/acme-web' },
      { id: 'p2', name: 'docs', rootPath: '/code/docs' }
    ]
    expect(recentFolders(['/code/docs', '/old/thing/'], projects)).toEqual([
      { path: '/code/docs', name: 'docs' },
      { path: '/old/thing/', name: 'thing' },
      { path: '/code/acme-web', name: 'acme-web' }
    ])
    expect(recentFolders(['/1', '/2', '/3', '/4', '/5', '/6'], [])).toHaveLength(5)
    expect(recentFolders([], [])).toEqual([])
  })
})

describe('tildePath', () => {
  it('abbreviates the home directory only at a path boundary', () => {
    expect(tildePath('/Users/a/code/x', '/Users/a')).toBe('~/code/x')
    expect(tildePath('/Users/a', '/Users/a')).toBe('~')
    expect(tildePath('/Users/ab/x', '/Users/a')).toBe('/Users/ab/x')
  })
})
