/* eslint-disable no-undef */
// Q2/Q5 (Claude, free: nothing is submitted): what does the input box show after a bracketed paste
// of various sizes? Needs EXP_REPO = an already-trusted repo (see 02-claude-trust.mjs).
import { expRepo, launch, show, sleep, PASTE_START, PASTE_END } from './harness.mjs'

const cwd = expRepo()
const c = launch('claude', [], { cwd })
await c.waitFor(/Try "/, 20000)
await sleep(1500)

const lorem = (n) => 'abcdefghij'.repeat(Math.ceil(n / 10)).slice(0, n)
const cases = [
  ['single line 20 chars', 'reply with just OK now'],
  ['single line 200 chars', lorem(200)],
  ['single line 800 chars', lorem(800)],
  ['single line 1000 chars', lorem(1000)],
  ['single line 1500 chars', lorem(1500)],
  ['2 lines short', 'line one\nline two'],
  ['3 lines short', 'a\nb\nc'],
  ['5 lines short', 'a\nb\nc\nd\ne'],
  ['10 lines short', Array.from({ length: 10 }, (_, i) => `row ${i}`).join('\n')],
  ['20000 ASCII chars', lorem(20000)],
  ['5000 CJK chars', '你好世界今天天气不错'.repeat(500)]
]
const only = process.argv[2]
for (const [name, text] of cases) {
  if (only && !name.includes(only)) continue
  const t0 = Date.now()
  c.write(PASTE_START + text + PASTE_END)
  await c.settle(600, 15000)
  const bytes = Buffer.byteLength(text)
  const vis = c.visible().split('\n').filter((l) => l.trim() && !/^[─ ]+$/.test(l))
  show(`${name} (${text.length} chars, ${bytes} bytes) settled in ${Date.now() - t0}ms`, vis.slice(-12).join('\n').slice(0, 1500))
  // clear the input: Ctrl+C once clears a non-empty prompt
  c.write('\x03')
  await sleep(700)
  const after = c.visible().split('\n').filter((l) => l.startsWith('❯'))
  console.log('after Ctrl+C prompt line:', JSON.stringify(after.slice(-1)))
}
c.kill()
process.exit(0)
