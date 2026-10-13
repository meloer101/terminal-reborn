/* eslint-disable no-undef */
// Print user/assistant text pairs of the newest (or Nth) Claude session for the experiment repo.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { expRepo } from './harness.mjs'

const dir = join(process.env.HOME, '.claude', 'projects', expRepo().replace(/[^A-Za-z0-9]/g, '-'))
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.jsonl'))
  .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
  .sort((a, b) => b.t - a.t)
const file = files[Number(process.argv[2] ?? 0)]
for (const line of readFileSync(join(dir, file.f), 'utf8').split('\n')) {
  if (!line) continue
  const o = JSON.parse(line)
  if (o.type !== 'user' && o.type !== 'assistant') continue
  const m = o.message?.content
  const text = typeof m === 'string' ? m : (m ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('')
  if (text) console.log(o.type === "user" ? "U" : "A", `(${text.length} chars)`, JSON.stringify(text).slice(0, 100))
}
