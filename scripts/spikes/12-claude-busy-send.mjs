/* eslint-disable no-undef */
// Q7 (Claude): send while the agent is busy. Does the message queue, or interrupt the running turn?
import { expRepo, launch, show, sleep, PASTE_START, PASTE_END, CLAUDE_SPINNER, claudeUserMessages } from './harness.mjs'

const cwd = expRepo()
const c = launch('claude', [], { cwd })
await c.waitFor(/Try "/, 20000)
await sleep(1500)
const tail = (n = 10) =>
  c
    .visible()
    .split('\n')
    .filter((l) => l.trim() && !/^[─ ]+$/.test(l))
    .slice(-n)
    .map((l) => '  | ' + l.slice(0, 110))
    .join('\n')

c.write(PASTE_START + 'Write a 250-word story about a cat, no tools.' + PASTE_END)
await sleep(300)
c.write('\r')
console.log('spinner after ms:', await c.waitFor(CLAUDE_SPINNER, 8000))
await sleep(1500) // turn is clearly running
const tBusy = Date.now()
c.write(PASTE_START + 'Reply with just the word STEER.' + PASTE_END)
await sleep(300)
c.write('\r')
await sleep(1200)
show('1.2s after sending while busy', tail(14))
// wait for everything to finish
await sleep(2000)
while (CLAUDE_SPINNER.test(c.visible()) && Date.now() - tBusy < 60000) await sleep(500)
await sleep(2500)
while (CLAUDE_SPINNER.test(c.visible()) && Date.now() - tBusy < 60000) await sleep(500)
show('final', tail(12))
c.kill()
await sleep(500)
console.log('\n--- order seen by the model ---')
for (const m of claudeUserMessages(cwd)) console.log(JSON.stringify(m).slice(0, 120))
process.exit(0)
