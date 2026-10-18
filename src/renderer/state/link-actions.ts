// Links clicked in a session's terminal (PRD F17): the built-in browser first, like Claude's desktop app. The page is
// the one of the session's worktree, so the right panel shows it as soon as it opens.
import type { SessionId } from '@shared/types'
import { setNotice } from '../panels/browser/store'
import { linkTarget, openableUrl, type LinkTarget, type TerminalLink } from '../terminal/links'
import { popupMenu, type MenuEntry } from '../ui/menu'
import { useWorkspace } from './workspace'

export function handleTerminalLink(sessionId: SessionId, link: TerminalLink): void {
  const url = openableUrl(link.url)
  if (!url) return
  if (link.action === 'menu') void openLinkMenu(sessionId, url, { x: link.x, y: link.y })
  else openLink(sessionId, url, linkTarget(link))
}

/** Opens `url` in the session's page in the right panel, or in the system browser (also when it has no worktree). */
export function openLink(sessionId: SessionId, url: string, target: LinkTarget): void {
  const state = useWorkspace.getState()
  const session = state.sessions.find((s) => s.id === sessionId)
  const worktree = state.worktrees.find((w) => w.id === session?.worktreeId)?.path
  if (target === 'external' || !worktree) {
    // main hands http(s) from window.open to the system browser.
    window.open(url, '_blank')
    return
  }
  if (state.activeSessionId !== sessionId || state.mainView !== 'session') state.setActiveSession(sessionId)
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
