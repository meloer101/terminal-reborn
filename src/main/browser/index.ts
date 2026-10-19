// IPC for the right panel's 浏览器 view (PRD F17) and its port list (F14, minimal). Every payload is validated here.
import { app, BrowserWindow, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { join } from 'node:path'
import { BROWSER_IPC, sessionListener } from '@shared/browser'
import { confirm } from '../confirm'
import { sessionRoots } from '../pty'
import { parseSessionId } from '../pty/validate'
import { BrowserHost, isPageContents, warmBrowserSession } from './host'
import { portsOf, scanPortsFresh, startPortScanning, unwatchPorts, watchPorts } from './ports'
import { RememberedPages } from './remembered'
import { parseBoolean, parseBounds, parsePageCommand, parsePoint, parseUrl, parseWorktree } from './validate'

const hosts = new WeakMap<WebContents, BrowserHost>()

export function registerBrowserHandlers(): void {
  startPortScanning()
  const remembered = new RememberedPages(join(app.getPath('userData'), 'browser.json'))
  app.on('before-quit', () => remembered.flush())

  /** The sending app window's pages; null for anything else (a page itself, a closed window). */
  const hostOf = (event: IpcMainEvent | IpcMainInvokeEvent): BrowserHost | null => {
    const sender = event.sender
    if (isPageContents(sender)) return null
    const window = BrowserWindow.fromWebContents(sender)
    if (!window || window.isDestroyed() || window.webContents !== sender) return null
    let host = hosts.get(sender)
    if (!host) {
      host = new BrowserHost(window, sender, remembered)
      hosts.set(sender, host)
    }
    return host
  }

  /** Runs `action` with the sender's host; malformed payloads are dropped (logged), never acted on. */
  const on = (channel: string, action: (host: BrowserHost, ...args: unknown[]) => void) => {
    ipcMain.on(channel, (event, ...args: unknown[]) => {
      const host = hostOf(event)
      if (!host) return
      try {
        action(host, ...args)
      } catch (error) {
        console.error(`[browser] ${channel}:`, error instanceof Error ? error.message : error)
      }
    })
  }

  on(BROWSER_IPC.show, (host, worktree, bounds) => host.show(parseWorktree(worktree), parseBounds(bounds)))
  on(BROWSER_IPC.hide, (host) => host.hide())
  on(BROWSER_IPC.navigate, (host, worktree, url) => host.navigate(parseWorktree(worktree), parseUrl(url)))
  on(BROWSER_IPC.back, (host, worktree) => host.back(parseWorktree(worktree)))
  on(BROWSER_IPC.forward, (host, worktree) => host.forward(parseWorktree(worktree)))
  on(BROWSER_IPC.reload, (host, worktree) => host.reload(parseWorktree(worktree)))
  on(BROWSER_IPC.setMobile, (host, worktree, mobile) => host.setMobile(parseWorktree(worktree), parseBoolean(mobile)))
  on(BROWSER_IPC.openExternal, (host, worktree) => host.openExternal(parseWorktree(worktree)))
  on(BROWSER_IPC.pageCommand, (host, worktree, command, at) => host.pageCommand(parseWorktree(worktree), parsePageCommand(command), parsePoint(at)))

  ipcMain.handle(BROWSER_IPC.cover, (event) => hostOf(event)?.cover() ?? null)
  ipcMain.handle(BROWSER_IPC.getState, (event, worktree: unknown) => {
    const host = hostOf(event)
    if (!host) throw new Error('not an app window')
    const key = parseWorktree(worktree)
    // The view just opened: get this worktree's session ready before the user opens a page.
    warmBrowserSession(key)
    return host.state(key)
  })

  // Ports are per window: only the window that drives a session sees its ports.
  on(BROWSER_IPC.watchPorts, (host, sessionId) => watchPorts(host.owner, parseSessionId(sessionId)))
  on(BROWSER_IPC.unwatchPorts, (host, sessionId) => unwatchPorts(host.owner, parseSessionId(sessionId)))

  // Not a generic kill: the pid has to be a listener in this window's scan of this session.
  ipcMain.handle(BROWSER_IPC.endListener, async (event, sessionIdRaw: unknown, pidRaw: unknown): Promise<boolean> => {
    const host = hostOf(event)
    if (!host) return false
    let sessionId: string
    try {
      sessionId = parseSessionId(sessionIdRaw)
    } catch {
      return false
    }
    const owned = sessionRoots().some((root) => root.sessionId === sessionId && root.owner === host.owner)
    const entry = owned ? sessionListener(portsOf(sessionId), pidRaw) : null
    if (!entry) return false
    const ok = await confirm(
      {
        message: `结束监听 :${entry.port} 的进程？`,
        detail: `${entry.label || '进程'}（pid ${entry.pid}）会收到 SIGTERM。`,
        confirmLabel: '结束进程',
        destructive: true
      },
      BrowserWindow.fromWebContents(host.owner)
    )
    if (!ok) return false
    // The process may have exited, and its pid reused, while the sheet was open.
    await scanPortsFresh()
    const again = sessionListener(portsOf(sessionId), entry.pid)
    const stillOwned = sessionRoots().some((root) => root.sessionId === sessionId && root.owner === host.owner)
    if (!again || !stillOwned) return false
    try {
      process.kill(again.pid, 'SIGTERM')
    } catch {
      return false
    }
    void scanPortsFresh()
    return true
  })
}
