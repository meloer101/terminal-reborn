// 浏览器 view state: each worktree's page as main reports it, each watched session's listening ports, and the
// notice line (main's "blocked a pop-up / download", or an address that cannot be opened). Main owns the pages.
import { create } from 'zustand'
import type { BrowserPageState, ListeningPort } from '@shared/browser'
import type { SessionId } from '@shared/types'

interface BrowserStore {
  pages: Record<string, BrowserPageState>
  ports: Record<SessionId, ListeningPort[]>
  /** One line under the toolbar, per worktree. */
  notices: Record<string, string>
}

export const useBrowser = create<BrowserStore>(() => ({ pages: {}, ports: {}, notices: {} }))

let listening = false

/** Subscribes once to main's page, port and notice updates. */
export function listenForBrowser(): void {
  if (listening) return
  listening = true
  window.tr.browser.onState((state) => useBrowser.setState((s) => ({ pages: { ...s.pages, [state.worktree]: state } })))
  window.tr.browser.onPorts(({ sessionId, ports }) => useBrowser.setState((s) => ({ ports: { ...s.ports, [sessionId]: ports } })))
  window.tr.browser.onNotice(({ worktree, message }) => setNotice(worktree, message))
}

/** Fetches a worktree's page the first time the view shows it; a pushed update always wins over this answer. */
export async function loadPage(worktree: string): Promise<void> {
  if (useBrowser.getState().pages[worktree]) return
  const state = await window.tr.browser.getState(worktree)
  useBrowser.setState((s) => (s.pages[worktree] ? s : { pages: { ...s.pages, [worktree]: state } }))
}

/** Shows `message` under the toolbar; null clears it. */
export function setNotice(worktree: string, message: string | null): void {
  useBrowser.setState((s) => {
    if ((s.notices[worktree] ?? null) === message) return s
    const notices = { ...s.notices }
    if (message === null) delete notices[worktree]
    else notices[worktree] = message
    return { notices }
  })
}
