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

async function selfHeals(socket: string, settings: string, page: Awaited<ReturnType<ElectronApplication['firstWindow']>>): Promise<void> {
  expect(await accepts(socket)).toBe(true)
  expect(existsSync(settings)).toBe(true)

  rmSync(socket)
  rmSync(settings)
  await expect.poll(() => accepts(socket), { timeout: 10_000, intervals: [200] }).toBe(true)
  await expect.poll(() => existsSync(settings), { timeout: 10_000 }).toBe(true)
  expect(await page.evaluate(() => (globalThis as unknown as { tr: TrApi }).tr.agent.getHooksHealth())).toEqual({ ok: true })
}

const health = (page: Awaited<ReturnType<ElectronApplication['firstWindow']>>) =>
  page.evaluate(() => (globalThis as unknown as { tr: TrApi }).tr.agent.getHooksHealth())

test('with the pty daemon, the hook socket is the daemon\'s (stable across app runs) and self-heals', async () => {
  app = await launchApp({ TR_HOOKS_CHECK_MS: '300' })
  const page = await app.firstWindow()
  const userData = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))
  expect(await health(page)).toEqual({ ok: true })
  // No per-run directory: agents that outlive this run keep a socket that stays put.
  expect(existsSync(join(userData, 'hooks'))).toBe(false)
  await selfHeals(join(userData, 'daemon', 'hooks', 'hook.sock'), join(userData, 'daemon', 'claude-settings.json'), page)
})

test('without the daemon, hooks live under userData/hooks/<pid>, report healthy, and self-heal', async () => {
  app = await launchApp({ TR_HOOKS_CHECK_MS: '300', TR_PTY_DAEMON: '0' })
  const page = await app.firstWindow()
  const userData = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))
  expect(await health(page)).toEqual({ ok: true })
  const runs = readdirSync(join(userData, 'hooks'))
  expect(runs).toHaveLength(1)
  const dir = join(userData, 'hooks', runs[0]!)
  await selfHeals(join(dir, 'hook.sock'), join(dir, 'claude-settings.json'), page)
})
