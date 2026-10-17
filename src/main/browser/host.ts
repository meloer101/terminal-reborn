// The built-in browser's pages (PRD F17 · 浏览器): one WebContentsView per worktree, laid over the rectangle the
// renderer reports. Pages run in their own session partition with no preload, sandboxed and context-isolated, so
// they can never reach `window.tr` or Node; only http(s) is ever loaded, and new windows go to the system browser.
import { BrowserWindow, session, shell, WebContentsView, type Session, type WebContents } from 'electron'
import {
  addConsoleEntry,
  BROWSER_IPC,
  EMPTY_CONSOLE,
  isAllowedUrl,
  type BrowserBounds,
  type BrowserPageState
} from '@shared/browser'
import type { RememberedPages } from './remembered'

export const PARTITION = 'persist:tr-browser'
/** Live pages per window; the least recently shown one beyond this is closed (its URL stays remembered). */
const MAX_PAGES = 4
const STATE_THROTTLE_MS = 80
export const MOBILE_WIDTH = 375
/** Matches the page well's corner (--radius-md) and the mobile frame's (--radius-sm). */
const RADIUS = { desktop: 5, mobile: 3 }
/** Permissions a page may have; everything else (camera, notifications, geolocation, …) is denied. */
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write'])

interface Page {
  view: WebContentsView
  state: BrowserPageState
  lastShown: number
  stateTimer: ReturnType<typeof setTimeout> | null
}

/** Every page's WebContents: never trusted as an IPC sender. */
const pageContents = new WeakSet<WebContents>()

export function isPageContents(contents: WebContents): boolean {
  return pageContents.has(contents)
}

let sessionReady = false

/**
 * Sets up the pages' session ahead of the first page: with a system PAC / WPAD proxy setting, a fresh session's
 * first request waits seconds for the proxy lookup, so that wait happens in the background at startup instead.
 */
export function warmBrowserSession(): void {
  browserSession()
    .resolveProxy('http://localhost/')
    .catch(() => {})
}

/** One-time hardening of the pages' session partition. */
function browserSession(): Session {
  const ses = session.fromPartition(PARTITION)
  if (sessionReady) return ses
  sessionReady = true
  ses.setPermissionRequestHandler((_contents, permission, callback) => callback(ALLOWED_PERMISSIONS.has(permission)))
  ses.setPermissionCheckHandler((_contents, permission) => ALLOWED_PERMISSIONS.has(permission))
  ses.setDevicePermissionHandler(() => false)
  // Downloads are handed to the system browser instead of writing files from here.
  ses.on('will-download', (event, item) => {
    event.preventDefault()
    const url = item.getURL()
    if (isAllowedUrl(url)) void shell.openExternal(url)
  })
  return ses
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
    if (this.visible && this.visible !== page) this.visible.view.setVisible(false)
    this.visible = page
    page.lastShown = Date.now()
    this.layout(page)
    page.view.setVisible(true)
  }

  hide(): void {
    this.generation++
    this.visible?.view.setVisible(false)
    this.visible = null
  }

  /** Snapshot of the visible page, then hides it (a menu or dialog is about to cover it). */
  async cover(): Promise<string | null> {
    const page = this.visible
    if (!page) return null
    const generation = ++this.generation
    let snapshot: string | null = null
    try {
      const image = await page.view.webContents.capturePage()
      snapshot = image.isEmpty() ? null : image.toDataURL()
    } catch {
      // A page that is still loading may refuse; hide it anyway.
    }
    if (generation === this.generation && this.visible === page) {
      page.view.setVisible(false)
      this.visible = null
    }
    return snapshot
  }

  navigate(worktree: string, url: string): void {
    const page = this.pages.get(worktree) ?? this.create(worktree, this.remembered.get(worktree)?.mobile ?? false)
    this.load(page, url)
  }

  back(worktree: string): void {
    const history = this.pages.get(worktree)?.view.webContents.navigationHistory
    if (history?.canGoBack()) history.goBack()
  }

  forward(worktree: string): void {
    const history = this.pages.get(worktree)?.view.webContents.navigationHistory
    if (history?.canGoForward()) history.goForward()
  }

  reload(worktree: string): void {
    const page = this.pages.get(worktree)
    if (!page) return
    // After a failed load the WebContents has no committed URL to reload: load the address again.
    if (page.state.loadError && page.state.url) this.load(page, page.state.url)
    else page.view.webContents.reload()
  }

  setMobile(worktree: string, mobile: boolean): void {
    const page = this.pages.get(worktree)
    const url = page?.state.url ?? this.remembered.get(worktree)?.url ?? ''
    if (url) this.remembered.set(worktree, { url, mobile })
    if (!page) return
    page.state = { ...page.state, mobile }
    // The renderer reports the new (375-wide) rectangle next; until then emulate in the current one.
    this.applyEmulation(page)
    this.emit(page)
  }

  openExternal(worktree: string): void {
    const url = this.pages.get(worktree)?.state.url ?? this.remembered.get(worktree)?.url
    if (url && isAllowedUrl(url)) void shell.openExternal(url)
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
        session: browserSession(),
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
    const page: Page = { view, lastShown: 0, stateTimer: null, state: { ...this.state(worktree), url: '', mobile } }
    this.pages.set(worktree, page)

    // Only http(s), in this view; anything that wants a new window goes to the system browser.
    contents.setWindowOpenHandler(({ url }) => {
      if (isAllowedUrl(url)) void shell.openExternal(url)
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

    const update = (patch: Partial<BrowserPageState>) => {
      page.state = { ...page.state, ...patch }
      this.emit(page)
    }
    contents.on('did-start-loading', () => update({ loading: true, loadError: null }))
    contents.on('did-stop-loading', () => update({ loading: false }))
    contents.on('did-navigate', (_event, url) => {
      // A new document: its console starts empty.
      update({ url, console: EMPTY_CONSOLE, loadError: null })
      this.remember(worktree, page)
    })
    contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (!isMainFrame) return
      update({ url })
      this.remember(worktree, page)
    })
    contents.on('page-title-updated', (_event, title) => update({ title }))
    contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
      // -3 = aborted (another navigation took over).
      if (!isMainFrame || code === -3) return
      update({ url, loadError: loadErrorText(code, description, url), console: EMPTY_CONSOLE })
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

  private load(page: Page, url: string): void {
    if (!isAllowedUrl(url)) return
    page.state = { ...page.state, url, loadError: null }
    this.emit(page)
    // Failures arrive through did-fail-load; the rejected promise carries nothing more.
    page.view.webContents.loadURL(url).catch(() => {})
  }

  private remember(worktree: string, page: Page): void {
    if (isAllowedUrl(page.state.url)) this.remembered.set(worktree, { url: page.state.url, mobile: page.state.mobile })
  }

  private layout(page: Page): void {
    page.view.setBounds(this.bounds)
    page.view.setBorderRadius(page.state.mobile ? RADIUS.mobile : RADIUS.desktop)
    this.applyEmulation(page)
  }

  private applyEmulation(page: Page): void {
    const contents = page.view.webContents
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

  /** Coalesced state push to the app window. */
  private emit(page: Page): void {
    if (page.stateTimer) return
    page.stateTimer = setTimeout(() => {
      page.stateTimer = null
      page.state = this.withHistory(page)
      if (!this.owner.isDestroyed()) this.owner.send(BROWSER_IPC.state, page.state)
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
    const oldest = [...this.pages.entries()].filter(([, p]) => p !== this.visible).sort((a, b) => a[1].lastShown - b[1].lastShown)[0]
    if (!oldest) return
    this.pages.delete(oldest[0])
    this.close(oldest[1])
  }

  private close(page: Page): void {
    if (page.stateTimer) clearTimeout(page.stateTimer)
    if (!this.window.isDestroyed()) this.window.contentView.removeChildView(page.view)
    if (!page.view.webContents.isDestroyed()) page.view.webContents.close()
  }
}
