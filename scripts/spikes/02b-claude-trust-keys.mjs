/* eslint-disable no-undef */
// Q6 (Claude): which key selects "Yes, I trust this folder"?
import { launch, makeRepo, show, sleep } from './harness.mjs'
const cwd = makeRepo('claude-trust2')
const c = launch('claude', [], { cwd })
await c.waitFor('Yes, I trust this folder', 15000)
await sleep(1500)
for (const [name, seq] of [
  ['ESC [ B', '\x1b[B'],
  ['ESC O B', '\x1bOB'],
  ['digit 2', '2']
]) {
  c.write(seq)
  await sleep(600)
  show(name, c.visible().split('\n').slice(-6).join('\n'))
}
c.kill()
process.exit(0)
