/* eslint-disable no-undef */
// Q3 (Codex): a /command whose args exceed the 1000-char placeholder threshold. Does it still run as a command?
// Uses an unknown command first (local error only), then /status.
import { CODEX_BUSY, codexReady, codexRepo, codexUserMessages, launchCodex } from './codex-lib.mjs'
import { PASTE_START, PASTE_END, sleep } from './harness.mjs'

const cwd = codexRepo()
for (const cmd of ['/zzznotacmd', '/status']) {
  const c = launchCodex(cwd)
  await codexReady(c)
  c.write(PASTE_START + cmd + ' ' + 'abcdefghij'.repeat(110) + PASTE_END)
  await sleep(700)
  const row = c.visible().split('\n').filter((l) => l.startsWith('›')).at(-1)
  c.write('\r')
  await sleep(1800)
  const s = c.visible()
  const outcome = /Session:\s+[0-9a-f-]{8}/.test(s)
    ? 'EXECUTED as command'
    : s.match(/Unrecognized command '[^']*'/)?.[0] ?? (CODEX_BUSY.test(s) ? 'SENT TO MODEL as plain text' : '?')
  console.log(cmd.padEnd(14), 'composer:', JSON.stringify(row?.slice(0, 50)), '->', outcome)
  c.kill()
  await sleep(300)
}
console.log('--- messages that reached the model ---')
for (const m of codexUserMessages(cwd)) console.log(JSON.stringify(m).slice(0, 60), `(${m.length})`)
process.exit(0)
