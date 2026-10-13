/* eslint-disable no-undef */
// Q4 (Codex): paste-burst window. RAW (non-bracketed) text in one write, then \r after N ms.
// usage: node 16-... <delays> [extra codex args...]
import { CODEX_BUSY, codexReady, codexRepo, codexUserMessages, launchCodex } from './codex-lib.mjs'
import { sleep } from './harness.mjs'

const delays = (process.argv[2] ?? '0,150').split(',').map(Number)
const cwd = codexRepo()
const c = launchCodex(cwd, process.argv.slice(3))
await codexReady(c)
const promptRows = () => {
  const rows = c.visible().split('\n')
  const i = rows.findIndex((l) => l.startsWith('›'))
  return rows
    .slice(i, i + 3)
    .map((l) => l.trimEnd().slice(0, 60))
    .filter((l) => l.trim() && !l.includes('gpt-5'))
}
for (const d of delays) {
  const before = codexUserMessages(cwd).length
  c.write('Reply with just OK.')
  await sleep(d)
  c.write('\r')
  const busy = (await c.waitFor(CODEX_BUSY, 3000)) >= 0
  console.log(`raw text, wait ${String(d).padStart(4)}ms, \\r`.padEnd(30), busy ? 'SUBMITTED' : 'not submitted', JSON.stringify(promptRows()))
  if (busy) {
    await sleep(1000)
    const t = Date.now()
    while (Date.now() - t < 60000 && CODEX_BUSY.test(c.visible())) await sleep(300)
    await sleep(800)
  } else {
    c.write('\x03')
    await sleep(700)
  }
  void before
}
c.kill()
process.exit(0)
