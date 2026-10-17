import { describe, expect, it } from 'vitest'
import { ancestors, compareEntries, indexStatus, letterForXY, looksBinary, parseGitStatus, parseLineMarks } from './worktree-files'

describe('compareEntries', () => {
  it('puts folders first and sorts names case-insensitively and numerically', () => {
    const names = [
      { name: 'README.md', dir: false },
      { name: 'src', dir: true },
      { name: '.gitignore', dir: false },
      { name: 'file10.ts', dir: false },
      { name: 'file2.ts', dir: false },
      { name: '.github', dir: true },
      { name: 'index.html', dir: false }
    ].sort(compareEntries)
    expect(names.map((e) => e.name)).toEqual(['.github', 'src', '.gitignore', 'file2.ts', 'file10.ts', 'index.html', 'README.md'])
  })
})

describe('letterForXY', () => {
  it('maps index / worktree pairs to one letter', () => {
    expect(letterForXY('.M')).toBe('M')
    expect(letterForXY('M.')).toBe('M')
    expect(letterForXY('A.')).toBe('A')
    expect(letterForXY('AM')).toBe('A')
    expect(letterForXY('.D')).toBe('D')
    expect(letterForXY('R.')).toBe('M')
  })
})

describe('parseGitStatus', () => {
  const out = [
    '1 .M N... 100644 100644 100644 abc abc src/components/MobileNav.tsx',
    '1 A. N... 000000 100644 100644 000 def src/new file.ts',
    '2 R. N... 100644 100644 100644 abc abc R100 src/renamed.ts',
    'src/old.ts',
    'u UU N... 100644 100644 100644 100644 a b c src/conflict.ts',
    '1 .D N... 100644 100644 000000 abc abc gone.ts',
    '? notes.md',
    '? scratch/',
    '! node_modules/',
    '! .env.local',
    ''
  ].join('\0')

  it('reads every entry kind, including paths with spaces and the rename origin', () => {
    expect(parseGitStatus(out)).toEqual({
      changes: {
        'src/components/MobileNav.tsx': 'M',
        'src/new file.ts': 'A',
        'src/renamed.ts': 'M',
        'src/conflict.ts': 'M',
        'gone.ts': 'D',
        'notes.md': 'U',
        'scratch/': 'U'
      },
      ignored: ['node_modules/', '.env.local']
    })
  })

  it('keeps only entries under the worktree prefix, relative to it', () => {
    const snapshot = parseGitStatus(out, 'src/')
    expect(Object.keys(snapshot.changes)).toEqual(['components/MobileNav.tsx', 'new file.ts', 'renamed.ts', 'conflict.ts'])
    expect(snapshot.ignored).toEqual([])
  })
})

describe('parseLineMarks', () => {
  it('turns hunks into added and modified line ranges', () => {
    const diff = [
      'diff --git a/x b/x',
      '--- a/x',
      '+++ b/x',
      '@@ -5,0 +6,2 @@ function x()',
      '+a',
      '+b',
      '@@ -10 +12 @@',
      '-old',
      '+new',
      '@@ -20,3 +23,0 @@',
      '@@ -30,2 +30,4 @@'
    ].join('\n')
    expect(parseLineMarks(diff)).toEqual([
      { from: 6, to: 7, kind: 'add' },
      { from: 12, to: 12, kind: 'mod' },
      { from: 30, to: 33, kind: 'mod' }
    ])
  })
})

describe('looksBinary', () => {
  it('flags a NUL byte', () => {
    expect(looksBinary(new TextEncoder().encode('plain text'))).toBe(false)
    expect(looksBinary(new Uint8Array([0x89, 0x50, 0x00, 0x47]))).toBe(true)
  })
})

describe('indexStatus', () => {
  const index = indexStatus({
    changes: { 'src/components/MobileNav.tsx': 'M', 'scratch/': 'U', 'gone.ts': 'D' },
    ignored: ['node_modules/', '.env.local']
  })

  it('looks up letters, including files inside an untracked folder', () => {
    expect(index.letter('src/components/MobileNav.tsx')).toBe('M')
    expect(index.letter('scratch')).toBe('U')
    expect(index.letter('scratch/a/b.ts')).toBe('U')
    expect(index.letter('src/components')).toBeNull()
    expect(index.letter('scratchpad.ts')).toBeNull()
  })

  it('marks the folders that contain changes', () => {
    expect(index.hasChanges('src')).toBe(true)
    expect(index.hasChanges('src/components')).toBe(true)
    expect(index.hasChanges('scratch/a')).toBe(true)
    expect(index.hasChanges('public')).toBe(false)
  })

  it('dims ignored files and everything inside ignored folders', () => {
    expect(index.ignored('node_modules')).toBe(true)
    expect(index.ignored('node_modules/react/index.js')).toBe(true)
    expect(index.ignored('.env.local')).toBe(true)
    expect(index.ignored('.env')).toBe(false)
    expect(index.ignored('node_modules_backup')).toBe(false)
  })

  it('counts changed entries', () => {
    expect(index.count).toBe(3)
    expect(indexStatus(null).count).toBe(0)
  })
})

describe('ancestors', () => {
  it('lists parent folders, outermost first', () => {
    expect(ancestors('a/b/c.ts')).toEqual(['a', 'a/b'])
    expect(ancestors('c.ts')).toEqual([])
  })
})
