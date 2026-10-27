// Every launchApp() records its throwaway profile here; after the run, any pty daemon still alive under one of them is
// ended. A test that fails or times out before its app quits would otherwise leave the daemon and its shells running
// for days. Only this run's profiles are touched: never the user's own daemon, nor another checkout's test run.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { killProfileDaemons } from './daemons'

export default function globalSetup(): () => void {
  const list = join(mkdtempSync(join(tmpdir(), 'tr-e2e-run-')), 'profiles')
  writeFileSync(list, '')
  process.env.TR_E2E_PROFILES = list
  return () => {
    const profiles = new Set(readFileSync(list, 'utf8').split('\n').filter(Boolean))
    let killed = 0
    for (const profile of profiles) killed += killProfileDaemons(profile)
    if (killed > 0) console.log(`ended ${killed} leftover pty daemon process(es) from this run`)
    rmSync(dirname(list), { recursive: true, force: true })
  }
}
