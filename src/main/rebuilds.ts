// Noticing `npm run build` (or `npm run build:watch`) while the linked app runs a checkout's `out/`: a new renderer
// bundle can be reloaded in place, a new main or preload build needs a restart. Pure Node (no Electron) so it is
// testable; src/main/index.ts decides what to do about each.
import { createHash } from 'node:crypto'
import { watch, type FSWatcher } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** What one build of `out/` looks like, per part; null while a part is missing (mid-build). */
export interface BuildSignature {
  /** `renderer/index.html`: it names the content-hashed assets, so a different bundle changes it. */
  renderer: string | null
  /** Hash of every file under `main/` and `preload/`. */
  backend: string | null
}

export interface BuildChange {
  reloadRenderer: boolean
  restartApp: boolean
}

/** What changed between two complete builds. A restart reloads everything, so it wins over a reload. */
export function compareBuilds(before: BuildSignature, after: BuildSignature): BuildChange {
  const complete = after.renderer !== null && after.backend !== null
  const restartApp = complete && before.backend !== null && after.backend !== before.backend
  const reloadRenderer = complete && !restartApp && before.renderer !== null && after.renderer !== before.renderer
  return { reloadRenderer, restartApp }
}

async function hashTree(dir: string): Promise<string | null> {
  let entries: string[]
  try {
    entries = (await readdir(dir, { recursive: true, withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name))
      .sort()
  } catch {
    return null
  }
  if (entries.length === 0) return null
  const hash = createHash('sha256')
  for (const file of entries) {
    try {
      hash.update(file).update(await readFile(file))
    } catch {
      return null // removed mid-build
    }
  }
  return hash.digest('hex')
}

export async function readBuildSignature(outDir: string): Promise<BuildSignature> {
  const [renderer, main, preload] = await Promise.all([
    readFile(join(outDir, 'renderer', 'index.html'), 'utf8').catch(() => null),
    hashTree(join(outDir, 'main')),
    hashTree(join(outDir, 'preload'))
  ])
  return { renderer, backend: main && preload ? `${main}:${preload}` : null }
}

export interface RebuildWatch {
  close(): void
}

/**
 * Calls `onChange` once a build of `outDir` has settled (no writes for `settleMs`: a build empties and rewrites
 * several directories) and differs from the last complete one.
 */
export function watchRebuilds(outDir: string, onChange: (change: BuildChange) => void, settleMs = 1000): RebuildWatch {
  let last: Promise<BuildSignature> = readBuildSignature(outDir)
  let timer: ReturnType<typeof setTimeout> | null = null
  let closed = false
  let watcher: FSWatcher | null = null

  const check = (): void => {
    timer = null
    last = last.then(async (before) => {
      const after = await readBuildSignature(outDir)
      if (after.renderer === null || after.backend === null) return before // mid-build: wait for the next write
      const change = compareBuilds(before, after)
      if (!closed && (change.reloadRenderer || change.restartApp)) onChange(change)
      return after
    })
  }

  try {
    watcher = watch(outDir, { recursive: true, persistent: false }, () => {
      if (closed) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(check, settleMs)
    })
    watcher.on('error', () => {}) // out/ went away (npm run clean): nothing more to see
  } catch {
    // No out/ to watch: the linked app would not have started.
  }

  return {
    close() {
      closed = true
      watcher?.close()
      if (timer) clearTimeout(timer)
    }
  }
}
