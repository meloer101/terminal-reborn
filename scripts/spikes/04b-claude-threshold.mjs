/* eslint-disable no-undef */
// Q2 (Claude, free): exact placeholder thresholds (chars vs lines vs bytes). Needs EXP_REPO.
import { expRepo, launch, sleep, PASTE_START, PASTE_END } from './harness.mjs'

const c = launch('claude', [], { cwd: expRepo() })
await c.waitFor(/Try "/, 20000)
await sleep(1500)

const lorem = (n) => 'abcdefghij'.repeat(Math.ceil(n / 10)).slice(0, n)
const cjk = (n) => '你好世界今天天气不错'.repeat(Math.ceil(n / 10)).slice(0, n)
const cases = [
  ['ascii 800', lorem(800)],
  ['ascii 801', lorem(801)],
  ['ascii 850', lorem(850)],
  ['ascii 900', lorem(900)],
  ['ascii 1000', lorem(1000)],
  ['cjk 300 chars (900 bytes)', cjk(300)],
  ['cjk 800 chars (2400 bytes)', cjk(800)],
  ['cjk 801 chars', cjk(801)],
  ['cjk 1000 chars', cjk(1000)],
  ['4 lines (3 newlines)', 'a\nb\nc\nd'],
  ['4 lines + long (500) first', lorem(500) + '\nb\nc\nd'],
  ['5 lines CRLF', 'a\r\nb\r\nc\r\nd\r\ne'],
  ['single line with trailing \\n', 'hello\n'],
  ['two single-line pastes 600+600', lorem(600) + PASTE_END + PASTE_START + lorem(600)]
]
for (const [name, text] of cases) {
  c.write(PASTE_START + text + PASTE_END)
  await c.settle(500, 8000)
  const vis = c.visible().split('\n')
  const i = vis.findIndex((l) => l.startsWith('❯'))
  const ph = vis.slice(i, i + 3).join(' | ').match(/\[Pasted text[^\]]*\]/g)
  console.log(name.padEnd(34), ph ? ph.join(' ') : `inline (${vis.slice(i).filter((l) => l.trim()).length} rows)`)
  c.write('\x03')
  await sleep(500)
}
c.kill()
process.exit(0)
