/* eslint-disable no-undef */
// Q1/Q4 (Codex): bracketed paste, then \r after N ms. Does it submit, or become a newline?
// usage: node 14-... <delays comma list> <prompt|gen:ascii:N|gen:cjk:N> [extra codex args...]
// Ground truth = Codex rollout JSONL.
import { CODEX_BUSY, codexReady, codexRepo, codexUserMessages, launchCodex } from './codex-lib.mjs'
import { PASTE_START, PASTE_END, sleep } from './harness.mjs'

const delays = (process.argv[2] ?? '0,50,150').split(',').map(Number)
const arg = process.argv[3] ?? 'Reply with just OK.'
const gen = /^gen:(ascii|cjk):(\d+)$/.exec(arg)
const head = 'Reply with just OK. Ignore the filler that follows. '
const text = gen
  ? head + (gen[1] === 'cjk' ? '你好世界今天天气不错' : 'lorem ipsum ').repeat(Number(gen[2]) / 10).slice(0, Number(gen[2]))
  : arg.replace(/\\n/g, '\n')
const cwd = codexRepo()
const c = launchCodex(cwd, process.argv.slice(4))
await codexReady(c)

const promptRow = () => c.visible().split('\n').filter((l) => l.startsWith('›')).at(-1) ?? ''
for (const d of delays) {
  const before = codexUserMessages(cwd).length
  c.write(PASTE_START + text + PASTE_END)
  await sleep(d)
  c.write('\r')
  const busy = (await c.waitFor(CODEX_BUSY, 5000)) >= 0
  let done = false
  if (busy) {
    const t = Date.now()
    await sleep(1000)
    while (Date.now() - t < 60000 && CODEX_BUSY.test(c.visible())) await sleep(300)
    done = true
    await sleep(800)
  }
  const after = codexUserMessages(cwd).length
  console.log(
    `paste, wait ${String(d).padStart(4)}ms, \\r`.padEnd(30),
    busy ? 'turn started' : 'NO TURN',
    `rollout user msgs +${after - before}`,
    busy ? '' : `prompt=${JSON.stringify(promptRow().slice(0, 70))}`
  )
  if (!busy) {
    c.write('\x03')
    await sleep(600)
  }
  void done
}
console.log('--- messages received (head) ---')
for (const m of codexUserMessages(cwd)) console.log(JSON.stringify(m).slice(0, 110), `(${m.length} chars)`)
c.kill()
process.exit(0)
