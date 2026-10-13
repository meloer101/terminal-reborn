/* eslint-disable no-undef */
// Q2 (Claude): which inputs does the model actually receive wrapped in <pasted_content>? Does it still
// follow an instruction that arrives pasted? Ground truth = the session JSONL.
import { expRepo, launch, sleep, PASTE_START, PASTE_END, claudeWaitIdle, claudeUserMessages } from './harness.mjs'

const cwd = expRepo()
const c = launch('claude', [], { cwd })
await c.waitFor(/Try "/, 20000)
await sleep(1500)

const variants = [
  ['typed single line', () => c.write('Reply with just the word ALPHA.')],
  ['pasted single line (short)', () => c.write(PASTE_START + 'Reply with just the word BRAVO.' + PASTE_END)],
  ['pasted 3 lines (2 newlines, inline)', () => c.write(PASTE_START + 'Reply with just the word CHARLIE.\nnote\nnote' + PASTE_END)],
  ['pasted 4 lines (placeholder)', () => c.write(PASTE_START + 'Reply with just the word DELTA.\nnote\nnote\nnote' + PASTE_END)],
  [
    'pasted 850 chars single line (placeholder)',
    () => c.write(PASTE_START + 'Reply with just the word ECHO. ' + 'filler '.repeat(120) + PASTE_END)
  ],
  [
    'typed first char + pasted rest',
    () => {
      c.write('R')
      return sleep(100).then(() => c.write(PASTE_START + 'eply with just the word FOXTROT.\nnote\nnote\nnote' + PASTE_END))
    }
  ],
  ['typed line + Alt+Enter + typed line', async () => {
    c.write('Reply with just the word GOLF.')
    await sleep(100)
    c.write('\x1b\r')
    await sleep(100)
    c.write('(second typed line)')
  }]
]

for (const [name, fn] of variants) {
  await fn()
  await sleep(500)
  c.write('\r')
  const done = await claudeWaitIdle(c)
  console.log(`${name.padEnd(46)} turn ${done ? 'completed' : 'NOT completed'}`)
  await sleep(500)
}
c.kill()
await sleep(500)
console.log('\n--- user messages as received by the model (JSON-escaped, head) ---')
for (const m of claudeUserMessages(cwd)) console.log(JSON.stringify(m).slice(0, 260))
process.exit(0)
