/* eslint-disable no-undef */
// Q2/Q4/Q5 (Codex, free: nothing is submitted): how does the composer render bracketed pastes of various
// sizes, and does `-c tui.disable_paste_burst=true` exist?  usage: node 13-... [extra codex args...]
import { codexReady, codexRepo, launchCodex } from './codex-lib.mjs'
import { PASTE_START, PASTE_END, sleep } from './harness.mjs'

const cwd = codexRepo()
const c = launchCodex(cwd, process.argv.slice(2))
console.log('ready after ms:', await codexReady(c))
if (c.exited) console.log('EXITED', c.exited, c.screen().slice(-600))

const lorem = (n) => 'abcdefghij'.repeat(Math.ceil(n / 10)).slice(0, n)
const cjk = (n) => '你好世界今天天气不错'.repeat(Math.ceil(n / 10)).slice(0, n)
const cases = [
  ['short single line', 'reply with just OK'],
  ['3 lines', 'a\nb\nc'],
  ['10 lines', Array.from({ length: 10 }, (_, i) => `row ${i}`).join('\n')],
  ['ascii 900', lorem(900)],
  ['ascii 1000', lorem(1000)],
  ['ascii 1001', lorem(1001)],
  ['cjk 1000 chars', cjk(1000)],
  ['cjk 1001 chars', cjk(1001)],
  ['ascii 20000', lorem(20000)],
  ['cjk 5000', cjk(5000)]
]
const promptRows = () => {
  const rows = c.visible().split('\n')
  const i = rows.findIndex((l) => l.startsWith('›'))
  return rows
    .slice(i, i + 4)
    .map((l) => l.trimEnd().slice(0, 100))
    .filter((l) => l.trim())
}
for (const [name, text] of cases) {
  c.write(PASTE_START + text + PASTE_END)
  await c.settle(500, 8000)
  console.log(name.padEnd(20), JSON.stringify(promptRows()))
  // clear composer: Ctrl+C clears non-empty input in codex
  c.write('\x03')
  await sleep(600)
}
c.kill()
process.exit(0)
