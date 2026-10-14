import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHookDir, MAX_SOCKET_PATH_BYTES, socketFits, sweepStaleHookDirs, userUid } from './hook-dir'
import { SOCKET_NAME, startHookServer, type HookServer } from './server'

let root: string
let server: HookServer | null = null
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'tr-hd-'))
})
afterEach(async () => {
  await server?.close()
  server = null
  rmSync(root, { recursive: true, force: true })
})

describe('createHookDir', () => {
  it('lives under <userData>/hooks/<pid> with mode 0700', () => {
    const dir = createHookDir({ userData: root, pid: 4242 })
    expect(dir).toBe(join(root, 'hooks', '4242'))
    expect(statSync(dir).mode & 0o777).toBe(0o700)
    expect(statSync(join(root, 'hooks')).mode & 0o777).toBe(0o700)
    expect(socketFits(dir)).toBe(true)
  })

  it('starts clean when a stale directory with the same pid exists', () => {
    const stale = join(root, 'hooks', '77')
    mkdirSync(stale, { recursive: true })
    const marker = join(stale, 'old.txt')
    rmSync(marker, { force: true })
    mkdirSync(join(stale, 'sub'))
    createHookDir({ userData: root, pid: 77 })
    expect(existsSync(join(stale, 'sub'))).toBe(false)
  })

  it('falls back to a short /tmp-style directory when userData is too deep for a socket path', () => {
    const deep = join(root, 'x'.repeat(120))
    expect(socketFits(join(deep, 'hooks', '1'))).toBe(false)
    const dir = createHookDir({ userData: deep, pid: 1, uid: 501, fallbackRoot: root, random: () => 'deadbeef' })
    expect(dir).toBe(join(root, 'tr-501-deadbeef'))
    expect(Buffer.byteLength(join(dir, SOCKET_NAME))).toBeLessThanOrEqual(MAX_SOCKET_PATH_BYTES)
    expect(statSync(dir).mode & 0o777).toBe(0o700)
    // Nothing was created under the too-deep userData.
    expect(existsSync(deep)).toBe(false)
  })
})

describe('sweepStaleHookDirs', () => {
  const old = new Date(Date.now() - 60_000)
  function stale(path: string): string {
    mkdirSync(path, { recursive: true })
    utimesSync(path, old, old)
    return path
  }
  const common = () => ({ userData: root, uid: userUid(), legacyRoot: root, fallbackRoot: root, keep: join(root, 'hooks', 'current') })

  it('removes dead directories of all three layouts and keeps the current one', async () => {
    const mine = stale(join(root, 'hooks', '1111'))
    const legacy = stale(join(root, 'tr-hooks-AbC123'))
    const fallback = stale(join(root, `tr-${userUid()}-0123abcd`))
    const current = stale(join(root, 'hooks', 'current'))
    const removed = await sweepStaleHookDirs({ ...common(), keep: current })
    expect(removed.sort()).toEqual([fallback, legacy, mine].sort())
    expect(existsSync(current)).toBe(true)
    expect(existsSync(mine) || existsSync(legacy) || existsSync(fallback)).toBe(false)
  })

  it('keeps a directory whose server still answers (another running instance)', async () => {
    const live = stale(join(root, 'hooks', '2222'))
    server = await startHookServer(() => '', { socketDir: live })
    utimesSync(live, old, old)
    expect(await sweepStaleHookDirs(common())).toEqual([])
    expect(existsSync(live)).toBe(true)
  })

  it('keeps fresh directories (another instance may be mid-start)', async () => {
    const fresh = join(root, 'hooks', '3333')
    mkdirSync(fresh, { recursive: true })
    expect(await sweepStaleHookDirs(common())).toEqual([])
    expect(existsSync(fresh)).toBe(true)
  })

  it('ignores names that are not ours, and symlinks', async () => {
    const other = stale(join(root, 'hooks', 'not-a-pid'))
    const unrelated = stale(join(root, 'tr-hooks')) // no suffix
    const target = stale(join(root, 'target'))
    symlinkSync(target, join(root, 'tr-hooks-link'))
    expect(await sweepStaleHookDirs(common())).toEqual([])
    for (const p of [other, unrelated, target]) expect(existsSync(p)).toBe(true)
  })

  it('does not throw when the roots do not exist', async () => {
    expect(await sweepStaleHookDirs({ userData: join(root, 'nope'), keep: '', legacyRoot: join(root, 'nada'), fallbackRoot: join(root, 'nothing') })).toEqual([])
  })
})
