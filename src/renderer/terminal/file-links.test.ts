import { describe, expect, it } from 'vitest'
import { cellText, findPathCandidates, MAX_CANDIDATES_PER_LINE, pathLabel } from './file-links'

/** The candidates as `[link text, path, line, column]`. */
const found = (text: string) => findPathCandidates(text).map((c) => [text.slice(c.start, c.end), c.path, c.line, c.column])

describe('findPathCandidates', () => {
  it('finds relative paths, with or without a line and column', () => {
    expect(found('edited src/app.ts and README.md')).toEqual([
      ['src/app.ts', 'src/app.ts', null, null],
      ['README.md', 'README.md', null, null]
    ])
    expect(found('src/app.ts:42')).toEqual([['src/app.ts:42', 'src/app.ts', 42, null]])
    expect(found('./docs/PRD.md:10:5: warning')).toEqual([['./docs/PRD.md:10:5', './docs/PRD.md', 10, 5]])
    expect(found('see src/a.ts#L7')).toEqual([['src/a.ts#L7', 'src/a.ts', 7, null]])
  })

  it('reads compiler-style (line,col)', () => {
    expect(found('src/a.ts(42,5): error TS2304')).toEqual([['src/a.ts(42,5)', 'src/a.ts', 42, 5]])
    expect(found('src/a.ts(3)')).toEqual([['src/a.ts(3)', 'src/a.ts', 3, null]])
  })

  it('finds absolute paths', () => {
    expect(found('wrote /Users/me/proj/src/app.ts:3')).toEqual([['/Users/me/proj/src/app.ts:3', '/Users/me/proj/src/app.ts', 3, null]])
  })

  it('leaves out the punctuation and chrome around a path', () => {
    expect(found('⏺ Update(src/app.ts)')).toEqual([['src/app.ts', 'src/app.ts', null, null]])
    expect(found('  ⎿  Read `src/app.ts`.')).toEqual([['src/app.ts', 'src/app.ts', null, null]])
    expect(found('look at @src/app.ts, then "lib/x.js".')).toEqual([
      ['src/app.ts', 'src/app.ts', null, null],
      ['lib/x.js', 'lib/x.js', null, null]
    ])
    expect(found('已修改 src/app.ts。')).toEqual([['src/app.ts', 'src/app.ts', null, null]])
    expect(found('│ src/app.ts │')).toEqual([['src/app.ts', 'src/app.ts', null, null]])
  })

  it('keeps CJK in paths', () => {
    expect(found('docs/说明.md:2')).toEqual([['docs/说明.md:2', 'docs/说明.md', 2, null]])
  })

  it('skips URLs, numbers, plain words and bare dots', () => {
    expect(found('http://localhost:5173/src/app.ts')).toEqual([])
    expect(found('3.14 1.2.3 hello world ... ./ ../')).toEqual([])
    expect(found('error: TS2304')).toEqual([])
  })

  it('treats a word with a file extension or a slash as a candidate (main checks it exists)', () => {
    expect(found('v1.2.3 e.g foo/bar hello').map((c) => c[1])).toEqual(['v1.2.3', 'e.g', 'foo/bar'])
  })

  it('drops a zero line and a column without a line', () => {
    expect(found('src/a.ts:0')).toEqual([['src/a.ts:0', 'src/a.ts', null, null]])
  })

  it('caps the candidates per line', () => {
    expect(findPathCandidates(Array.from({ length: 100 }, (_, i) => `f${i}.ts`).join(' '))).toHaveLength(MAX_CANDIDATES_PER_LINE)
  })
})

describe('cellText', () => {
  it('maps every character to its cell; wide characters take two', () => {
    const cells = [
      { chars: 'a', width: 1 },
      { chars: '说', width: 2 },
      { chars: '', width: 0 },
      { chars: '', width: 1 },
      { chars: 'b', width: 1 }
    ]
    expect(cellText(cells)).toEqual({ text: 'a说 b', cells: [0, 1, 3, 4, 5] })
  })

  it('keeps a surrogate pair in one cell', () => {
    expect(cellText([{ chars: '😀', width: 2 }, { chars: '', width: 0 }, { chars: 'x', width: 1 }])).toEqual({ text: '😀x', cells: [0, 0, 2, 3] })
  })
})

describe('pathLabel', () => {
  it('appends the line and column when known', () => {
    expect(pathLabel('src/a.ts', null, null)).toBe('src/a.ts')
    expect(pathLabel('src/a.ts', 4, null)).toBe('src/a.ts:4')
    expect(pathLabel('src/a.ts', 4, 2)).toBe('src/a.ts:4:2')
  })
})
