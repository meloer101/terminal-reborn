import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { cancelCapturedScript, startCapturedScript } from './script-run'

const cwd = mkdtempSync(join(tmpdir(), 'tr-script-run-'))
afterAll(() => rmSync(cwd, { recursive: true, force: true }))

const baseEnv = { ...process.env, SHELL: '/bin/sh' }

describe('startCapturedScript', () => {
  it('runs in the login shell, keeps the output and TR_PORT, and returns the exit code', async () => {
    const result = await startCapturedScript({
      key: 'ok',
      cwd,
      script: 'printf "hello $TR_PORT\\n"',
      baseEnv,
      extraEnv: { TR_PORT: '41020' }
    })
    expect(result.cancelled).toBe(false)
    expect(result.code).toBe(0)
    expect(result.output).toContain('hello 41020')
  })

  it('keeps a failing script output and its exit code', async () => {
    const result = await startCapturedScript({
      key: 'fail',
      cwd,
      script: 'printf "FAIL src/nav.test.ts\\n"; exit 2',
      baseEnv
    })
    expect(result).toMatchObject({ cancelled: false, code: 2 })
    expect(result.output).toContain('FAIL src/nav.test.ts')
  })

  it('cancel stops a running script', async () => {
    const pending = startCapturedScript({ key: 'sleep', cwd, script: 'sleep 30', baseEnv })
    await new Promise((resolve) => setTimeout(resolve, 200))
    cancelCapturedScript('sleep')
    const result = await pending
    expect(result.cancelled).toBe(true)
    expect(result.code).toBeNull()
  }, 10_000)
})
