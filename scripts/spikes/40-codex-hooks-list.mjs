/* eslint-disable no-undef */
// Spike (docs/spikes/codex.md): ask `codex app-server` which hooks it sees for a cwd and what their
// trust status / current hash is. Extra argv are forwarded to `codex app-server` (e.g. -c overrides).
//   node scripts/spikes/40-codex-hooks-list.mjs -c 'hooks.Stop=[...]'
import { spawn } from 'node:child_process'

const cwd = process.env.LAB ?? '/tmp/tr-codex-lab'
const t0 = Date.now()
const p = spawn('codex', ['app-server', ...process.argv.slice(2)], { stdio: ['pipe', 'pipe', 'inherit'], cwd })
const giveUp = setTimeout(() => {
  console.error('timeout')
  p.kill()
}, 15000)
let buf = ''
p.stdout.on('data', (d) => {
  buf += d
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i)
    buf = buf.slice(i + 1)
    try {
      const m = JSON.parse(line)
      if (m.id === 2) {
        clearTimeout(giveUp)
        console.log(JSON.stringify(m.result ?? m.error, null, 1))
        console.error(`hooks/list answered after ${Date.now() - t0} ms`)
        p.kill()
      }
    } catch {
      /* not JSON */
    }
  }
})
const send = (o) => p.stdin.write(JSON.stringify(o) + '\n')
send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'tr-spike', version: '0' } } })
// No need to wait for the initialize reply: requests are handled in order.
send({ method: 'initialized' })
send({ id: 2, method: 'hooks/list', params: { cwds: [cwd] } })
