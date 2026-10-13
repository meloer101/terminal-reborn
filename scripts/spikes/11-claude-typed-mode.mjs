/* eslint-disable no-undef */
// Q3/Q5 (Claude): "typed" delivery (no bracketed paste) for /commands with long or multi-line args.
// Does raw text stay inline (no placeholder), and does a /command still execute? Local-only command used.
import { expRepo, launch, sleep } from './harness.mjs'

const c = launch('claude', [], { cwd: expRepo() })
await c.waitFor(/Try "/, 20000)
await sleep(1500)
const rows = (n = 5) =>
  c
    .visible()
    .split('\n')
    .filter((l) => l.trim() && !/^[─ ]+$/.test(l))
    .slice(-n)
    .map((l) => '    | ' + l.slice(0, 100))
    .join('\n')

console.log('### A: typed multi-line unknown command, newline = ESC CR, chunks of 1 line')
for (const [i, line] of ['/zzznotacmd line1', 'line2', 'line3', 'line4'].entries()) {
  if (i > 0) c.write('\x1b\r')
  c.write(line)
  await sleep(50)
}
await sleep(500)
console.log(rows())
c.write('\r')
await sleep(2000)
console.log('after Enter:\n' + rows())
await sleep(1500)
c.write('\x03')
await sleep(800)

console.log('\n### B: raw 1200-char single line in ONE write (no brackets)')
c.write('abcdefghij'.repeat(120))
await sleep(800)
console.log(rows(3))
c.write('\x03')
await sleep(800)

console.log('\n### C: raw 1200-char single line in 12 chunks of 100, 15ms apart')
for (let i = 0; i < 12; i++) {
  c.write('abcdefghij'.repeat(10))
  await sleep(15)
}
await sleep(800)
console.log(rows(3))
c.write('\x03')
await sleep(800)

console.log('\n### D: raw 5-line text in ONE write using \\n as separators')
c.write('l1\nl2\nl3\nl4\nl5')
await sleep(800)
console.log(rows(6))
c.write('\x03')
await sleep(500)
c.kill()
process.exit(0)
