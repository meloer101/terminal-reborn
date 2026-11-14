import { describe, expect, it } from 'vitest'
import { fileIcon } from './file-icon'

describe('fileIcon', () => {
  it('matches an exact file name before the extension, ignoring case', () => {
    expect(fileIcon('package.json')).toBe('nodejs')
    expect(fileIcon('CLAUDE.md')).toBe('claude')
    expect(fileIcon('LICENSE')).toBe('license')
    expect(fileIcon('.gitignore')).toBe('git')
  })

  it('prefers the longest compound extension', () => {
    expect(fileIcon('keys.test.ts')).toBe('test-ts')
    expect(fileIcon('store.ts')).toBe('typescript')
    expect(fileIcon('FileTree.tsx')).toBe('react_ts')
    expect(fileIcon('Notes.MD')).toBe('markdown')
  })

  it('has no icon for unknown names, so the tree keeps the plain file icon', () => {
    expect(fileIcon('Makefile.unknownext')).toBeUndefined()
    expect(fileIcon('noext')).toBeUndefined()
    expect(fileIcon('trailing.')).toBeUndefined()
  })

  it("uses material's light variant in the light theme", () => {
    expect(fileIcon('.vercelignore', 'light')).toBe('vercel_light')
    expect(fileIcon('.vercelignore', 'dark')).toBe('vercel')
    expect(fileIcon('store.ts', 'light')).toBe('typescript')
  })
})
