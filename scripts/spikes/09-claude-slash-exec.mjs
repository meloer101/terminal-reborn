/* eslint-disable no-undef */
// Q3 (Claude): what does Enter do with /commands that were pasted vs typed? Local-only commands (/model).
// Ground truth for "went to the model" = session JSONL.
import { expRepo, launch, sleep, PASTE_START, PASTE_END, claudeUserMessages } from './harness.mjs'

const cwd = expRepo()
const c = launch('claude', [], { cwd })
await c.waitFor(/Try "/, 20000)
await sleep(1500)

const tail = (n = 3) =>
  c
    .visible()
    .split('\n')
    .filter((l) => l.trim() && !/^[─ ]+$/.test(l))
    .slice(-n)
    .map((l) => '    | ' + l.slice(0, 100))
    .join('\n')
const reset = async () => {
  c.write('\x1b')
  await sleep(700)
  c.write('\x03')
  await sleep(700)
  const clean = /Select model/.test(c.visible()) ? 'PICKER STILL OPEN' : 'clean'
  console.log('    (after reset:', clean + ')')
}
const cases = [
  ['paste "/model" then \\r', async () => c.write(PASTE_START + '/model' + PASTE_END), '\r'],
  [
    'key "/" + paste "model" then \\r',
    async () => {
      c.write('/')
      await sleep(200)
      c.write(PASTE_START + 'model' + PASTE_END)
    },
    '\r'
  ],
  ['paste "/mod" (partial) then \\r', async () => c.write(PASTE_START + '/mod' + PASTE_END), '\r'],
  ['paste "/mod " (trailing space) then \\r', async () => c.write(PASTE_START + '/mod ' + PASTE_END), '\r'],
  ['paste "/zzznotacmd" then \\r', async () => c.write(PASTE_START + '/zzznotacmd' + PASTE_END), '\r'],
  ['paste "/model " (full name + space) then \\r', async () => c.write(PASTE_START + '/model ' + PASTE_END), '\r']
  // NOTE: never run "/model <arg>" here: it can persist the model into the user's global settings.
]
for (const [name, setup, enter] of cases) {
  await setup()
  await sleep(600)
  c.write(enter)
  await sleep(1500)
  console.log(`\n### ${name}`)
  console.log(/Select model/.test(c.visible()) ? '    | PICKER OPEN (command executed)' : tail(6))
  await reset()
}
c.kill()
await sleep(500)
console.log('\n--- messages that reached the model ---')
for (const m of claudeUserMessages(cwd)) console.log(JSON.stringify(m).slice(0, 200))
process.exit(0)
