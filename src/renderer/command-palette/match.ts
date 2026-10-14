// Pure fuzzy matcher for the command palette. CJK-aware: matching is done per character
// (UTF-16 unit), so "结页" finds "结算页性能优化" without any pinyin support.
//
// A query is split on whitespace into tokens. Every token must match at least one field;
// the score is the sum of each token's best field score times that field's weight.
// Per token and field there are two tiers: a contiguous substring (strong) and an in-order
// subsequence with a tight span (weak, only for tokens of 2+ characters).

export interface MatchField {
  /** Stable key used to report highlight ranges. */
  key: string
  text: string
  /** Multiplier for this field's score (title > project > action ...). */
  weight: number
}

/** Half-open [start, end) range of UTF-16 units in the field text. */
export type Range = readonly [start: number, end: number]

export interface Match {
  score: number
  /** Highlight ranges per field key, sorted and merged. Only fields that won a token appear. */
  ranges: Record<string, Range[]>
}

interface TokenMatch {
  score: number
  ranges: Range[]
}

const WORD_CHAR = /[\p{L}\p{N}]/u

/** Lowercases without changing length (a few characters expand; those keep their original form). */
function fold(text: string): string {
  const lower = text.toLowerCase()
  return lower.length === text.length ? lower : text
}

function startsWord(text: string, index: number): boolean {
  return index === 0 || !WORD_CHAR.test(text[index - 1]!)
}

function matchSubstring(token: string, text: string): TokenMatch | null {
  let best: TokenMatch | null = null
  for (let at = text.indexOf(token); at !== -1; at = text.indexOf(token, at + 1)) {
    let score = 100 + Math.round((20 * token.length) / text.length) - Math.min(at, 20) * 0.5
    if (at === 0) score += 50
    else if (startsWord(text, at)) score += 30
    if (!best || score > best.score) best = { score, ranges: [[at, at + token.length]] }
  }
  return best
}

function matchSubsequence(token: string, text: string): TokenMatch | null {
  if (token.length < 2) return null
  const maxSpan = token.length * 2 + 2
  let best: { span: number; positions: number[] } | null = null
  for (let start = text.indexOf(token[0]!); start !== -1; start = text.indexOf(token[0]!, start + 1)) {
    const positions = [start]
    let from = start + 1
    for (let i = 1; i < token.length; i++) {
      const found = text.indexOf(token[i]!, from)
      if (found === -1) break
      positions.push(found)
      from = found + 1
    }
    if (positions.length < token.length) break // later starts cannot do better
    const span = positions[positions.length - 1]! - start + 1
    if (span <= maxSpan && (!best || span < best.span)) best = { span, positions }
  }
  if (!best) return null
  const gaps = best.span - token.length
  const ranges: Range[] = []
  for (const p of best.positions) {
    const last = ranges[ranges.length - 1]
    if (last && last[1] === p) ranges[ranges.length - 1] = [last[0], p + 1]
    else ranges.push([p, p + 1])
  }
  return { score: Math.max(5, 40 - gaps * 3 + (startsWord(text, best.positions[0]!) ? 8 : 0)), ranges }
}

function matchToken(token: string, text: string): TokenMatch | null {
  return matchSubstring(token, text) ?? matchSubsequence(token, text)
}

function mergeRanges(ranges: Range[]): Range[] {
  const sorted = ranges.slice().sort((a, b) => a[0] - b[0])
  const out: Range[] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && r[0] <= last[1]) out[out.length - 1] = [last[0], Math.max(last[1], r[1])]
    else out.push(r)
  }
  return out
}

export function tokenize(query: string): string[] {
  return fold(query).split(/\s+/).filter(Boolean)
}

/** Null when any token matches no field. An empty query matches everything with score 0. */
export function matchFields(query: string, fields: readonly MatchField[]): Match | null {
  const tokens = tokenize(query)
  if (tokens.length === 0) return { score: 0, ranges: {} }
  const folded = fields.map((f) => ({ field: f, text: fold(f.text) }))
  let score = 0
  const collected: Record<string, Range[]> = {}
  for (const token of tokens) {
    let best: { score: number; key: string; ranges: Range[] } | null = null
    for (const { field, text } of folded) {
      if (text.length === 0) continue
      const m = matchToken(token, text)
      if (!m) continue
      const weighted = m.score * field.weight
      if (!best || weighted > best.score) best = { score: weighted, key: field.key, ranges: m.ranges }
    }
    if (!best) return null
    score += best.score
    ;(collected[best.key] ??= []).push(...best.ranges)
  }
  const ranges: Record<string, Range[]> = {}
  for (const [key, list] of Object.entries(collected)) ranges[key] = mergeRanges(list)
  return { score, ranges }
}
