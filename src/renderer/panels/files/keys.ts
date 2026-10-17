// Keys of the 文件 view's actions (Figma 13D context menu). Pure.

/** Shortcuts shown in the menu; the tree and the preview handle the keys (fileActionForKey). */
export const FILE_SHORTCUTS = {
  preview: 'Enter',
  open: 'CmdOrCtrl+Enter',
  reveal: 'CmdOrCtrl+Shift+R',
  insert: 'CmdOrCtrl+Shift+I',
  copy: 'Alt+CmdOrCtrl+C'
} as const

export type FileAction = keyof typeof FILE_SHORTCUTS

export const isFileAction = (id: string | null): id is FileAction => id !== null && Object.hasOwn(FILE_SHORTCUTS, id)

/** The file action a key press asks for (in the tree or the preview), if any. */
export function fileActionForKey(e: { key: string; code: string; metaKey: boolean; shiftKey: boolean; altKey: boolean; ctrlKey: boolean }): FileAction | null {
  if (e.ctrlKey) return null
  if (e.key === 'Enter') return e.metaKey && !e.shiftKey && !e.altKey ? 'open' : !e.metaKey && !e.shiftKey && !e.altKey ? 'preview' : null
  if (!e.metaKey) return null
  if (e.shiftKey && !e.altKey && e.code === 'KeyR') return 'reveal'
  if (e.shiftKey && !e.altKey && e.code === 'KeyI') return 'insert'
  if (e.altKey && !e.shiftKey && e.code === 'KeyC') return 'copy'
  return null
}
