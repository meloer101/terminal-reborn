// What the 文件 view can do with an entry (PRD F17): the right-click menu (Figma 13D) and its shortcuts.
import { AtSign, Code, Copy, File, FolderOpen } from 'lucide-react'
import type { SessionId } from '@shared/types'
import { insertIntoTerminal } from '../../session-io'
import { useWorkspace } from '../../state/workspace'
import { popupMenu, type MenuAnchor, type MenuEntry } from '../../ui/menu'
import { FILE_SHORTCUTS, isFileAction, type FileAction } from './keys'
import { showPreview } from './store'

export interface FileTarget {
  root: string
  path: string
  dir: boolean
  sessionId: SessionId
}

export function openInEditor(target: FileTarget): void {
  void window.tr.worktree.open(target.root, target.path).then((error) => {
    if (error) console.warn('[files] open failed:', error)
  })
}

/** `@path ` in the session's input line, as if typed (PRD §6.9), then the terminal gets the keyboard. */
export function insertPath(target: FileTarget): void {
  void insertIntoTerminal(target.sessionId, `@${target.path}${target.dir ? '/' : ''} `)
    .catch((error: unknown) => console.warn('[files] insert failed:', error))
    .finally(() => useWorkspace.getState().requestTerminalFocus())
}

export function runFileAction(action: FileAction, target: FileTarget): void {
  switch (action) {
    case 'preview':
      if (!target.dir) showPreview(target.root, target.path)
      break
    case 'open':
      openInEditor(target)
      break
    case 'reveal':
      window.tr.worktree.reveal(target.root, target.path)
      break
    case 'insert':
      insertPath(target)
      break
    case 'copy':
      void navigator.clipboard.writeText(target.path).catch(() => {})
      break
  }
}

export function fileMenuEntries(target: Pick<FileTarget, 'dir'>, { withPreview = true } = {}): MenuEntry[] {
  return [
    ...(withPreview
      ? [{ type: 'item' as const, id: 'preview', label: '预览', icon: File, accelerator: FILE_SHORTCUTS.preview, enabled: !target.dir }]
      : []),
    { type: 'item', id: 'open', label: '用默认编辑器打开', icon: Code, accelerator: FILE_SHORTCUTS.open },
    { type: 'item', id: 'reveal', label: '在 Finder 中显示', icon: FolderOpen, accelerator: FILE_SHORTCUTS.reveal },
    { type: 'separator' },
    { type: 'item', id: 'insert', label: '插入路径到终端', icon: AtSign, accelerator: FILE_SHORTCUTS.insert },
    { type: 'item', id: 'copy', label: '复制相对路径', icon: Copy, accelerator: FILE_SHORTCUTS.copy }
  ]
}

export async function openFileMenu(target: FileTarget, anchor: MenuAnchor, options?: { withPreview?: boolean }): Promise<void> {
  const choice = await popupMenu(fileMenuEntries(target, options), anchor)
  if (isFileAction(choice)) runFileAction(choice, target)
}
