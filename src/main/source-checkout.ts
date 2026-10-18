// The linked app (`npm run app:install`, scripts/install-app.mjs) is a packaged Electron shell whose entry runs a
// source checkout's build and names the checkout in TR_SOURCE_ROOT. `app.isPackaged` is true there, yet the files
// are the checkout's: resources come from it, its `out/` changes on every build, and there is no release to poll.
import { app } from 'electron'
import { existsSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

let cached: string | null | undefined

/** The checkout the linked app runs, or null (`npm run dev`, the release build). */
export function sourceRoot(): string | null {
  if (cached !== undefined) return cached
  const root = process.env.TR_SOURCE_ROOT
  cached = app.isPackaged && root && isAbsolute(root) && existsSync(join(root, 'out', 'main')) ? root : null
  return cached
}

/** A build of a working checkout (dev run or linked app): dev menu items, no update polling. */
export function isDeveloperBuild(): boolean {
  return !app.isPackaged || sourceRoot() !== null
}
