// Pure helpers for inserting file paths and handling pasted images.
import type { ImageExtension } from '@shared/ipc'

/** Escape shell-significant characters (incl. spaces) the way agent TUIs expect dropped paths. CJK is left as-is. */
export function formatPath(path: string): string {
  return path.replace(/[\s\\'"()[\]{}&;$`!#*?<>|~^]/g, (c) => `\\${c}`)
}

/**
 * Text to insert for a list of paths: space-separated, with a leading space when the text
 * before the caret doesn't end in whitespace, and a trailing space so typing can continue.
 */
export function pathsInsertion(paths: string[], before: string): string {
  if (paths.length === 0) return ''
  const body = paths.map(formatPath).join(' ')
  const needsLead = before.length > 0 && !/\s$/.test(before)
  return `${needsLead ? ' ' : ''}${body} `
}

const IMAGE_EXTENSIONS: Record<string, ImageExtension> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp'
}

export function imageExtensionFor(mime: string): ImageExtension | null {
  return IMAGE_EXTENSIONS[mime.toLowerCase()] ?? null
}

export interface ClipboardItemFacts {
  kind: string
  type: string
}

/**
 * Index of the clipboard item to treat as a pasted image, or -1 to let the paste proceed as text.
 * Text wins when present (copying a cell range or rich text also puts a rendered image on the clipboard).
 */
export function pickPastedImage(items: ClipboardItemFacts[], hasText: boolean): number {
  if (hasText) return -1
  return items.findIndex((i) => i.kind === 'file' && imageExtensionFor(i.type) !== null)
}

/** After a failed send, put the text back without clobbering anything typed in the meantime. */
export function restoreAfterFailure(failed: string, current: string): string {
  return current.length === 0 ? failed : `${failed}\n${current}`
}
