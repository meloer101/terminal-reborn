// macOS asks "Wavi would like to access the files in your Desktop folder" the first time a process reads inside
// Desktop, Documents or Downloads. A session whose folder is the home directory (a plain terminal starts there)
// contains all three, so walking or recursively watching that folder would raise the prompt without the user having
// opened anything. These helpers name the folders a walk or a recursive watch must stay out of.
import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, sep } from 'node:path'

export const PROTECTED_FOLDER_NAMES = ['Desktop', 'Documents', 'Downloads'] as const

/** The three folders under the home directory, under its real path too when that differs (a symlinked home). */
export function protectedFolders(home: string = homedir(), realHome: (path: string) => string = realpathSync): string[] {
  let real = home
  try {
    real = realHome(home)
  } catch {
    // The home directory is unreadable: the plain path still names the folders.
  }
  return [...new Set([home, real].flatMap((base) => PROTECTED_FOLDER_NAMES.map((name) => join(base, name))))]
}

/** Whether `target` is `folder` itself or inside it (both absolute). */
function within(folder: string, target: string): boolean {
  const rel = relative(folder, target)
  return rel === '' || (!isAbsolute(rel) && rel.split(sep)[0] !== '..')
}

/**
 * The protected folders that lie strictly inside `root`: the ones a walk or a recursive watch of `root` would enter
 * without being asked. Empty for a project that is itself in Desktop (the user chose it) or anywhere else.
 */
export function protectedInside(root: string, folders: readonly string[] = protectedFolders()): string[] {
  return folders.filter((folder) => folder !== root && within(root, folder))
}

/** Whether `path` is one of `guarded` or inside one. */
export function isGuarded(path: string, guarded: readonly string[]): boolean {
  return guarded.some((folder) => within(folder, path))
}
