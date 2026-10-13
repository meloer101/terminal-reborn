/* eslint-disable no-undef */
// Q3 (Claude): a "/cmd" whose args are long/multi-line (becomes a placeholder). Compare keystroke "/" + paste
// of the rest vs one paste. Uses a non-existent command so nothing real is executed.
import { expRepo, launch, sleep, PASTE_START, PASTE_END } from './harness.mjs'

const c = launch('claude', [], { cwd: expRepo() })
await c.waitFor(/Try "/, 20000)
await sleep(1500)
const rows = () =>
  c
    .visible()
    .split('\n')
    .filter((l) => l.trim() && !/^[─ ]+$/.test(l))
    .slice(-5)
    .map((l) => '    | ' + l.slice(0, 100))
    .join('\n')

const args = 'zzznotacmd line1\nline2\nline3\nline4'
for (const [name, fn] of [
  ['one paste "/zzznotacmd ..." (4 lines)', async () => c.write(PASTE_START + '/' + args + PASTE_END)],
  [
    'key "/" + paste rest (4 lines)',
    async () => {
      c.write('/')
      await sleep(200)
      c.write(PASTE_START + args + PASTE_END)
    }
  ]
]) {
  await fn()
  await sleep(700)
  console.log(`\n### ${name}: before Enter`)
  console.log(rows())
  c.write('\r')
  await sleep(2500)
  console.log('after Enter')
  console.log(rows())
  c.write('\x03')
  await sleep(800)
}
c.kill()
process.exit(0)
