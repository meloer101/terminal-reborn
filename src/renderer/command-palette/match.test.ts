import { describe, expect, it } from 'vitest'
import { matchFields, tokenize, type MatchField } from './match'

const f = (key: string, text: string, weight = 1): MatchField => ({ key, text, weight })

describe('tokenize', () => {
  it.each([
    ['', []],
    ['   ', []],
    ['Cookie', ['cookie']],
    ['  acme  Web ', ['acme', 'web']],
    ['结算 页', ['结算', '页']]
  ])('%j -> %j', (query, expected) => {
    expect(tokenize(query)).toEqual(expected)
  })
})

describe('matchFields: whether it matches', () => {
  const fields = [f('title', 'Cookie 会话迁移', 3), f('project', 'acme-web', 2), f('branch', 'jacob/session-cookie', 2)]

  it.each([
    ['', true],
    ['cookie', true],
    ['COOKIE', true],
    ['会话', true],
    ['迁移', true],
    ['话迁', true],
    ['会移', true], // CJK subsequence with a one-character gap
    ['acme', true],
    ['web', true], // word start after the hyphen
    ['jacob/sess', true],
    ['cookie acme', true], // tokens may match different fields
    ['会话 web', true],
    ['cke', true], // subsequence, tight span
    ['zzz', false],
    ['cookie zzz', false], // every token must match
    ['迁会', false], // order matters
    ['x', false]
  ])('%j -> %s', (query, expected) => {
    expect(matchFields(query, fields) !== null).toBe(expected)
  })

  it('rejects subsequences spread too thin', () => {
    expect(matchFields('cw', [f('title', 'cookie and a long way to the end of the w')])).toBeNull()
  })

  it('does not subsequence-match single characters', () => {
    expect(matchFields('z', [f('title', 'abc')])).toBeNull()
  })

  it('matches nothing in empty fields', () => {
    expect(matchFields('a', [f('title', '')])).toBeNull()
  })
})

describe('matchFields: scoring', () => {
  const score = (query: string, ...fields: MatchField[]) => matchFields(query, fields)!.score

  it('prefers a prefix over a word start over a mid-word hit', () => {
    const prefix = score('web', f('t', 'web client'))
    const wordStart = score('web', f('t', 'acme web'))
    const middle = score('web', f('t', 'cobweb'))
    expect(prefix).toBeGreaterThan(wordStart)
    expect(wordStart).toBeGreaterThan(middle)
  })

  it('prefers substrings over subsequences', () => {
    expect(score('cook', f('t', 'cookie'))).toBeGreaterThan(score('cke', f('t', 'cookie')))
  })

  it('weights fields: a title hit beats the same hit in a keyword field', () => {
    expect(score('perf', f('title', 'perf work', 3))).toBeGreaterThan(score('perf', f('keywords', 'perf work', 1)))
  })

  it('prefers a more complete substring (shorter text) at equal position', () => {
    expect(score('main', f('t', 'main'))).toBeGreaterThan(score('main', f('t', 'main branch of the repo')))
  })

  it('adds up tokens', () => {
    const one = score('cookie', f('a', 'cookie'), f('b', 'acme'))
    const two = score('cookie acme', f('a', 'cookie'), f('b', 'acme'))
    expect(two).toBeGreaterThan(one)
  })

  it('scores an empty query as 0', () => {
    expect(score('', f('t', 'anything'))).toBe(0)
  })
})

describe('matchFields: highlight ranges', () => {
  it.each([
    ['cookie', 'Cookie 会话迁移', [[0, 6]]],
    ['会话', 'Cookie 会话迁移', [[7, 9]]],
    ['会移', 'Cookie 会话迁移', [[7, 8], [10, 11]]],
    ['co ok', 'Cookie', [[0, 4]]], // overlapping tokens merge
    ['cookie 迁移', 'Cookie 会话迁移', [[0, 6], [9, 11]]]
  ] as const)('%j in %j', (query, text, expected) => {
    const match = matchFields(query, [f('title', text, 3)])!
    expect(match.ranges.title).toEqual(expected)
  })

  it('reports ranges only for the field that won each token', () => {
    const match = matchFields('web', [f('title', 'Checkout', 3), f('project', 'acme-web', 2)])!
    expect(Object.keys(match.ranges)).toEqual(['project'])
    expect(match.ranges.project).toEqual([[5, 8]])
  })
})
