// Files into a running session by hand (PRD F19): drop files (from Finder or the 文件 view) on its terminal, or paste — files copied in Finder, or
// an image (a screenshot copied with ⌃⇧⌘4, an image copied in a browser) that is written to a temp file first. Either
// way their paths go into the input line (session-io.ts `insertPaths`), and the agent makes image paths attachments.
// Listeners sit on the terminal's host element, so they follow it into the overview when it is borrowed (borrow.ts).
import type { SessionId } from '@shared/types'
import { insertPaths } from '../session-io'
import { imageExtension, isDragTempPath, parseDraggedPaths, PATHS_DRAG_TYPE } from './attachments'
import { getSurface } from './registry'

/** Files from Finder, or entries dragged out of Wavi's 文件 view. */
const hasFiles = (data: DataTransfer | null): data is DataTransfer =>
  data !== null && (data.types.includes('Files') || data.types.includes(PATHS_DRAG_TYPE))

/** Real paths of dropped (or Finder-copied) files; files without one (an image dragged out of a web page) are skipped. */
function pathsOf(files: FileList): string[] {
  return Array.from(files)
    .map((file) => window.tr.files.pathForFile(file))
    .filter((path) => path.length > 0)
}

/** Puts the paths in, then gives the terminal the keyboard. */
export function addFiles(sessionId: SessionId, paths: readonly string[]): void {
  if (paths.length === 0) return
  void insertPaths(sessionId, paths)
    .catch((error: unknown) => console.warn('[terminal] could not add files:', error))
    .finally(() => getSurface(sessionId)?.focus())
}

/**
 * What a paste carries that is not text for the terminal: Finder files (their paths) or image data (saved to temp
 * files). Null when the paste is ordinary text, which xterm then handles as always.
 */
function pastedFiles(data: DataTransfer): Promise<string[]> | null {
  const paths = pathsOf(data.files)
  if (paths.length > 0) return Promise.resolve(paths)
  // Text wins: copying from many apps puts an image and its text on the clipboard together.
  if (data.getData('text/plain').trim() !== '') return null
  const images = Array.from(data.files).flatMap((file) => {
    const extension = imageExtension(file.type)
    return extension ? [{ file, extension }] : []
  })
  if (images.length === 0) return null
  return Promise.all(images.map(async ({ file, extension }) => window.tr.files.saveTempImage(await file.arrayBuffer(), extension)))
}

/** Listens on `host` for dropped and pasted files; returns a function that stops. */
export function attachFileInput(host: HTMLElement, sessionId: SessionId): () => void {
  // dragenter / dragleave fire for every child the pointer crosses: count them.
  let depth = 0
  const setDropping = (on: boolean): void => {
    if (on) host.dataset.fileDrop = 'true'
    else delete host.dataset.fileDrop
  }
  const onDragEnter = (e: DragEvent): void => {
    if (!hasFiles(e.dataTransfer)) return
    depth++
    setDropping(true)
  }
  const onDragOver = (e: DragEvent): void => {
    if (!hasFiles(e.dataTransfer)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }
  const onDragLeave = (e: DragEvent): void => {
    if (!hasFiles(e.dataTransfer)) return
    depth = Math.max(0, depth - 1)
    if (depth === 0) setDropping(false)
  }
  const onDrop = (e: DragEvent): void => {
    if (!hasFiles(e.dataTransfer)) return
    e.preventDefault()
    e.stopPropagation()
    depth = 0
    setDropping(false)
    const own = e.dataTransfer.getData(PATHS_DRAG_TYPE)
    if (own) {
      addFiles(sessionId, parseDraggedPaths(own))
      return
    }
    // A screenshot thumbnail and the like: only this app may read it, so it is copied first.
    const paths = pathsOf(e.dataTransfer.files)
    void Promise.all(paths.map((path) => (isDragTempPath(path) ? window.tr.files.keepDroppedFile(path) : path)))
      .then((kept) => addFiles(sessionId, kept))
      .catch((error: unknown) => console.warn('[terminal] could not add the dropped files:', error))
  }
  // Capture: ahead of xterm's own paste listener on its textarea.
  const onPaste = (e: ClipboardEvent): void => {
    if (!e.clipboardData) return
    const files = pastedFiles(e.clipboardData)
    if (!files) return
    e.preventDefault()
    e.stopPropagation()
    void files.then((paths) => addFiles(sessionId, paths)).catch((error: unknown) => console.warn('[terminal] could not paste the image:', error))
  }
  host.addEventListener('dragenter', onDragEnter)
  host.addEventListener('dragover', onDragOver)
  host.addEventListener('dragleave', onDragLeave)
  host.addEventListener('drop', onDrop)
  host.addEventListener('paste', onPaste, true)
  return () => {
    setDropping(false)
    host.removeEventListener('dragenter', onDragEnter)
    host.removeEventListener('dragover', onDragOver)
    host.removeEventListener('dragleave', onDragLeave)
    host.removeEventListener('drop', onDrop)
    host.removeEventListener('paste', onPaste, true)
  }
}
