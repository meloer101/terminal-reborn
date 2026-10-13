/* eslint-disable no-undef */
// Q3 (Codex): slash commands via paste vs keystroke; fuzzy-prefix behaviour; trailing-space trick.
// One fresh Codex per case so state never leaks. Local-only commands (/status).
import { codexReady, codexRepo, codexUserMessages, launchCodex } from './codex-lib.mjs'
import { PASTE_START, PASTE_END, sleep } from './harness.mjs'

const cwd = codexRepo()
const cases = [
  ['paste "/status"', (c) => c.write(PASTE_START + '/status' + PASTE_END)],
  ['paste "/stat" (partial)', (c) => c.write(PASTE_START + '/stat' + PASTE_END)],
  ['paste "/status " (exact + trailing space)', (c) => c.write(PASTE_START + '/status ' + PASTE_END)],
  ['paste "/stat " (partial + trailing space)', (c) => c.write(PASTE_START + '/stat ' + PASTE_END)],
  [
    'key "/" then paste "status"',
    async (c) => {
      c.write('/')
      await sleep(200)
      c.write(PASTE_START + 'status' + PASTE_END)
    }
  ]
]
for (const [name, fn] of cases) {
  const c = launchCodex(cwd)
  await codexReady(c)
  await fn(c)
  await sleep(600)
  c.write('\r')
  await sleep(1800)
  const s = c.visible()
  const ran = /Session:\s+[0-9a-f-]{8}/.test(s)
  const unrec = s.match(/Unrecognized command '[^']*'/)
  const working = /Working \(/.test(s)
  console.log(
    name.padEnd(44),
    ran ? 'EXECUTED /status' : unrec ? unrec[0] : working ? 'SENT TO MODEL' : '?',
    JSON.stringify(c.visible().split('\n').filter((l) => l.startsWith('›')).at(-1)?.slice(0, 40))
  )
  c.kill()
  await sleep(300)
}
console.log('--- messages that reached the model ---')
for (const m of codexUserMessages(cwd)) console.log(JSON.stringify(m).slice(0, 100))
process.exit(0)
