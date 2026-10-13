/* eslint-disable no-undef */
// Q1 (Claude): does a separately written \r after a bracketed paste submit? One real (trivial) turn.
// usage: EXP_REPO=... node 05-claude-submit.mjs <delayMs> [text]
import { expRepo, launch, show, sleep, PASTE_START, PASTE_END } from './harness.mjs'

const delay = Number(process.argv[2] ?? 250)
const text = process.argv[3] ?? 'Reply with just OK and nothing else.'
const c = launch('claude', [], { cwd: expRepo() })
await c.waitFor(/Try "/, 20000)
await sleep(1500)

c.write(PASTE_START + text + PASTE_END)
await sleep(delay)
c.write('\r')
const t0 = Date.now()
await sleep(1500)
show(`delay ${delay}ms: 1.5s after \\r`, c.visible().split('\n').filter((l) => l.trim()).slice(-8).join('\n'))
const ok = await c.waitFor(/● OK|● Ok/, 30000)
console.log('model answered after ms:', ok, 'total', Date.now() - t0)
await sleep(1500)
show('final', c.visible().split('\n').filter((l) => l.trim()).slice(-10).join('\n'))
c.kill()
process.exit(0)
