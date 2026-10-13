/* eslint-disable no-undef */
// Q7 (Codex): Enter while a turn is running: queue, steer or interrupt?
import { CODEX_BUSY, codexReady, codexRepo, codexUserMessages, launchCodex } from './codex-lib.mjs'
import { PASTE_START, PASTE_END, sleep, show } from './harness.mjs'

const cwd = codexRepo()
const c = launchCodex(cwd)
await codexReady(c)
const tail = (n = 12) =>
  c
    .visible()
    .split('\n')
    .filter((l) => l.trim())
    .slice(-n)
    .map((l) => '  | ' + l.slice(0, 110))
    .join('\n')

c.write(PASTE_START + 'Write a 250-word story about a cat. Do not use tools.' + PASTE_END)
await sleep(200)
c.write('\r')
console.log('busy after ms:', await c.waitFor(CODEX_BUSY, 8000))
await sleep(2500)
c.write(PASTE_START + 'Reply with just the word STEER.' + PASTE_END)
await sleep(200)
c.write('\r')
await sleep(1200)
show('1.2s after Enter while busy', tail())
const t = Date.now()
await sleep(2000)
while (Date.now() - t < 90000 && CODEX_BUSY.test(c.visible())) await sleep(500)
await sleep(1500)
while (Date.now() - t < 90000 && CODEX_BUSY.test(c.visible())) await sleep(500)
show('final', tail())
console.log('--- user messages received, in order ---')
for (const m of codexUserMessages(cwd)) console.log(JSON.stringify(m).slice(0, 100))
c.kill()
process.exit(0)
