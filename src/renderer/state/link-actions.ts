// Links clicked in a session's terminal (PRD F17), like Claude's desktop app: a URL opens in the built-in browser
// (the page of the session's worktree), a file path in the 文件 view's read-only preview.
import type { SessionId } from '@shared/types'
import { setNotice } from '../panels/browser/store'
import { runFileAction, type FileTarget } from '../panels/files/actions'
import { showPreview } from '../panels/files/store'
import { linkTarget, openableUrl, type LinkTarget, type TerminalLink } from '../terminal/links'
import { popupMenu, type MenuEntry } from '../ui/menu'
import { useWorkspace } from './workspace'

export function handleTerminalLink(sessionId: SessionId, link: TerminalLink): void {
  if (link.kind === 'file') {
    const root = worktreeOf(sessionId)
    if (!root) return
    const file = { root, path: link.path, line: link.line, sessionId }
    if (link.action === 'menu') void openFileLinkMenu(file, { x: link.x, y: link.y })
    else openFile(file, linkTarget(link))
    return
  }
  const url = openableUrl(link.url)
  if (!url) return
  if (link.action === 'menu') void openLinkMenu(sessionId, url, { x: link.x, y: link.y })
  else openLink(sessionId, url, linkTarget(link))
}

/** Which of `paths` (as printed in the session's terminal) are files of its worktree; all null without one. */
export function resolveSessionPaths(sessionId: SessionId, paths: readonly string[]): Promise<(string | null)[]> {
  const root = worktreeOf(sessionId)
  return root ? window.tr.worktree.resolveLinks(root, paths) : Promise.resolve(paths.map(() => null))
}

function worktreeOf(sessionId: SessionId): string | undefined {
  const state = useWorkspace.getState()
  const session = state.sessions.find((s) => s.id === sessionId)
  return state.worktrees.find((w) => w.id === session?.worktreeId)?.path
}

/** Shows the session (it may be in the overview) so its right panel is the one that opens. */
function showSession(sessionId: SessionId): void {
  const state = useWorkspace.getState()
  if (state.activeSessionId !== sessionId || state.mainView !== 'session') state.setActiveSession(sessionId)
}

/** Opens `url` in the session's page in the right panel, or in the system browser (also when it has no worktree). */
export function openLink(sessionId: SessionId, url: string, target: LinkTarget): void {
  const worktree = worktreeOf(sessionId)
  if (target === 'external' || !worktree) {
    // main hands http(s) from window.open to the system browser.
    window.open(url, '_blank')
    return
  }
  showSession(sessionId)
  setNotice(worktree, null)
  window.tr.browser.navigate(worktree, url)
  useWorkspace.getState().setRightPanel('browser')
}

async function openLinkMenu(sessionId: SessionId, url: string, at: { x: number; y: number }): Promise<void> {
  const entries: MenuEntry[] = [
    { type: 'item', id: 'internal', label: '在内置浏览器打开' },
    { type: 'item', id: 'external', label: '用系统浏览器打开' },
    { type: 'separator' },
    { type: 'item', id: 'copy', label: '复制链接' }
  ]
  const choice = await popupMenu(entries, at)
  if (choice === 'internal' || choice === 'external') openLink(sessionId, url, choice)
  else if (choice === 'copy') void navigator.clipboard.writeText(url).catch(() => {})
}

interface FileLink {
  root: string
  /** Relative to the root, checked by main. */
  path: string
  line: number | null
  sessionId: SessionId
}

const fileTarget = (file: FileLink): FileTarget => ({ root: file.root, path: file.path, dir: false, sessionId: file.sessionId })

/** The 文件 view's preview, scrolled to the line; or the default editor (`shell.openPath`). */
export function openFile(file: FileLink, target: LinkTarget): void {
  if (target === 'external') {
    runFileAction('open', fileTarget(file))
    return
  }
  showSession(file.sessionId)
  showPreview(file.root, file.path, file.line)
  useWorkspace.getState().setRightPanel('files')
}

async function openFileLinkMenu(file: FileLink, at: { x: number; y: number }): Promise<void> {
  const entries: MenuEntry[] = [
    { type: 'item', id: 'preview', label: '预览' },
    { type: 'item', id: 'open', label: '用默认编辑器打开' },
    { type: 'item', id: 'reveal', label: '在 Finder 中显示' },
    { type: 'separator' },
    { type: 'item', id: 'copy', label: '复制路径' }
  ]
  const choice = await popupMenu(entries, at)
  if (choice === 'preview') openFile(file, 'internal')
  else if (choice === 'open' || choice === 'reveal' || choice === 'copy') runFileAction(choice, fileTarget(file))
}
