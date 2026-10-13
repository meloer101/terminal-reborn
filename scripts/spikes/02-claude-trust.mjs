/* eslint-disable no-undef */
// Q6 (Claude): accept the trust dialog in a fresh repo, then show what got persisted and
// that a second launch in the same dir has no dialog.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { realpathSync } from 'node:fs'
import { launch, makeRepo, show, sleep } from './harness.mjs'

const cwd = makeRepo('claude-trust')
const real = realpathSync(cwd)
const read = () => JSON.parse(readFileSync(`${homedir()}/.claude.json`, 'utf8')).projects?.[real]
console.log('cwd', real, 'before:', JSON.stringify(read()))

let c = launch('claude', [], { cwd })
console.log('dialog after ms:', await c.waitFor('Yes, I trust this folder', 15000))
await sleep(1500) // keys sent <~1s after the dialog first renders are ignored
c.write('\x1b[B') // down
await sleep(300)
show('after Down', c.visible().split('\n').slice(-6).join('\n'))
c.write('\r')
console.log('main UI after ms:', await c.waitFor(/\? for shortcuts|bypass|Try "/, 20000))
await sleep(1500)
show('main UI', c.visible())
c.kill()
await sleep(1000)
console.log('after accept:', JSON.stringify(read()))

c = launch('claude', [], { cwd })
const ms = await c.waitFor('Yes, I trust this folder', 6000)
console.log('second launch dialog shown?', ms >= 0)
await sleep(2000)
show('second launch', c.visible())
c.kill()
console.log('REPO', real)
process.exit(0)
