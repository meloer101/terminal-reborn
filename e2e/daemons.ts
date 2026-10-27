import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

/**
 * Ends a throwaway profile's pty daemon and the agents it launched. The daemon outlives the app by design and keeps
 * its sessions on a SIGTERM (PRD §6.8), so a test that sends one leaves it running for good. SIGKILL closes the PTYs,
 * which hangs up their shells; agents carry `<profile>/daemon/…` in their `--settings` and are matched directly.
 */
export function killProfileDaemons(profile: string): number {
  const marker = join(profile, 'daemon')
  let ps: string
  try {
    ps = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' })
  } catch {
    return 0
  }
  let killed = 0
  for (const line of ps.split('\n')) {
    if (!line.includes(marker)) continue
    const pid = Number(line.trim().split(/\s+/)[0])
    if (!pid || pid === process.pid) continue
    try {
      process.kill(pid, 'SIGKILL')
      killed++
    } catch {
      // Already gone.
    }
  }
  return killed
}
