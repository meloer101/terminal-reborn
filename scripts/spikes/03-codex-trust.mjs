/* eslint-disable no-undef */
// Q6 (Codex): pre-accept folder trust with a per-launch -c override (no global config write).
import { realpathSync } from 'node:fs'
import { launch, makeRepo, show, sleep } from './harness.mjs'
const cwd = realpathSync(makeRepo('codex-trust'))
console.log('cwd', cwd)
const c = launch(
  'codex',
  [
    '-c',
    'check_for_update_on_startup=false',
    '-c',
    process.argv[2] === 'inline'
      ? `projects={"${cwd}"={trust_level="trusted"}}`
      : `projects."${cwd}".trust_level="trusted"`
  ],
  { cwd }
)
await sleep(7000)
show('codex with -c projects override', c.visible())
c.kill()
process.exit(0)
