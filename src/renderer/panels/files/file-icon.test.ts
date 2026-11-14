import { describe, expect, it } from 'vitest'
import { fileIcon } from './file-icon'
import { ICON_BY_EXT, ICON_BY_NAME, ICON_SVG, LIGHT_ICON } from './file-icons.data'

describe('fileIcon', () => {
  it('matches an exact file name before the extension, ignoring case', () => {
    expect(fileIcon('package.json')).toBe('nodejs')
    expect(fileIcon('CLAUDE.md')).toBe('claude')
    expect(fileIcon('LICENSE')).toBe('license')
    expect(fileIcon('.gitignore')).toBe('git')
    // A leading dot is part of the name, so ".env" has no extension and needs its own entry.
    expect(fileIcon('.env')).toBe('tune')
  })

  it('every icon a lookup can return has its SVG', () => {
    const icons = [...Object.values(ICON_BY_NAME), ...Object.values(ICON_BY_EXT), ...Object.values(LIGHT_ICON)]
    expect(icons.filter((icon) => !ICON_SVG[icon])).toEqual([])
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
