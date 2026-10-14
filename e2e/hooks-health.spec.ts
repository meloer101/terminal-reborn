// Hook server reliability, no model turns (phase 2a · A9): the socket lives under userData, health is exposed
// to the renderer, and the self-check brings the socket and the settings file back when they disappear.
import { expect, test, type ElectronApplication } from '@playwright/test'
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { connect } from 'node:net'
import { join } from 'node:path'
import type { TrApi } from '../src/shared/ipc'
import { launchApp } from './launch'

let app: ElectronApplication

test.afterEach(async () => {
  await app?.close()
})

function accepts(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(socketPath)
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })
}

test('hooks live under userData, report healthy, and self-heal a deleted socket and settings file', async () => {
  app = await launchApp({ TR_HOOKS_CHECK_MS: '300' })
  const page = await app.firstWindow()
  const userData = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))

  const health = await page.evaluate(() => (globalThis as unknown as { tr: TrApi }).tr.agent.getHooksHealth())
  expect(health).toEqual({ ok: true })

  const runs = readdirSync(join(userData, 'hooks'))
  expect(runs).toHaveLength(1)
  const dir = join(userData, 'hooks', runs[0]!)
  const socket = join(dir, 'hook.sock')
  const settings = join(dir, 'claude-settings.json')
  expect(await accepts(socket)).toBe(true)
  expect(existsSync(settings)).toBe(true)

  rmSync(socket)
  rmSync(settings)
  await expect.poll(() => accepts(socket), { timeout: 10_000, intervals: [200] }).toBe(true)
  await expect.poll(() => existsSync(settings), { timeout: 10_000 }).toBe(true)
  expect(await page.evaluate(() => (globalThis as unknown as { tr: TrApi }).tr.agent.getHooksHealth())).toEqual({ ok: true })
})
