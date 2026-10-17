import { describe, expect, it } from 'vitest'
import { indexStatus } from '@shared/worktree-files'
import { baseName, filterPaths, parentOf, pathRows, stepRow, treeRows } from './tree-model'

const status = indexStatus({
  changes: { 'src/components/MobileNav.tsx': 'M', 'src/new.ts': 'A', 'gone.ts': 'D', 'scratch/': 'U' },
  ignored: ['node_modules/', '.env.local']
})

const summary = (rows: ReturnType<typeof treeRows>) => rows.map((r) => `${'  '.repeat(r.depth)}${r.name}${r.dir ? '/' : ''}${r.mark ? ` ${r.mark}` : ''}${r.ignored ? ' (ignored)' : ''}${r.loading ? ' …' : ''}`)

describe('treeRows', () => {
  const children = {
    '': [
      { name: 'node_modules', dir: true },
      { name: 'src', dir: true },
      { name: '.env.local', dir: false },
      { name: 'README.md', dir: false }
    ],
    src: [
      { name: 'components', dir: true },
      { name: 'new.ts', dir: false }
    ]
  }

  it('walks only expanded folders and marks git state', () => {
    const rows = treeRows({ children, expanded: new Set(['src', 'src/components']) }, status)
    expect(summary(rows)).toEqual([
      'node_modules/ (ignored)',
      'src/ •',
      '  components/ • …',
      '  new.ts A',
      '.env.local (ignored)',
      'README.md'
    ])
    expect(rows[2]).toMatchObject({ path: 'src/components', depth: 1, expanded: true, loading: true })
  })

  it('shows a collapsed folder without its children', () => {
    expect(summary(treeRows({ children, expanded: new Set() }, status))).toEqual(['node_modules/ (ignored)', 'src/ •', '.env.local (ignored)', 'README.md'])
  })
})

describe('pathRows', () => {
  it('builds an open tree from flat paths, folders first', () => {
    const rows = pathRows(['src/components/MobileNav.tsx', 'gone.ts', 'src/new.ts', 'scratch/'], status)
    expect(summary(rows)).toEqual(['scratch/ U', 'src/ •', '  components/ •', '    MobileNav.tsx M', '  new.ts A', 'gone.ts D'])
    expect(rows.find((r) => r.path === 'scratch')).toMatchObject({ dir: true, expanded: false })
  })

  it('keeps collapsed folders shut', () => {
    expect(summary(pathRows(['src/new.ts', 'gone.ts'], status, new Set(['src'])))).toEqual(['src/ •', 'gone.ts D'])
  })
})

describe('filterPaths', () => {
  const paths = ['src/components/MobileNav.tsx', 'src/components/Header.tsx', 'docs/nav.md', 'README.md']

  it('matches file names case-insensitively', () => {
    expect(filterPaths(paths, 'NAV', 10)).toEqual(['src/components/MobileNav.tsx', 'docs/nav.md'])
  })

  it('matches whole paths when the query has a slash', () => {
    expect(filterPaths(paths, 'components/h', 10)).toEqual(['src/components/Header.tsx'])
  })

  it('stops at the limit and ignores blank queries', () => {
    expect(filterPaths(paths, '.', 2)).toHaveLength(2)
    expect(filterPaths(paths, '  ', 10)).toEqual([])
  })
})

describe('stepRow', () => {
  const rows = pathRows(['a/b/c.ts', 'a/d.ts', 'e.ts'], indexStatus(null))
  // a/ · b/ · c.ts · d.ts · e.ts

  it('moves up and down within bounds', () => {
    expect(stepRow(rows, 0, 'up')).toBeNull()
    expect(stepRow(rows, 0, 'down')).toBe(1)
    expect(stepRow(rows, 4, 'down')).toBeNull()
    expect(stepRow(rows, -1, 'down')).toBe(0)
  })

  it('goes into an open folder and back to the parent', () => {
    expect(stepRow(rows, 0, 'right')).toBe(1)
    expect(stepRow(rows, 2, 'right')).toBeNull()
    expect(stepRow(rows, 2, 'left')).toBe(1)
    expect(stepRow(rows, 3, 'left')).toBe(0)
    expect(stepRow(rows, 4, 'left')).toBeNull()
  })
})

describe('path helpers', () => {
  it('splits parent and name', () => {
    expect(parentOf('src/a/b.ts')).toBe('src/a')
    expect(parentOf('b.ts')).toBe('')
    expect(baseName('src/a/b.ts')).toBe('b.ts')
  })
})
