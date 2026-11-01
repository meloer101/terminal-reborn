/* eslint-disable no-undef */
// How far the transcript JSONL lags the screen (remote control, PRD §6.16): one prompt with a long text answer and a
// tool call. Logs when each new transcript line lands (the screen streams the text meanwhile).
//   usage: cd <a trusted folder> && node scripts/spikes/52-transcript-latency-lab.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { claudeWaitIdle, launch, sleep } from './harness.mjs'

const cwd = process.cwd()
const dir = join(process.env.HOME, '.claude', 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'))
const newest = () =>
  readdirSync(dir)
    .filter((x) => x.endsWith('.jsonl'))
    .map((x) => [join(dir, x), statSync(join(dir, x)).mtimeMs])
    .sort((a, b) => b[1] - a[1])[0][0]

const c = launch('claude', [], { cwd })
await c.waitFor(/❯/, 30000)
await sleep(2500)
const submit = async (text) => {
  c.write(text)
  await sleep(300)
  c.write('\r')
}
await submit('Reply with only the word OK.')
await claudeWaitIdle(c, { maxMs: 60000 })
const file = newest()
let seen = readFileSync(file, 'utf8').split('\n').filter(Boolean).length
const t0 = Date.now()
const events = []
const poll = setInterval(() => {
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean)
  for (const l of lines.slice(seen)) {
    const o = JSON.parse(l)
    const kinds = Array.isArray(o.message?.content) ? o.message.content.map((b) => b.type).join('+') : o.type
    events.push(`${String(Date.now() - t0).padStart(6)} ms  ${o.type}${o.subtype ? '/' + o.subtype : ''} ${kinds}`)
  }
  seen = lines.length
}, 50)
await submit('Run `ls` with the Bash tool once, then write a 250-word paragraph about tide pools. No headings.')
await claudeWaitIdle(c, { maxMs: 120000 })
await sleep(1500)
clearInterval(poll)
console.log(events.join('\n'))
c.write('\x03')
await sleep(300)
c.write('\x03')
await sleep(1000)
c.kill()
process.exit(0)
