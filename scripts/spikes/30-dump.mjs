/* eslint-disable no-undef */
// Pretty-prints a JSONL capture from 30-hooks-lab.mjs: node scripts/spikes/30-dump.mjs <scenario> [maxChars]
import { readFileSync } from 'node:fs'
const [scenario = 'ok', max = '900'] = process.argv.slice(2)
const drop = new Set(['transcript_path', 'scratchpad_dir', 'cwd', 'session_id'])
for (const line of readFileSync(`/tmp/tr-hooks-lab-out/${scenario}.jsonl`, 'utf8').split('\n')) {
  if (!line) continue
  const r = JSON.parse(line)
  const body = r.body ? JSON.stringify(Object.fromEntries(Object.entries(r.body).filter(([k]) => !drop.has(k)))) : (r.text ?? (r.out ? JSON.stringify(r.out) : ''))
  console.log(r.t, r.dir, r.event ?? '', body.slice(0, Number(max)))
  if (r.screen) console.log(r.screen)
}
