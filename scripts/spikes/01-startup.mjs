/* eslint-disable no-undef */
// Q6: what appears in a fresh, untrusted git repo? usage: node 01-startup.mjs claude|codex [extra args...]
import { launch, makeRepo, show, sleep } from './harness.mjs'
const [cmd, ...args] = process.argv.slice(2)
const cwd = makeRepo(`${cmd}-start`)
console.log('cwd', cwd)
const c = launch(cmd, args, { cwd })
await sleep(9000)
show(`${cmd} ${args.join(' ')} startup screen`, c.visible())
c.kill()
process.exit(0)
