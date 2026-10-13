/* eslint-disable no-undef */
// Q4 (Codex): which spelling of the paste-burst switch does 0.142.5 accept under --strict-config?
import { codexRepo, launchCodex } from './codex-lib.mjs'
import { sleep } from './harness.mjs'

const cwd = codexRepo()
for (const key of ['tui.disable_paste_burst=true', 'disable_paste_burst=true', 'tui.no_such_key_zzz=true']) {
  const c = launchCodex(cwd, ['--strict-config', '-c', key])
  await sleep(3500)
  const first = c.screen().split('\n').filter((l) => l.trim()).slice(0, 3)
  console.log(key.padEnd(34), c.exited ? `EXITED code=${c.exited.exitCode}` : 'running', JSON.stringify(first).slice(0, 220))
  c.kill()
  await sleep(300)
}
process.exit(0)
