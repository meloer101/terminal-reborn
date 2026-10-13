/* eslint-disable no-undef */
// Q5: time from writing a bracketed paste until the echo/placeholder is visible, vs size (chars and UTF-8 bytes).
// Free (nothing submitted). usage: node 17-... claude|codex  (claude needs EXP_REPO_FILE)
import { codexReady, codexRepo, launchCodex } from './codex-lib.mjs'
import { expRepo, launch, sleep, PASTE_START, PASTE_END } from './harness.mjs'

const agent = process.argv[2]
let c
if (agent === 'claude') {
  c = launch('claude', [], { cwd: expRepo() })
  await c.waitFor(/Try "/, 20000)
  await sleep(1500)
} else {
  c = launchCodex(codexRepo())
  await codexReady(c)
}
const placeholder = agent === 'claude' ? '[Pasted text' : '[Pasted Content'
const lorem = (n) => 'abcdefghij'.repeat(Math.ceil(n / 10)).slice(0, n)
const cjk = (n) => '你好世界今天天气不错'.repeat(Math.ceil(n / 10)).slice(0, n)
const cases = [
  ['ascii 50', 'START' + lorem(45)],
  ['ascii 700', 'START' + lorem(695)],
  ['ascii 5000', lorem(5000)],
  ['ascii 20000', lorem(20000)],
  ['ascii 60000', lorem(60000)],
  ['ascii 200000', lorem(200000)],
  ['cjk 700', cjk(700)],
  ['cjk 5000', cjk(5000)],
  ['cjk 20000', cjk(20000)],
  ['cjk 60000', cjk(60000)]
]
for (const [name, text] of cases) {
  const needle = text.length > (agent === 'claude' ? 800 : 1000) ? placeholder : text.slice(0, 12)
  const t0 = Date.now()
  c.write(PASTE_START + text + PASTE_END)
  const ms = await c.waitFor(needle, 30000)
  await c.settle(400, 30000)
  const total = Date.now() - t0 - 400
  console.log(
    name.padEnd(14),
    `${String(text.length).padStart(7)} chars`,
    `${String(Buffer.byteLength(text)).padStart(7)} B`,
    `needle visible after ${String(ms).padStart(5)} ms`,
    `quiet after ~${total} ms`
  )
  c.write('\x03')
  await sleep(800)
}
c.kill()
process.exit(0)
