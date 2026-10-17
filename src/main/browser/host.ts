// The built-in browser's pages (PRD F17 · 浏览器): one WebContentsView per worktree, laid over the rectangle the
// renderer reports. Pages run in a session partition per worktree with no preload, sandboxed and context-isolated,
// so they can never reach `window.tr` or Node; only http(s) is ever loaded. A page can open another site in the
// system browser only right after the user pressed a key or the mouse in it, and never in bursts.
import { BrowserWindow, session, shell, WebContentsView, type Session, type WebContents } from 'electron'
import {
  addConsoleEntry,
  BROWSER_IPC,
  decidePopup,
  EMPTY_CONSOLE,
  isAllowedUrl,
  pageChord,
  type AppChordCommand,
  type BrowserBounds,
  type BrowserNotice,
  type BrowserPageState,
  type PageAction,
  type PageCommand,
  type PageContextMenu
} from '@shared/browser'
import { IPC } from '@shared/ipc'
import { isMenuCommand } from '@shared/shortcuts'
import { partitionFor } from './partition'
import type { RememberedPages } from './remembered'

/** Live pages per window; the least recently shown one beyond this is closed (its URL stays remembered). */
const MAX_PAGES = 4
const STATE_THROTTLE_MS = 80
export const MOBILE_WIDTH = 375
/** Matches the page well's corner (--radius-md) and the mobile frame's (--radius-sm). */
const RADIUS = { desktop: 5, mobile: 3 }
/** Permissions a page may have; everything else (camera, notifications, geolocation, …) is denied. */
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write'])

interface Page {
  worktree: string
  view: WebContentsView
  state: BrowserPageState
  lastShown: number
  /** Last key or mouse press in the page (pop-ups need a recent one). */
  lastInputAt: number
  stateTimer: ReturnType<typeof setTimeout> | null
}

/** Every page's WebContents: never trusted as an IPC sender. */
const pageContents = new WeakSet<WebContents>()
/** Where a page's session events (downloads) are reported. */
const noticeTargets = new WeakMap<WebContents, (message: string) => void>()

export function isPageContents(contents: WebContents): boolean {
  return pageContents.has(contents)
}

const hardened = new WeakSet<Session>()

/** A worktree's session partition, hardened once (permission handlers and downloads are per session). */
function browserSession(worktree: string): Session {
  const ses = session.fromPartition(partitionFor(worktree))
  if (hardened.has(ses)) return ses
  hardened.add(ses)
  ses.setPermissionRequestHandler((_contents, permission, callback) => callback(ALLOWED_PERMISSIONS.has(permission)))
  ses.setPermissionCheckHandler((_contents, permission) => ALLOWED_PERMISSIONS.has(permission))
  ses.setDevicePermissionHandler(() => false)
  // Nothing is written to disk from a page: say so, and leave it to the user to fetch it elsewhere.
  ses.on('will-download', (event, item, contents) => {
    event.preventDefault()
    noticeTargets.get(contents)?.(`页面想下载 ${item.getFilename() || '一个文件'}，已拦下；需要的话用系统浏览器打开这个页面`)
  })
  // With a system PAC / WPAD proxy, a fresh session's first request waits seconds for the proxy lookup:
  // resolve once now, so that wait does not land on the first page.
  ses.resolveProxy('http://localhost/').catch(() => {})
  return ses
}

/** Sets a worktree's session up ahead of its first page (the view opened; the user has not typed yet). */
export function warmBrowserSession(worktree: string): void {
  browserSession(worktree)
}

function loadErrorText(code: number, description: string, url: string): string {
  let host = url
  try {
    host = new URL(url).host
  } catch {
    // keep the raw text
  }
  switch (code) {
    case -102:
      return `${host} 没有响应：没有程序在监听这个端口`
    case -105:
      return `找不到 ${host}`
    case -106:
      return '网络未连接'
    case -118:
      return `${host} 连接超时`
    default:
      return `打不开 ${host}（${description || code}）`
  }
}

/** The pages of one app window. */
export class BrowserHost {
  private readonly pages = new Map<string, Page>()
  private visible: Page | null = null
  private bounds: BrowserBounds = { x: 0, y: 0, width: 0, height: 0 }
  /** Bumped on every show / hide, so a slow cover() cannot hide a page shown again meanwhile. */
  private generation = 0
  /** Last time any page here opened something in the system browser. */
  private lastExternalAt = 0

  constructor(
    private readonly window: BrowserWindow,
    readonly owner: WebContents,
    private readonly remembered: RememberedPages
  ) {
    // The app's own page reloading or crashing must not leave a page floating over nothing.
    owner.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) this.hide()
    })
    owner.on('render-process-gone', () => this.hide())
    window.on('closed', () => this.destroy())
  }

  state(worktree: string): BrowserPageState {
    const page = this.pages.get(worktree)
    if (page) return page.state
    const saved = this.remembered.get(worktree)
    return {
      worktree,
      url: saved?.url ?? '',
      title: '',
      loading: false,
      canGoBack: false,
      canGoForward: false,
      mobile: saved?.mobile ?? false,
      loadError: null,
      console: EMPTY_CONSOLE
    }
  }

  show(worktree: string, bounds: BrowserBounds): void {
    this.generation++
    this.bounds = bounds
    const page = this.pages.get(worktree) ?? this.reopen(worktree)
    if (!page) {
      this.hide()
      return
    }
    if (this.visible && this.visible !== page) this.conceal(this.visible)
    this.visible = page
    page.lastShown = Date.now()
    this.layout(page)
    page.view.setVisible(true)
  }

  hide(): void {
    this.generation++
    if (this.visible) this.conceal(this.visible)
    this.visible = null
  }

  /** Snapshot of the visible page, then hides it (a menu or dialog is about to cover it). */
  async cover(): Promise<string | null> {
    const page = this.visible
    if (!page) return null
    const generation = ++this.generation
    // The keyboard goes to what covers the page at once, not after the snapshot.
    this.releaseFocus(page)
    let snapshot: string | null = null
    try {
      const image = await page.view.webContents.capturePage()
      snapshot = image.isEmpty() ? null : image.toDataURL()
    } catch {
      // A page that is still loading may refuse; hide it anyway.
    }
    if (generation === this.generation && this.visible === page) {
      this.conceal(page)
      this.visible = null
    }
    return snapshot
  }

  navigate(worktree: string, url: string): void {
    const page = this.pages.get(worktree) ?? this.create(worktree, this.remembered.get(worktree)?.mobile ?? false)
    this.load(page, url)
  }

  back(worktree: string): void {
    const page = this.pages.get(worktree)
    if (!page) return void this.reopen(worktree)
    const history = page.view.webContents.navigationHistory
    if (history.canGoBack()) history.goBack()
  }

  forward(worktree: string): void {
    const page = this.pages.get(worktree)
    if (!page) return void this.reopen(worktree)
    const history = page.view.webContents.navigationHistory
    if (history.canGoForward()) history.goForward()
  }

  reload(worktree: string, ignoreCache = false): void {
    const page = this.pages.get(worktree)
    // Closed to make room for others: load its last address again.
    if (!page) return void this.reopen(worktree)
    // After a failed load the WebContents has no committed URL to reload: load the address again.
    if (page.state.loadError && page.state.url) this.load(page, page.state.url)
    else if (ignoreCache) page.view.webContents.reloadIgnoringCache()
    else page.view.webContents.reload()
  }

  setMobile(worktree: string, mobile: boolean): void {
    const page = this.pages.get(worktree)
    const url = page?.state.url ?? this.remembered.get(worktree)?.url ?? ''
    if (url && isAllowedUrl(url)) this.remembered.set(worktree, { url, mobile })
    if (!page) {
      this.send(BROWSER_IPC.state, { ...this.state(worktree), mobile })
      return
    }
    page.state = { ...page.state, mobile }
    // The renderer reports the new (375-wide) rectangle next; until then emulate in the current one.
    this.applyEmulation(page)
    this.emit(page)
  }

  openExternal(worktree: string): void {
    const url = this.pages.get(worktree)?.state.url ?? this.remembered.get(worktree)?.url
    if (url && isAllowedUrl(url)) void shell.openExternal(url)
  }

  /** A context-menu item (the menu itself is drawn by the app). */
  pageCommand(worktree: string, command: PageCommand, at: { x: number; y: number }): void {
    const page = this.pages.get(worktree)
    if (!page) return
    const contents = page.view.webContents
    switch (command) {
      case 'back':
        return this.back(worktree)
      case 'reload':
        return this.reload(worktree)
      case 'copy':
        return contents.copy()
      case 'paste':
        contents.focus()
        return contents.paste()
      case 'inspect':
        if (!contents.isDevToolsOpened()) contents.openDevTools({ mode: 'detach' })
        contents.inspectElement(Math.round(at.x), Math.round(at.y))
        return
    }
  }

  destroy(): void {
    for (const page of this.pages.values()) this.close(page)
    this.pages.clear()
    this.visible = null
  }

  /** The worktree's page from its remembered URL; null when it never had one. */
  private reopen(worktree: string): Page | null {
    const saved = this.remembered.get(worktree)
    if (!saved) return null
    const page = this.create(worktree, saved.mobile)
    this.load(page, saved.url)
    return page
  }

  private create(worktree: string, mobile: boolean): Page {
    this.evict()
    const view = new WebContentsView({
      webPreferences: {
        session: browserSession(worktree),
        // No preload: the page gets no bridge to the app at all.
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        nodeIntegrationInWorker: false,
        webviewTag: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        navigateOnDragDrop: false,
        safeDialogs: true,
        spellcheck: false
      }
    })
    view.setVisible(false)
    view.setBorderRadius(mobile ? RADIUS.mobile : RADIUS.desktop)
    this.window.contentView.addChildView(view)
    const contents = view.webContents
    pageContents.add(contents)
    noticeTargets.set(contents, (message) => this.notify(worktree, message))
    const page: Page = { worktree, view, lastShown: 0, lastInputAt: 0, stateTimer: null, state: { ...this.state(worktree), url: '', mobile } }
    this.pages.set(worktree, page)

    // Only http(s). The page's own origin and this machine open in this view; other sites go to the system
    // browser only right after real input (a page cannot flood the user's browser); the rest is dropped.
    contents.setWindowOpenHandler(({ url }) => {
      const now = Date.now()
      const decision = decidePopup({ url, pageUrl: page.state.url, lastInputAt: page.lastInputAt, lastExternalAt: this.lastExternalAt, now })
      if (decision === 'same-view') this.load(page, url)
      else if (decision === 'external') {
        this.lastExternalAt = now
        void shell.openExternal(url)
      } else this.notify(worktree, '拦下了页面自己打开的新窗口')
      return { action: 'deny' }
    })
    contents.on('will-navigate', (event) => {
      if (!isAllowedUrl(event.url)) event.preventDefault()
    })
    contents.on('will-redirect', (event) => {
      if (event.isMainFrame && !isAllowedUrl(event.url)) event.preventDefault()
    })
    contents.on('will-attach-webview', (event) => event.preventDefault())
    // A beforeunload prompt would leave the page stuck: always let it go.
    contents.on('will-prevent-unload', (event) => event.preventDefault())

    // Real input, and the keyboard chords that belong to the app or to this browser rather than the page.
    contents.on('input-event', (_event, input) => {
      if (input.type === 'mouseDown') page.lastInputAt = Date.now()
    })
    contents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' || input.type === 'rawKeyDown') page.lastInputAt = Date.now()
      const target = pageChord(input)
      if (!target) return
      event.preventDefault()
      if (target.kind === 'app') this.forwardChord(target.command)
      else this.pageAction(page, target.action)
    })
    contents.on('context-menu', (_event, params) => {
      this.send(BROWSER_IPC.contextMenu, {
        worktree,
        x: params.x,
        y: params.y,
        canGoBack: contents.navigationHistory.canGoBack(),
        canCopy: params.editFlags.canCopy,
        canPaste: params.editFlags.canPaste
      } satisfies PageContextMenu)
    })

    const update = (patch: Partial<BrowserPageState>) => {
      page.state = { ...page.state, ...patch }
      this.emit(page)
    }
    contents.on('did-start-loading', () => update({ loading: true, loadError: null }))
    contents.on('did-stop-loading', () => update({ loading: false }))
    contents.on('did-navigate', (_event, url) => {
      // A new document: its console starts empty, and the mobile viewport applies to it too.
      update({ url, console: EMPTY_CONSOLE, loadError: null })
      this.applyEmulation(page)
      this.remember(page)
    })
    contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (!isMainFrame) return
      update({ url })
      this.remember(page)
    })
    contents.on('page-title-updated', (_event, title) => update({ title }))
    contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
      // -3 = aborted (another navigation took over).
      if (!isMainFrame || code === -3) return
      update({ url, loadError: loadErrorText(code, description, url), console: EMPTY_CONSOLE })
      // The address is still what the user wants here: a server that is not up yet will be.
      this.remember(page)
    })
    contents.on('console-message', (details) => {
      // Electron's own dev-build notices are about this app, not the user's page.
      if (details.message.startsWith('%cElectron Security Warning') || details.message.startsWith('Electron Security Warning')) return
      const entry = { level: details.level, message: details.message, source: details.sourceId, line: details.lineNumber }
      page.state = { ...page.state, console: addConsoleEntry(page.state.console, entry) }
      if (entry.level === 'error' || entry.level === 'warning') this.emit(page)
    })
    contents.on('render-process-gone', () => update({ loading: false, loadError: '页面崩溃了，点刷新重新载入' }))
    return page
  }

  private forwardChord(command: AppChordCommand): void {
    // The command (palette, settings, …) takes the keyboard; the page must not keep it.
    this.owner.focus()
    if (command === 'settings') this.send(IPC.uiShowSettings)
    else if (isMenuCommand(command)) this.send(IPC.uiMenuCommand, command)
  }

  private pageAction(page: Page, action: PageAction): void {
    switch (action) {
      case 'focus-address':
        this.owner.focus()
        return this.send(BROWSER_IPC.focusAddress, page.worktree)
      case 'reload':
        return this.reload(page.worktree)
      case 'hard-reload':
        return this.reload(page.worktree, true)
      case 'back':
        return this.back(page.worktree)
      case 'forward':
        return this.forward(page.worktree)
      case 'nothing':
        return
    }
  }

  private load(page: Page, url: string): void {
    if (!isAllowedUrl(url)) return
    page.state = { ...page.state, url, loadError: null }
    this.emit(page)
    // Failures arrive through did-fail-load; the rejected promise carries nothing more.
    page.view.webContents.loadURL(url).catch(() => {})
  }

  private remember(page: Page): void {
    if (isAllowedUrl(page.state.url)) this.remembered.set(page.worktree, { url: page.state.url, mobile: page.state.mobile })
  }

  private layout(page: Page): void {
    page.view.setBounds(this.bounds)
    page.view.setBorderRadius(page.state.mobile ? RADIUS.mobile : RADIUS.desktop)
    this.applyEmulation(page)
  }

  private applyEmulation(page: Page): void {
    const contents = page.view.webContents
    if (contents.isDestroyed()) return
    if (!page.state.mobile) {
      contents.disableDeviceEmulation()
      return
    }
    const size = { width: MOBILE_WIDTH, height: Math.max(1, this.bounds.height) }
    contents.enableDeviceEmulation({
      screenPosition: 'mobile',
      screenSize: size,
      viewSize: size,
      viewPosition: { x: 0, y: 0 },
      deviceScaleFactor: 0,
      scale: 1
    })
  }

  /** Hides a page; if it had the keyboard, the app window gets it back (otherwise typing goes to a hidden page). */
  private conceal(page: Page): void {
    this.releaseFocus(page)
    page.view.setVisible(false)
  }

  private releaseFocus(page: Page): void {
    const contents = page.view.webContents
    if (!contents.isDestroyed() && contents.isFocused() && !this.owner.isDestroyed()) this.owner.focus()
  }

  private notify(worktree: string, message: string): void {
    this.send(BROWSER_IPC.notice, { worktree, message } satisfies BrowserNotice)
  }

  private send(channel: string, ...args: unknown[]): void {
    if (!this.owner.isDestroyed()) this.owner.send(channel, ...args)
  }

  /** Coalesced state push to the app window. */
  private emit(page: Page): void {
    if (page.stateTimer) return
    page.stateTimer = setTimeout(() => {
      page.stateTimer = null
      page.state = this.withHistory(page)
      this.send(BROWSER_IPC.state, page.state)
    }, STATE_THROTTLE_MS)
  }

  private withHistory(page: Page): BrowserPageState {
    const contents = page.view.webContents
    if (contents.isDestroyed()) return page.state
    const history = contents.navigationHistory
    return { ...page.state, canGoBack: history.canGoBack(), canGoForward: history.canGoForward() }
  }

  private evict(): void {
    if (this.pages.size < MAX_PAGES) return
    const oldest = [...this.pages.values()].filter((p) => p !== this.visible).sort((a, b) => a.lastShown - b.lastShown)[0]
    if (!oldest) return
    this.pages.delete(oldest.worktree)
    this.close(oldest)
    // The view shows the remembered address again (no history, no console) until the page is reopened.
    this.send(BROWSER_IPC.state, this.state(oldest.worktree))
  }

  private close(page: Page): void {
    if (page.stateTimer) clearTimeout(page.stateTimer)
    this.releaseFocus(page)
    const contents = page.view.webContents
    if (!contents.isDestroyed() && contents.isDevToolsOpened()) contents.closeDevTools()
    if (!this.window.isDestroyed()) this.window.contentView.removeChildView(page.view)
    if (!contents.isDestroyed()) contents.close()
  }
}
