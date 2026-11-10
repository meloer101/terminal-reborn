// Walks a log directory for `.jsonl` files (depth-limited, symlinks not followed), with a size + mtime signature.
import { lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'

const MAX_DEPTH = 6

export async function jsonlFiles(root: string, keep: (name: string) => boolean): Promise<{ path: string; signature: string }[]> {
  const out: { path: string; signature: string }[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      const path = join(dir, e.name)
      if (e.isDirectory()) {
        if (depth < MAX_DEPTH) await walk(path, depth + 1)
      } else if (e.isFile() && e.name.endsWith('.jsonl') && keep(e.name)) {
        const s = await lstat(path).catch(() => null)
        if (s) out.push({ path, signature: `${s.size}:${s.mtimeMs}` })
      }
    }
  }
  await walk(root, 0)
  return out
}
