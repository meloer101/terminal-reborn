import { execFileSync } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { spawnOrphan } from './daemon-client'

function parentAndGroup(pid: number): { ppid: number; pgid: number } | null {
  try {
    const [ppid, pgid] = execFileSync('ps', ['-o', 'ppid=,pgid=', '-p', String(pid)], { encoding: 'utf8' }).trim().split(/\s+/).map(Number)
    return ppid !== undefined && pgid !== undefined ? { ppid, pgid } : null
  } catch {
    return null
  }
}

async function until<T>(read: () => T | null, timeoutMs = 5000): Promise<T> {
  const started = Date.now()
  for (;;) {
    const value = read()
    if (value !== null) return value
    if (Date.now() - started > timeoutMs) throw new Error('timed out')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe('spawnOrphan', () => {
  let dir = ''
  let pid = 0

  afterEach(() => {
    if (pid) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // Already gone.
      }
    }
    rmSync(dir, { recursive: true, force: true })
  })

  it("starts the program orphaned in a process group of its own: no tree kill of the app's processes reaches it", async () => {
    dir = mkdtempSync(join(tmpdir(), 'tr-orphan-'))
    const script = join(dir, 'probe.js')
    const pidFile = join(dir, 'pid')
    writeFileSync(
      script,
      `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid))
console.log('args', JSON.stringify(process.argv.slice(2)))
setTimeout(() => undefined, 30_000)`
    )
    const logPath = join(dir, 'out.log')
    const out = openSync(logPath, 'a')
    try {
      spawnOrphan(process.execPath, [script, '--dir', 'a b', '--socket', 'c'], { cwd: dir, env: process.env, out })
    } finally {
      closeSync(out)
    }

    pid = await until(() => {
      try {
        return Number(readFileSync(pidFile, 'utf8')) || null
      } catch {
        return null
      }
    })
    // Once the launcher is gone, launchd is the parent: the probe is no longer anyone's descendant.
    const info = await until(() => {
      const current = parentAndGroup(pid)
      return current && current.ppid === 1 ? current : null
    })
    expect(info.ppid).toBe(1)
    expect(info.pgid).toBe(pid)
    expect(info.pgid).not.toBe(parentAndGroup(process.pid)?.pgid)
    await until(() => (readFileSync(logPath, 'utf8').includes('args') ? true : null))
    expect(readFileSync(logPath, 'utf8')).toContain('args ["--dir","a b","--socket","c"]')
  })
})
