import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon, type ISearchOptions, type ISearchResultChangeEvent } from '@xterm/addon-search'
import { SerializeAddon } from '@xterm/addon-serialize'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { whenAppearanceKnown } from './appearance-ready'
import { buildFontStack, DEFAULT_APPEARANCE, readThemeFromDocument, withAlpha } from './appearance'
import { macKeyToBytes } from './keymap'
import { findLigatureRanges } from './ligatures'
import { readBufferText } from './screen-text'
import { reattachPayload } from './reattach-payload'
import { restorePayload, SNAPSHOT_MAX_CHARS, SNAPSHOT_SCROLLBACK_STEPS } from './snapshot-payload'
import { createWheelState, wheelReportCount } from './tui-wheel'
import type { PtyScreen, TerminalSnapshot } from '@shared/ipc'
import type { Disposable, TerminalAppearance, TerminalSurface } from './surface'

export interface SurfaceDebugInfo {
  fontFamily: string
  fontSize: number
  lineHeight: number
  allowTransparency: boolean
  background: string
  renderer: 'webgl' | 'dom'
  ligatures: boolean
  cols: number
  rows: number
}

const SCROLLBACK_LINES = 10_000
/** Marks the one-row wheel events we dispatch ourselves, so the wheel handler lets xterm report them. */
const REPLAYED_WHEEL = Symbol('replayed-wheel')
const FONT_LOAD_TIMEOUT_MS = 1500
/** A terminal whose WebGL context is lost this often stays on the DOM renderer for good. */
const WEBGL_MAX_LOSSES = 3

export interface FindOptions {
  caseSensitive: boolean
  /** previous = towards older output (up), next = towards newer output (down). */
  direction: 'previous' | 'next'
  /** Typing: grow the current match instead of jumping past it. */
  incremental?: boolean
}

export interface XtermSurfaceOptions {
  /** false = always the DOM renderer (the settings preview, so it never shares the WebGL glyph atlas). */
  webgl?: boolean
}

/**
 * Surfaces currently drawing with WebGL. The addon shares one glyph atlas between terminals with
 * the same font and colors, but `clearTextureAtlas()` only resets the caller's cell model: every
 * other terminal on that atlas keeps texture coordinates into wiped pages and draws garbage on its
 * next frame. So a clear always goes to all of them (see clearAtlas).
 */
const webglSurfaces = new Set<XtermSurface>()

/** xterm.js implementation of TerminalSurface (docs/PRD.md §6.3). */
export class XtermSurface implements TerminalSurface {
  private readonly term: Terminal
  private readonly fitAddon = new FitAddon()
  private readonly serializeAddon = new SerializeAddon()
  private webgl: WebglAddon | null = null
  private webglUnavailable = false
  /** The WebGL context was lost: DOM renderer until the terminal is shown again (B18). */
  private webglLost = false
  private webglLosses = 0
  private readonly searchAddon = new SearchAddon({ highlightLimit: 1000 })
  private findCaseSensitive = false
  private visible = true
  private disposed = false
  private appearance: TerminalAppearance = { ...DEFAULT_APPEARANCE }
  private readonly themeObserver: MutationObserver
  private ligatureJoinerId: number | null = null
  /** Bumped per setAppearance so a slow font load never overwrites a newer change. */
  private appearanceSeq = 0
  private openPromise: Promise<void> | null = null
  private container: HTMLElement | null = null

  constructor(options: XtermSurfaceOptions = {}) {
    this.webglUnavailable = options.webgl === false
    this.term = new Terminal({
      allowProposedApi: true, // unicode11 addon
      scrollback: SCROLLBACK_LINES,
      fontFamily: buildFontStack(this.appearance),
      fontSize: this.appearance.fontSize,
      lineHeight: this.appearance.lineHeight,
      rescaleOverlappingGlyphs: true,
      cursorBlink: false,
      allowTransparency: this.isTransparent(),
      theme: this.buildTheme()
    })
    this.term.loadAddon(this.fitAddon)
    this.term.loadAddon(this.serializeAddon)
    this.term.loadAddon(this.searchAddon)
    this.term.loadAddon(new Unicode11Addon())
    this.term.unicode.activeVersion = '11'
    // Plain clicks open links through window.open, which main routes to the default browser.
    this.term.loadAddon(new WebLinksAddon((_event, uri) => window.open(uri, '_blank')))
    this.attachTuiWheel()
    this.term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true
      const bytes = macKeyToBytes(event)
      if (bytes === null) return true
      event.preventDefault()
      this.term.input(bytes, true)
      return false
    })

    // Re-theme when <html data-theme> flips (theme.ts also follows the system setting).
    this.themeObserver = new MutationObserver(() => this.applyTheme())
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  }

  /**
   * While a full-screen program has mouse tracking on, xterm sends at most one wheel report per wheel event and
   * damps trackpad deltas, so the program scrolls a fraction of the gesture. Instead, work out how many rows the
   * gesture covered (tui-wheel.ts) and let xterm report that many one-row wheel events, in one microtask so the
   * reports reach the PTY as one write (SessionTerminal coalesces input).
   */
  private attachTuiWheel(): void {
    const state = createWheelState()
    let pending = 0
    let pendingEvent: WheelEvent | null = null
    let target: EventTarget | null = null
    const drain = (): void => {
      const event = pendingEvent
      const count = pending
      pending = 0
      pendingEvent = null
      if (!event || !target || this.disposed || this.term.modes.mouseTrackingMode === 'none') return
      for (let i = 0; i < count; i++) target.dispatchEvent(oneRowWheel(event))
    }
    this.term.attachCustomWheelEventHandler((event) => {
      if ((event as WheelEvent & { [REPLAYED_WHEEL]?: true })[REPLAYED_WHEEL]) return true
      if (this.term.modes.mouseTrackingMode === 'none' || event.deltaY === 0 || event.shiftKey) return true
      target = event.currentTarget ?? this.term.element ?? null
      if (!target) return true
      const reports = wheelReportCount(event, state, { cellHeight: this.cellHeight(), rows: this.term.rows })
      if (reports > 0) {
        if (pendingEvent && pendingEvent.deltaY < 0 !== event.deltaY < 0) pending = 0
        if (pending === 0 && !pendingEvent) queueMicrotask(drain)
        pending += reports
        pendingEvent = event
      }
      return false
    })
  }

  private cellHeight(): number | undefined {
    const screen = this.term.element?.querySelector<HTMLElement>('.xterm-screen')
    const height = screen?.getBoundingClientRect().height ?? 0
    return height > 0 && this.term.rows > 0 ? height / this.term.rows : undefined
  }

  /** Resolves once the terminal is attached to the DOM and measured with its real font. */
  whenOpen(): Promise<void> {
    return this.openPromise ?? Promise.resolve()
  }

  mount(container: HTMLElement): void {
    if (this.disposed) return
    if (this.openPromise) {
      // Re-parenting (e.g. the React tree remounted): move the existing DOM, keep all state.
      if (this.term.element && this.term.element.parentElement !== container) container.appendChild(this.term.element)
      this.container = container
      return
    }
    this.container = container
    this.openPromise = whenAppearanceKnown().then(() => this.loadFonts()).then(() => {
      if (this.disposed || !this.container) return
      this.term.open(this.container)
      this.syncLigatures()
      this.syncRenderer()
      this.fit()
      void document.fonts.ready.then(() => this.refreshGlyphs())
    })
  }

  /** xterm measures cells at open(); make sure the web font is in so they are right. */
  private async loadFonts(): Promise<void> {
    const { fontFamily, cjkFontFamily, fontSize } = this.appearance
    const loads = [fontFamily, cjkFontFamily].map((family) => document.fonts.load(`${fontSize}px "${family}"`).catch(() => []))
    await Promise.race([Promise.all(loads), new Promise((resolve) => setTimeout(resolve, FONT_LOAD_TIMEOUT_MS))])
  }

  /**
   * Hidden terminals drop their WebGL context (browsers cap live contexts at ~16, and a
   * hidden canvas is wasted work); showing one brings the context back.
   */
  setVisible(visible: boolean): void {
    this.visible = visible
    // A context lost while drawing (GPU reset, too many contexts) gets another chance when the terminal is shown.
    if (visible) this.webglLost = false
    this.syncRenderer()
    if (visible) {
      this.fit()
      this.clearAtlas()
      this.term.refresh(0, this.term.rows - 1)
    }
  }

  /**
   * Re-measures and redraws from scratch. After the display sleeps or the window moves to a screen with another
   * scale, the GPU may have dropped the glyph textures and the container may have changed size without a
   * ResizeObserver tick, so the canvas shows stale rows; this puts the screen back in line with the buffer.
   */
  repaint(): { cols: number; rows: number } {
    if (this.disposed || !this.term.element || !this.visible) return this.size
    const size = this.fit()
    this.clearAtlas()
    this.term.refresh(0, this.term.rows - 1)
    return size
  }

  private syncRenderer(): void {
    if (this.disposed || !this.term.element) return
    // WebGL paints italic/dim/underlined cells with an opaque background when the surface is
    // transparent (research §2.2, xterm #6116), so transparent terminals use the DOM renderer.
    const wantWebgl = this.visible && !this.webglUnavailable && !this.webglLost && !this.isTransparent()
    if (wantWebgl && !this.webgl) this.loadWebgl()
    else if (!wantWebgl && this.webgl) this.unloadWebgl()
  }

  private loadWebgl(): void {
    try {
      const addon = new WebglAddon()
      addon.onContextLoss(() => {
        // Per-terminal fallback: this terminal drops to the DOM renderer (others keep WebGL) and retries when it is
        // next shown; after repeated losses it stays on the DOM renderer.
        this.webglLosses += 1
        if (this.webglLosses >= WEBGL_MAX_LOSSES) this.webglUnavailable = true
        else this.webglLost = true
        this.unloadWebgl()
      })
      this.term.loadAddon(addon)
      this.webgl = addon
      webglSurfaces.add(this)
    } catch {
      this.webglUnavailable = true
      this.webgl = null
    }
  }

  private unloadWebgl(): void {
    const addon = this.webgl
    this.webgl = null
    webglSurfaces.delete(this)
    try {
      addon?.dispose()
    } catch {
      // Context already lost.
    }
  }

  /** Rebuilds glyphs; with WebGL, for every terminal that may share this one's atlas. */
  private clearAtlas(): void {
    if (!this.webgl) {
      this.term.clearTextureAtlas()
      return
    }
    for (const surface of webglSurfaces) surface.term.clearTextureAtlas()
  }

  private applyTheme(): void {
    this.term.options.theme = this.buildTheme()
    this.clearAtlas()
  }

  private get backgroundAlpha(): number {
    return this.appearance.backgroundAlpha ?? 1
  }

  /** Transparent cells need allowTransparency (it disables subpixel AA, so only then). */
  private isTransparent(): boolean {
    return this.backgroundAlpha < 1
  }

  /** The document theme with the default background at the configured alpha. */
  private buildTheme(): ITheme {
    const theme = readThemeFromDocument()
    if (!this.isTransparent() || !theme.background) return theme
    return { ...theme, background: withAlpha(theme.background, this.backgroundAlpha) }
  }

  /** Registers (or removes) the ligature joiner; needs an opened terminal. */
  private syncLigatures(): void {
    if (this.disposed || !this.term.element) return
    if (this.appearance.ligatures && this.ligatureJoinerId === null) {
      this.ligatureJoinerId = this.term.registerCharacterJoiner(findLigatureRanges)
    } else if (!this.appearance.ligatures && this.ligatureJoinerId !== null) {
      this.term.deregisterCharacterJoiner(this.ligatureJoinerId)
      this.ligatureJoinerId = null
    }
  }

  private refreshGlyphs(): void {
    if (this.disposed) return
    this.clearAtlas()
    this.fit()
  }

  /** What the terminal shows now (plus scrollback), for painting a reopened session at once; null if unopened. */
  snapshot(): TerminalSnapshot | null {
    if (this.disposed || !this.term.element) return null
    for (const scrollback of SNAPSHOT_SCROLLBACK_STEPS) {
      const data = this.serializeAddon.serialize({ scrollback, excludeModes: true })
      if (data.length <= SNAPSHOT_MAX_CHARS) return { cols: this.term.cols, rows: this.term.rows, data }
    }
    return null
  }

  /** Paints a saved snapshot at the size it was taken, then fits to the container; resolves once parsed. */
  restore(snapshot: TerminalSnapshot): Promise<void> {
    if (this.disposed || !this.term.element) return Promise.resolve()
    if (snapshot.cols !== this.term.cols || snapshot.rows !== this.term.rows) this.term.resize(snapshot.cols, snapshot.rows)
    return new Promise((resolve) => {
      this.term.write(restorePayload(snapshot.data, snapshot.rows), () => {
        this.fit()
        resolve()
      })
    })
  }

  /**
   * Shows a live process's screen from the pty daemon, at the size it was captured (the PTY's size), with its modes.
   * Does not fit: the caller fits once it listens for resizes, so the PTY learns the container's size.
   */
  reattach(screen: PtyScreen): Promise<void> {
    if (this.disposed || !this.term.element) return Promise.resolve()
    if (screen.cols !== this.term.cols || screen.rows !== this.term.rows) this.term.resize(screen.cols, screen.rows)
    return new Promise((resolve) => this.term.write(reattachPayload(screen), resolve))
  }

  write(data: string, callback?: () => void): void {
    this.term.write(data, callback)
  }

  onInput(listener: (data: string) => void): Disposable {
    return this.term.onData(listener)
  }

  fit(): { cols: number; rows: number } {
    if (this.term.element?.isConnected && this.term.element.offsetParent !== null) {
      try {
        this.fitAddon.fit()
      } catch {
        // Container has no layout yet; keep the current size.
      }
    }
    return { cols: this.term.cols, rows: this.term.rows }
  }

  /** Current grid size, without re-fitting. */
  get size(): { cols: number; rows: number } {
    return { cols: this.term.cols, rows: this.term.rows }
  }

  onResize(listener: (size: { cols: number; rows: number }) => void): Disposable {
    return this.term.onResize(listener)
  }

  focus(): void {
    this.term.focus()
  }

  readScreen(scrollbackLines = 0): string {
    return readBufferText(this.term.buffer.active, this.term.rows, scrollbackLines)
  }

  onTitleChange(listener: (title: string) => void): Disposable {
    return this.term.onTitleChange(listener)
  }

  onOsc(code: number, listener: (payload: string) => void): Disposable {
    return this.term.parser.registerOscHandler(code, (payload) => {
      listener(payload)
      return false // let any other handler (and xterm's built-ins) see it too
    })
  }

  setAppearance(next: Partial<TerminalAppearance>): void {
    const prev = this.appearance
    this.appearance = { ...prev, ...next }
    const cur = this.appearance
    const seq = ++this.appearanceSeq
    const fontsChanged = cur.fontFamily !== prev.fontFamily || cur.cjkFontFamily !== prev.cjkFontFamily

    if (!this.term.element) {
      // Not opened yet: open() reads this.appearance, only the cheap options need setting.
      this.term.options.fontSize = cur.fontSize
      this.term.options.lineHeight = cur.lineHeight
      this.term.options.fontFamily = buildFontStack(cur)
      this.term.options.allowTransparency = this.isTransparent()
      this.term.options.theme = this.buildTheme()
      this.term.options.screenReaderMode = cur.screenReader === true
      return
    }

    const apply = (): void => {
      if (this.disposed || seq !== this.appearanceSeq) return
      this.term.options.fontFamily = buildFontStack(cur)
      this.term.options.fontSize = cur.fontSize
      this.term.options.lineHeight = cur.lineHeight
      this.term.options.allowTransparency = this.isTransparent()
      this.term.options.theme = this.buildTheme()
      this.term.options.screenReaderMode = cur.screenReader === true
      this.syncLigatures()
      this.syncRenderer()
      // Glyph metrics changed: rebuild the atlas, then refit so cols/rows (and the PTY) follow.
      this.clearAtlas()
      this.fit()
    }
    if (fontsChanged) void this.loadFonts().then(apply)
    else apply()
  }

  /** Finds `query` in the buffer and scrolls to it, highlighting every match (B18). Returns whether it matched. */
  find(query: string, options: FindOptions): boolean {
    if (query === '') {
      this.searchAddon.clearDecorations()
      return false
    }
    // The addon only recounts matches when the query changes, not when the case option does.
    if (this.findCaseSensitive !== options.caseSensitive) this.searchAddon.clearDecorations()
    this.findCaseSensitive = options.caseSensitive
    const style = getComputedStyle(document.documentElement)
    const color = (name: string): string => style.getPropertyValue(name).trim()
    const search: ISearchOptions = {
      caseSensitive: options.caseSensitive,
      incremental: options.incremental ?? false,
      decorations: {
        matchBackground: color('--term-find-match'),
        activeMatchBackground: color('--term-find-active'),
        matchOverviewRuler: color('--term-find-match'),
        activeMatchColorOverviewRuler: color('--term-find-active')
      }
    }
    return options.direction === 'next' ? this.searchAddon.findNext(query, search) : this.searchAddon.findPrevious(query, search)
  }

  /** Match position and count of the last find (resultIndex -1 when there are too many to count). */
  onFindResults(listener: (results: ISearchResultChangeEvent) => void): Disposable {
    return this.searchAddon.onDidChangeResults(listener)
  }

  clearFind(): void {
    this.searchAddon.clearDecorations()
    this.term.clearSelection()
  }

  /** Test/debug view of what the terminal is actually running with. */
  debugInfo(): SurfaceDebugInfo {
    return {
      fontFamily: this.term.options.fontFamily ?? '',
      fontSize: this.term.options.fontSize ?? 0,
      lineHeight: this.term.options.lineHeight ?? 0,
      allowTransparency: this.term.options.allowTransparency ?? false,
      background: this.term.options.theme?.background ?? '',
      renderer: this.webgl ? 'webgl' : 'dom',
      ligatures: this.ligatureJoinerId !== null,
      cols: this.term.cols,
      rows: this.term.rows
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.themeObserver.disconnect()
    this.unloadWebgl()
    this.term.dispose()
  }
}

/** A copy of a wheel event that scrolls exactly one line, flagged so our own wheel handler passes it through. */
function oneRowWheel(event: WheelEvent): WheelEvent {
  const clone = new WheelEvent(event.type, {
    bubbles: event.bubbles,
    cancelable: event.cancelable,
    composed: event.composed,
    view: event.view,
    screenX: event.screenX,
    screenY: event.screenY,
    clientX: event.clientX,
    clientY: event.clientY,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    metaKey: event.metaKey,
    deltaY: event.deltaY < 0 ? -1 : 1,
    deltaMode: WheelEvent.DOM_DELTA_LINE
  })
  Object.defineProperty(clone, REPLAYED_WHEEL, { value: true })
  return clone
}
