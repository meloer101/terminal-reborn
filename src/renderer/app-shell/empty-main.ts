// Pure helpers for the empty main area (EmptyMain.tsx).
import type { Project } from '@shared/types'

export interface RecentFolder {
  name: string
  path: string
}

const MAX_SHOWN = 5

const basename = (path: string): string => path.replace(/\/+$/, '').split('/').pop() || path

/** Recently opened folders first, then workspace projects not in that list; at most five. */
export function recentFolders(recent: readonly string[], projects: readonly Project[]): RecentFolder[] {
  const names = new Map(projects.map((p) => [p.rootPath, p.name]))
  const paths = [...new Set([...recent, ...projects.map((p) => p.rootPath)])].slice(0, MAX_SHOWN)
  return paths.map((path) => ({ path, name: names.get(path) ?? basename(path) }))
}

/** "/Users/a/code/x" → "~/code/x". */
export function tildePath(path: string, home: string): string {
  if (!home || home === '/') return path
  if (path === home) return '~'
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}
