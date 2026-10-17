// 浏览器 view state: each worktree's page as main reports it, and each watched session's listening ports.
// Main owns the pages (one per worktree); this only mirrors what it pushes.
import { create } from 'zustand'
import type { BrowserPageState, ListeningPort } from '@shared/browser'
import type { SessionId } from '@shared/types'

interface BrowserStore {
  pages: Record<string, BrowserPageState>
  ports: Record<SessionId, ListeningPort[]>
}

export const useBrowser = create<BrowserStore>(() => ({ pages: {}, ports: {} }))

let listening = false

/** Subscribes once to main's page and port updates. */
export function listenForBrowser(): void {
  if (listening) return
  listening = true
  window.tr.browser.onState((state) => useBrowser.setState((s) => ({ pages: { ...s.pages, [state.worktree]: state } })))
  window.tr.browser.onPorts(({ sessionId, ports }) => useBrowser.setState((s) => ({ ports: { ...s.ports, [sessionId]: ports } })))
}

/** Fetches a worktree's page the first time the view shows it; a pushed update always wins over this answer. */
export async function loadPage(worktree: string): Promise<void> {
  if (useBrowser.getState().pages[worktree]) return
  const state = await window.tr.browser.getState(worktree)
  useBrowser.setState((s) => (s.pages[worktree] ? s : { pages: { ...s.pages, [worktree]: state } }))
}
