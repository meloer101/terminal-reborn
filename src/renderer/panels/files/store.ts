// State of the 文件 view, kept per worktree root so switching sessions swaps the tree at once and switching back
// finds it as it was. Listings load lazily; main's fs.watch events refresh what is loaded.
import { create } from 'zustand'
import type { DirEntry, GitStatusSnapshot } from '@shared/worktree-files'
import { joinPath, parentOf } from './tree-model'

export interface RootFiles {
  /** Listings by folder ('' = root); a folder missing here is not loaded. */
  children: Record<string, DirEntry[]>
  /** Folder listings that failed (gone, permission), by folder. */
  errors: Record<string, string>
  expanded: ReadonlySet<string>
  /** Folders closed in the filtered / changed-only tree (everything starts open there). */
  collapsed: ReadonlySet<string>
  status: GitStatusSnapshot | null
  /** Every non-ignored file, fetched the first time the filter is used. */
  allFiles: string[] | null
  filter: string
  changedOnly: boolean
  selected: string | null
  /** File shown in the read-only preview (13F), or null for the tree. */
  preview: string | null
  /** Bumped when the previewed file may have changed on disk, so the preview reloads. */
  previewRevision: number
}

const EMPTY: RootFiles = {
  children: {},
  errors: {},
  expanded: new Set(),
  collapsed: new Set(),
  status: null,
  allFiles: null,
  filter: '',
  changedOnly: false,
  selected: null,
  preview: null,
  previewRevision: 0
}

export const useFiles = create<{ roots: Record<string, RootFiles> }>()(() => ({ roots: {} }))

export const filesOf = (root: string): RootFiles => useFiles.getState().roots[root] ?? EMPTY

export function patchRoot(root: string, patch: Partial<RootFiles> | ((current: RootFiles) => Partial<RootFiles>)): void {
  useFiles.setState((s) => {
    const current = s.roots[root] ?? EMPTY
    return { roots: { ...s.roots, [root]: { ...current, ...(typeof patch === 'function' ? patch(current) : patch) } } }
  })
}

const api = () => window.tr.worktree

/** Loads (or reloads) one folder's listing. */
export async function loadDir(root: string, dir: string): Promise<void> {
  try {
    const entries = await api().listDir(root, dir)
    patchRoot(root, (c) => {
      const { [dir]: _, ...errors } = c.errors
      return { children: { ...c.children, [dir]: entries }, errors }
    })
  } catch (error) {
    patchRoot(root, (c) => {
      // A folder that vanished: forget it and everything loaded below it.
      const children = Object.fromEntries(Object.entries(c.children).filter(([key]) => key !== dir && !key.startsWith(`${dir}/`)))
      return { children: dir === '' ? c.children : children, errors: { ...c.errors, [dir]: error instanceof Error ? error.message : String(error) } }
    })
  }
}

// One status run at a time per root; a request while one runs schedules exactly one more after it.
const statusRuns = new Map<string, { running: boolean; again: boolean }>()

export async function refreshStatus(root: string): Promise<void> {
  const run = statusRuns.get(root) ?? { running: false, again: false }
  statusRuns.set(root, run)
  if (run.running) {
    run.again = true
    return
  }
  run.running = true
  try {
    do {
      run.again = false
      const status = await api().gitStatus(root).catch(() => null)
      patchRoot(root, { status })
    } while (run.again)
  } finally {
    run.running = false
  }
}

export async function loadAllFiles(root: string): Promise<void> {
  const files = await api().listFiles(root).catch(() => [])
  patchRoot(root, { allFiles: files })
}

/** First look at a root: its top level and git status. Later calls only refresh the status. */
export function openRoot(root: string): void {
  const current = useFiles.getState().roots[root]
  if (!current) {
    patchRoot(root, {})
    void loadDir(root, '')
  }
  void refreshStatus(root)
}

export function toggleDir(root: string, path: string): void {
  const c = filesOf(root)
  if (c.filter.trim() || c.changedOnly) {
    const collapsed = new Set(c.collapsed)
    if (!collapsed.delete(path)) collapsed.add(path)
    patchRoot(root, { collapsed })
    return
  }
  setExpanded(root, path, !c.expanded.has(path))
}

export function setExpanded(root: string, path: string, open: boolean): void {
  const c = filesOf(root)
  if (c.expanded.has(path) === open) return
  const expanded = new Set(c.expanded)
  if (open) expanded.add(path)
  else expanded.delete(path)
  patchRoot(root, { expanded })
  if (open && !c.children[path]) void loadDir(root, path)
}

export function setFilter(root: string, filter: string): void {
  patchRoot(root, { filter, collapsed: new Set() })
  if (filter.trim() && filesOf(root).allFiles === null) void loadAllFiles(root)
}

export function setChangedOnly(root: string, changedOnly: boolean): void {
  patchRoot(root, { changedOnly, collapsed: new Set() })
  if (changedOnly) void refreshStatus(root)
}

export const select = (root: string, path: string | null): void => patchRoot(root, { selected: path })
export const showPreview = (root: string, path: string | null): void =>
  patchRoot(root, (c) => ({ preview: path, selected: path ?? c.selected }))

/** Collapses every folder (更多 › 全部折叠). */
export const collapseAll = (root: string): void => patchRoot(root, { expanded: new Set(), collapsed: new Set() })

/** Reloads everything that is loaded (更多 › 刷新). */
export function refreshAll(root: string): void {
  for (const dir of Object.keys(filesOf(root).children)) void loadDir(root, dir)
  void refreshStatus(root)
  if (filesOf(root).allFiles !== null) void loadAllFiles(root)
}

/** Opens every folder above `path`, so it shows in the tree. */
export function reveal(root: string, path: string): void {
  const parts = path.split('/')
  let dir = ''
  for (const part of parts.slice(0, -1)) {
    dir = joinPath(dir, part)
    setExpanded(root, dir, true)
  }
}

// Main reports changes for roots this window watches (FilesView starts and stops the watch).
let listening = false
export function listenForChanges(): void {
  if (listening) return
  listening = true
  api().onChanged((change) => {
    const c = useFiles.getState().roots[change.root]
    if (!c) return
    for (const dir of change.dirs) if (c.children[dir]) void loadDir(change.root, dir)
    if (change.dirs.length > 0 && c.allFiles !== null) void loadAllFiles(change.root)
    if (c.preview !== null && (change.git || change.dirs.includes(parentOf(c.preview)))) {
      patchRoot(change.root, (current) => ({ previewRevision: current.previewRevision + 1 }))
    }
    void refreshStatus(change.root)
  })
}
