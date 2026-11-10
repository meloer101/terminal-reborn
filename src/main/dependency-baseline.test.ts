// `npm run lint:deps` ignores the imports listed in .dependency-cruiser-known-violations.json (the renderer layer
// rules came in with 33 of them). That list only shrinks: one fixed must leave it, and a new one cannot slip in by
// writing the file again unnoticed, because the list here has to equal what the rules find today.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '../..')

interface Violation {
  from: string
  to: string
  rule: { name: string }
}

const key = (v: Violation): string => `${v.rule.name}: ${v.from} → ${v.to}`

describe('dependency-cruiser known violations', () => {
  it('lists exactly the imports that break the rules today', () => {
    const out = execFileSync(join(ROOT, 'node_modules/.bin/depcruise'), ['src', '--config', '.dependency-cruiser.cjs', '--no-ignore-known', '--output-type', 'json'], {
      cwd: ROOT,
      maxBuffer: 256 * 1024 * 1024
    }).toString()
    const found = (JSON.parse(out) as { summary: { violations: Violation[] } }).summary.violations.map(key).sort()
    const known = (JSON.parse(readFileSync(join(ROOT, '.dependency-cruiser-known-violations.json'), 'utf8')) as Violation[]).map(key).sort()
    expect(known, 'fixed ones leave .dependency-cruiser-known-violations.json; new ones are fixed, not added').toEqual(found)
  }, 60_000)
})
