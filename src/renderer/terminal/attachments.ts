// Files into a running session — dropped on the terminal, pasted (an image on the clipboard becomes a temp file
// first), or picked with the session header's paperclip — go in as shell-escaped paths, the way a terminal does it.
// The agent turns image paths into attachments itself (PRD §6.9, scripts/spikes/50-attach-lab.mjs):
// - Claude 2.1.304: one paste of several space-separated paths makes each image an `[Image #N]` (raw, escaped or
//   quoted alike); other files stay as paths. Separate pastes race its asynchronous image reading (a later text path
//   lands before an earlier image), so it gets everything in one paste.
// - Codex 0.142.5: only a paste that is exactly one path becomes an image, and only escaped or quoted when it has
//   spaces. So each path is its own paste, with a space typed between; it handles them in order.
// - A shell, or an agent we cannot name, gets one paste like Terminal.app.
import { inputLineText } from '@shared/send-protocol'
import type { ImageExtension } from '@shared/ipc'

/** Characters a shell (and both agents' path detection) reads literally; everything else ASCII is backslash-escaped. */
const LITERAL = /[A-Za-z0-9_\-./:@%+=,\u0080-￿]/u

/** Backslash-escapes a path for a shell command line, as Terminal.app does for a dropped file. CJK stays as it is. */
export function shellEscapePath(path: string): string {
  let out = ''
  for (const ch of path) out += LITERAL.test(ch) ? ch : `\\${ch}`
  return out
}

/** A path we can put on a command line: absolute, and no control characters (a newline would end the line). */
export function insertablePath(path: string): boolean {
  // eslint-disable-next-line no-control-regex
  return path.startsWith('/') && !/[\u0000-\u001f\u007f]/.test(path)
}

/**
 * What to write to the PTY for `paths`: the input-line text (bracketed pastes when the program takes them) with a
 * space after, ready for the user to keep typing. Empty when no path is usable.
 */
export function attachmentInput(paths: readonly string[], agent: 'claude' | 'codex' | null, bracketed: boolean): string {
  const words = paths.filter(insertablePath).map(shellEscapePath)
  if (words.length === 0) return ''
  if (agent === 'codex') return words.map((word) => inputLineText(word, bracketed)).join(' ') + ' '
  // Claude places its images asynchronously: a space typed after the paste would land before them.
  if (agent === 'claude') return inputLineText(`${words.join(' ')} `, bracketed)
  return `${inputLineText(words.join(' '), bracketed)} `
}

/**
 * Drag data of an entry dragged out of Wavi's own panels (the 文件 view): a JSON array of absolute paths. Dropped on a
 * terminal it goes in like files from Finder; `text/plain` rides along with the path for other apps.
 */
export const PATHS_DRAG_TYPE = 'application/x-wavi-paths'

/** The absolute paths in PATHS_DRAG_TYPE data; [] for anything else. */
export function parseDraggedPaths(data: string): string[] {
  try {
    const value: unknown = JSON.parse(data)
    return Array.isArray(value) ? value.filter((p): p is string => typeof p === 'string' && insertablePath(p)).slice(0, 100) : []
  } catch {
    return []
  }
}

/**
 * A file macOS hands over for one drag only: the screenshot thumbnail (⌃⇧⌘4's floating preview) and other promised
 * files land in `$TMPDIR/TemporaryItems/NSIRD_…`, readable only by the app that took the drop — not by an agent
 * running under the pty daemon (Orca's daemon got EPERM). Main copies such files before their paths go in.
 */
export function isDragTempPath(path: string): boolean {
  return /\/TemporaryItems\/NSIRD_[^/]+\//.test(path)
}

const IMAGE_TYPES: Record<string, ImageExtension> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp'
}

/** The temp-file extension for a pasted image's MIME type; null for types the agents do not read. */
export function imageExtension(mime: string): ImageExtension | null {
  return IMAGE_TYPES[mime.toLowerCase()] ?? null
}
