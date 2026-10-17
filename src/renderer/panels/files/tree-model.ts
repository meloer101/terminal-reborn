// Rows of the 文件 view's tree (PRD F17, Figma 13D / FileTreeRow 130:259). Pure: the store hands in what is loaded.
import { compareEntries, type DirEntry, type GitLetter, type StatusIndex } from '@shared/worktree-files'

export interface TreeRow {
  /** Relative to the worktree root. */
  path: string
  name: string
  depth: number
  dir: boolean
  expanded: boolean
  /** Expanded but its listing has not arrived yet. */
  loading: boolean
  /** Git letter, or "•" on a folder that contains changes. */
  mark: GitLetter | '•' | null
  ignored: boolean
}

export const joinPath = (dir: string, name: string): string => (dir ? `${dir}/${name}` : name)

export function parentOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? '' : path.slice(0, slash)
}

export const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

function markOf(path: string, dir: boolean, status: StatusIndex): TreeRow['mark'] {
  return status.letter(path) ?? (dir && status.hasChanges(path) ? '•' : null)
}

export interface LoadedTree {
  /** Listings by folder path ('' = root); a folder that is missing here is not loaded. */
  children: Readonly<Record<string, readonly DirEntry[] | undefined>>
  expanded: ReadonlySet<string>
}

/** The lazily loaded tree, depth first, showing only what is expanded. */
export function treeRows(tree: LoadedTree, status: StatusIndex): TreeRow[] {
  const rows: TreeRow[] = []
  const walk = (dir: string, depth: number) => {
    for (const entry of tree.children[dir] ?? []) {
      const path = joinPath(dir, entry.name)
      const expanded = entry.dir && tree.expanded.has(path)
      rows.push({
        path,
        name: entry.name,
        depth,
        dir: entry.dir,
        expanded,
        loading: expanded && tree.children[path] === undefined,
        mark: markOf(path, entry.dir, status),
        ignored: status.ignored(path)
      })
      if (expanded) walk(path, depth + 1)
    }
  }
  walk('', 0)
  return rows
}

/**
 * A tree built from a flat list of file paths (the filter's matches, or the changed files), every folder
 * open unless it is in `collapsed`. A path ending in '/' is a folder with nothing listed under it.
 */
export function pathRows(paths: readonly string[], status: StatusIndex, collapsed: ReadonlySet<string> = new Set()): TreeRow[] {
  const children = new Map<string, Map<string, boolean>>()
  const add = (dir: string, name: string, isDir: boolean) => {
    let names = children.get(dir)
    if (!names) children.set(dir, (names = new Map()))
    if (isDir || !names.has(name)) names.set(name, isDir || (names.get(name) ?? false))
  }
  for (const raw of paths) {
    const isDirLeaf = raw.endsWith('/')
    const path = isDirLeaf ? raw.slice(0, -1) : raw
    if (!path) continue
    const parts = path.split('/')
    for (let i = 0; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/')
      add(dir, parts[i]!, i < parts.length - 1 || isDirLeaf)
    }
  }
  const rows: TreeRow[] = []
  const walk = (dir: string, depth: number) => {
    const entries = [...(children.get(dir) ?? new Map<string, boolean>())].map(([name, isDir]) => ({ name, dir: isDir })).sort(compareEntries)
    for (const entry of entries) {
      const path = joinPath(dir, entry.name)
      const expanded = entry.dir && children.has(path) && !collapsed.has(path)
      rows.push({ path, name: entry.name, depth, dir: entry.dir, expanded, loading: false, mark: markOf(path, entry.dir, status), ignored: status.ignored(path) })
      if (expanded) walk(path, depth + 1)
    }
  }
  walk('', 0)
  return rows
}

/** Files whose name (or, when the query has a '/', whose path) contains the query, case-insensitively. */
export function filterPaths(paths: readonly string[], query: string, limit: number): string[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const byPath = needle.includes('/')
  const out: string[] = []
  for (const path of paths) {
    const haystack = (byPath ? path : baseName(path.endsWith('/') ? path.slice(0, -1) : path)).toLowerCase()
    if (haystack.includes(needle)) {
      out.push(path)
      if (out.length >= limit) break
    }
  }
  return out
}

/** Row to move to from `index` with ↑ / ↓ / ← / → (null = stay). `→` on a closed folder is handled by the caller. */
export function stepRow(rows: readonly TreeRow[], index: number, key: 'up' | 'down' | 'left' | 'right'): number | null {
  if (rows.length === 0) return null
  if (index < 0) return 0
  const row = rows[index]
  if (!row) return null
  if (key === 'up') return index > 0 ? index - 1 : null
  if (key === 'down') return index < rows.length - 1 ? index + 1 : null
  if (key === 'right') return row.dir && row.expanded && rows[index + 1]?.depth === row.depth + 1 ? index + 1 : null
  // left: from an open folder the caller collapses it; otherwise go to the parent folder.
  for (let i = index - 1; i >= 0; i--) if (rows[i]!.depth < row.depth) return i
  return null
}
