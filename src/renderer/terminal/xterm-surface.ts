import { Terminal, type IBufferRange, type ILink, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon, type ISearchOptions, type ISearchResultChangeEvent } from '@xterm/addon-search'
import { SerializeAddon } from '@xterm/addon-serialize'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { whenAppearanceKnown } from './appearance-ready'
import { atlasAction } from './atlas-guard'
import { buildFontStack, DEFAULT_APPEARANCE, readThemeFromDocument, withAlpha } from './appearance'
import { defersToTextInput, macKeyToBytes } from './keymap'
import { isAutoPeriod } from './ime'
import { findLigatureRanges } from './ligatures'
import { deferSelectionRedrawWhilePaused } from './paused-selection'
import { cellText, findPathCandidates, resolvedCandidates, type Cell } from './file-links'
import { linkHint, URL_PATTERN, type LinkRef, type PathResolver, type TerminalLink } from './links'
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
  /** Widths of the WebGL glyph atlas pages in device pixels (merged pages are wider); null without WebGL. */
  atlasPages: number[] | null
  /** How often the atlas guard recreated the WebGL renderers or fell back to DOM (all terminals). */
  atlasResets: { recreated: number; overflowed: number }
}

/** The one addon internal the atlas guard reads (the atlas's pages); every step may be missing in another version. */
interface AtlasInternals {
  _core?: { _renderService?: { _renderer?: { value?: { _charAtlas?: { pages?: { canvas: HTMLCanvasElement }[] } } } } }
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

/** A check is queued for after the current task (the atlas reports pages from inside a render). */
let atlasCheckQueued = false
let atlasMerged = false
/** Set by a reset until the frame after it has been drawn (see atlasAction's `dom`). */
let atlasJustReset = false
/** What the guard did, for the e2e stress test. */
const atlasResets = { recreated: 0, overflowed: 0 }

/** A soft-wrapped line is searched for paths at most this many rows above (and twice this many in all). */
const WRAPPED_ROWS_MAX = 16

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
  private readonly linkListeners = new Set<(link: TerminalLink) => void>()
  private readonly menuListeners = new Set<(at: { x: number; y: number }) => void>()
  /** The link under the pointer, so a right-click on it opens the link menu. */
  private hoveredLink: LinkRef | null = null
  /** Which printed paths are files of the session; without one, paths are not links. */
  private pathResolver: PathResolver | null = null
  /** From compositionstart until xterm has sent the committed text (it does so a task after compositionend). */
  private composing = false
  /** The keydown was left to its keypress (defersToTextInput). */
  private keyDeferred = false
  /** The last input sent to the PTY and when (performance.now()), for telling typed text from the text system's. */
  private lastInput = { data: '', at: 0 }

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
      // Agents' TUIs turn on mouse reporting, which takes plain drags; ⌥-drag still selects text there (B19).
      macOptionClickForcesSelection: true,
      allowTransparency: this.isTransparent(),
      theme: this.buildTheme(),
      // OSC 8 hyperlinks: same rules as plain-text URLs (PRD F17).
      linkHandler: {
        activate: (event, uri) => this.activateUrl(event, uri),
        hover: (_event, uri) => this.hoverLink({ kind: 'url', url: uri }),
        leave: () => this.leaveLink(),
        allowNonHttpProtocols: false
      }
    })
    this.term.loadAddon(this.fitAddon)
    this.term.loadAddon(this.serializeAddon)
    this.term.loadAddon(this.searchAddon)
    this.term.loadAddon(new Unicode11Addon())
    this.term.unicode.activeVersion = '11'
    this.term.loadAddon(
      new WebLinksAddon((event, uri) => this.activateUrl(event, uri), {
        hover: (_event, uri) => this.hoverLink({ kind: 'url', url: uri }),
        leave: () => this.leaveLink(),
        // Ends a URL at CJK text and full-width punctuation too (Chinese prose has no space after a URL).
        urlRegex: URL_PATTERN
      })
    )
    // File paths that main finds inside the session's worktree (PRD F17).
    this.term.registerLinkProvider({ provideLinks: (y, callback) => this.providePathLinks(y, callback) })
    this.attachTuiWheel()
    this.term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true
      this.keyDeferred = false
      const bytes = macKeyToBytes(event)
      if (bytes !== null) {
        event.preventDefault()
        this.term.input(bytes, true)
        return false
      }
      // A printable key is sent from its keypress, which carries what the input method typed (`，` for `,`). Right
      // after a composition xterm's keydown path first sends the committed text, so the order stays; screen reader
      // mode keeps that path too, as it leaves the character in the textarea for the reader.
      this.keyDeferred = defersToTextInput(event) && !this.composing && this.term.options.screenReaderMode !== true
      return !this.keyDeferred
    })
    this.term.onData((data) => {
      this.lastInput = { data, at: performance.now() }
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

  /** The document the terminal is in: the main window's, or a secondary window's (F20 · 多窗口). */
  ownerDocument(): Document {
    return this.term.element?.ownerDocument ?? document
  }

  /** Resolves once the terminal is attached to the DOM and measured with its real font. */
  whenOpen(): Promise<void> {
    return this.openPromise ?? Promise.resolve()
  }

  mount(container: HTMLElement): void {
    if (this.disposed) return
    if (this.openPromise) {
      // Re-parenting (e.g. the React tree remounted): move the existing DOM, keep all state.
      const element = this.term.element
      if (element && element.parentElement !== container) {
        // Into another window (F20 · 多窗口): the WebGL context belongs to the old window's canvas, so the terminal draws
        // with the DOM until it is set up again; open() again tells xterm about its new window (pixel ratio, events).
        const otherWindow = element.ownerDocument !== container.ownerDocument
        if (otherWindow) this.unloadWebgl()
        container.appendChild(element)
        if (otherWindow) {
          this.term.open(container)
          this.syncRenderer()
          this.fit()
        }
      }
      this.container = container
      return
    }
    this.container = container
    this.openPromise = whenAppearanceKnown().then(() => this.loadFonts()).then(() => {
      if (this.disposed || !this.container) return
      this.term.open(this.container)
      // Hidden terminals that print would otherwise redraw their whole screen every frame (paused-selection.ts).
      deferSelectionRedrawWhilePaused(this.term)
      this.term.element?.addEventListener('contextmenu', (event) => this.handleContextMenu(event))
      this.watchTextInput()
      this.syncLigatures()
      this.syncRenderer()
      this.fit()
      void document.fonts.ready.then(() => this.refreshGlyphs())
    })
  }

  /**
   * Follows IME composition on xterm's textarea, and drops text the macOS input system inserts on its own (ime.ts).
   * Listens on the terminal element in the capture phase, so it sees input before xterm's textarea handlers do.
   */
  private watchTextInput(): void {
    const element = this.term.element
    const textarea = this.term.textarea
    if (!element || !textarea) return
    let compositions = 0
    textarea.addEventListener('compositionstart', () => {
      compositions += 1
      this.composing = true
    })
    // Registered after xterm's own listener, so this runs after the task in which xterm sends the committed text.
    textarea.addEventListener('compositionend', () => {
      const ended = compositions
      setTimeout(() => {
        if (ended === compositions) this.composing = false
      }, 0)
    })
    // xterm sends a keypress's character but does not cancel the event, so it would also land in the textarea, where
    // xterm reads composed text from; cancelled, the textarea only holds what the IME composes, as with keydown input.
    textarea.addEventListener('keypress', (event) => {
      if (this.keyDeferred) event.preventDefault()
    })
    const held = new Set<string>()
    element.addEventListener('keydown', (event) => held.add(event.code), true)
    element.addEventListener('keyup', (event) => held.delete(event.code), true)
    textarea.addEventListener('blur', () => held.clear())
    const dropAutoPeriod = (event: Event): void => {
      // Not `instanceof InputEvent`: in a secondary window the event comes from that window's InputEvent.
      if (event.target !== textarea || !('inputType' in event)) return
      const input = event as InputEvent
      const insertion = {
        inputType: input.inputType,
        data: input.data,
        keyHeld: held.size > 0,
        lastInput: this.lastInput.data,
        msSinceLastInput: performance.now() - this.lastInput.at
      }
      if (!isAutoPeriod(insertion)) return
      event.preventDefault()
      event.stopPropagation()
    }
    element.addEventListener('beforeinput', dropAutoPeriod, true)
    element.addEventListener('input', dropAutoPeriod, true)
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
      // Reset the atlas before addon-webgl 0.19 would merge its pages and garble the text (atlas-guard.ts).
      addon.onAddTextureAtlasCanvas(() => XtermSurface.queueAtlasCheck(false))
      addon.onRemoveTextureAtlasCanvas(() => XtermSurface.queueAtlasCheck(true))
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

  /** An atlas grew (`merged`: pages were merged away); checks the atlases once the current task is done. */
  private static queueAtlasCheck(merged: boolean): void {
    if (merged) atlasMerged = true
    if (atlasCheckQueued) return
    atlasCheckQueued = true
    queueMicrotask(() => XtermSurface.checkAtlases())
  }

  /** Starts the renderers on a new atlas once one nears the merge point or merged pages (atlas-guard.ts). */
  private static checkAtlases(): void {
    atlasCheckQueued = false
    const merged = atlasMerged
    atlasMerged = false
    const surfaces = [...webglSurfaces]
    const pages = Math.max(0, ...surfaces.map((surface) => surface.atlasPageWidths()?.length ?? 0))
    const action = atlasAction({ merged, pages, justReset: atlasJustReset })
    if (action === 'none') return
    if (action === 'dom') {
      atlasResets.overflowed++
      for (const surface of surfaces) {
        surface.webglLost = true
        surface.unloadWebgl()
      }
    } else {
      atlasResets.recreated++
      // All of them first: the old atlas goes away with its last renderer.
      for (const surface of surfaces) surface.unloadWebgl()
      for (const surface of surfaces) surface.syncRenderer()
    }
    for (const surface of surfaces) {
      if (!surface.disposed) surface.term.refresh(0, surface.term.rows - 1)
    }
    // The redraw is the next frame's render; this flag outlives it by one frame.
    atlasJustReset = true
    requestAnimationFrame(() => requestAnimationFrame(() => (atlasJustReset = false)))
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
    const theme = this.appearance.customTheme ?? readThemeFromDocument()
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

  bracketedPasteMode(): boolean {
    return this.term.modes.bracketedPasteMode
  }

  readScreen(scrollbackLines = 0): string {
    return readBufferText(this.term.buffer.active, this.term.rows, scrollbackLines)
  }

  onTitleChange(listener: (title: string) => void): Disposable {
    return this.term.onTitleChange(listener)
  }

  onLink(listener: (link: TerminalLink) => void): Disposable {
    this.linkListeners.add(listener)
    return { dispose: () => void this.linkListeners.delete(listener) }
  }

  setPathResolver(resolver: PathResolver | null): void {
    this.pathResolver = resolver
  }

  getSelection(): string {
    return this.term.getSelection()
  }

  selectAll(): void {
    this.term.selectAll()
  }

  onContextMenu(listener: (at: { x: number; y: number }) => void): Disposable {
    this.menuListeners.add(listener)
    return { dispose: () => void this.menuListeners.delete(listener) }
  }

  private activateUrl(event: MouseEvent, url: string): void {
    // Without a listener (the settings preview) window.open goes to main, which hands http(s) to the system browser.
    if (this.linkListeners.size === 0) return void window.open(url, '_blank')
    this.emitLink({ kind: 'url', url, action: 'open', metaKey: event.metaKey, x: event.clientX, y: event.clientY })
  }

  private hoverLink(ref: LinkRef): void {
    this.hoveredLink = ref
    if (this.term.element) this.term.element.title = linkHint(ref)
  }

  private leaveLink(): void {
    this.hoveredLink = null
    this.term.element?.removeAttribute('title')
  }

  private handleContextMenu(event: MouseEvent): void {
    const ref = this.hoveredLink
    if (ref && this.linkListeners.size > 0) {
      event.preventDefault()
      this.emitLink({ ...ref, action: 'menu', metaKey: event.metaKey, x: event.clientX, y: event.clientY })
      return
    }
    if (this.menuListeners.size === 0) return
    event.preventDefault()
    for (const listener of [...this.menuListeners]) listener({ x: event.clientX, y: event.clientY })
  }

  /** Path-looking text in the (wrapped) line at buffer row `y` (1-based) that main confirms is a file of the session. */
  private providePathLinks(y: number, callback: (links: ILink[] | undefined) => void): void {
    const resolve = this.pathResolver
    if (!resolve || this.linkListeners.size === 0) return callback(undefined)
    const { text, cells, firstRow } = this.wrappedLine(y - 1)
    const candidates = findPathCandidates(text)
    if (candidates.length === 0) return callback(undefined)
    resolve(candidates.map((c) => c.path)).then(
      (resolved) => {
        const links: ILink[] = resolvedCandidates(candidates, resolved).map(({ candidate, path }) => {
          const ref: LinkRef = { kind: 'file', path, line: candidate.line, column: candidate.column }
          return {
            range: this.cellRange(firstRow, cells[candidate.start]!, cells[candidate.end]! - 1),
            text: text.slice(candidate.start, candidate.end),
            activate: (event) => this.emitLink({ ...ref, action: 'open', metaKey: event.metaKey, x: event.clientX, y: event.clientY }),
            hover: () => this.hoverLink(ref),
            leave: () => this.leaveLink()
          }
        })
        callback(links.length > 0 ? links : undefined)
      },
      () => callback(undefined)
    )
  }

  /** The logical line around buffer row `row` (0-based): soft-wrapped rows joined, up to WRAPPED_ROWS_MAX of them. */
  private wrappedLine(row: number): { text: string; cells: number[]; firstRow: number } {
    const buffer = this.term.buffer.active
    let firstRow = row
    while (firstRow > 0 && row - firstRow < WRAPPED_ROWS_MAX && buffer.getLine(firstRow)?.isWrapped) firstRow--
    const scratch = buffer.getNullCell()
    const rowCells: Cell[] = []
    for (let r = firstRow; r < buffer.length && r < firstRow + 2 * WRAPPED_ROWS_MAX; r++) {
      const line = buffer.getLine(r)
      if (!line || (r > firstRow && !line.isWrapped)) break
      for (let x = 0; x < this.term.cols; x++) {
        const cell = line.getCell(x, scratch)
        rowCells.push(cell ? { chars: cell.getChars(), width: cell.getWidth() } : { chars: '', width: 1 })
      }
    }
    return { ...cellText(rowCells), firstRow }
  }

  /** Buffer range (1-based, end inclusive) of cells `from`..`to` counted from the start of row `firstRow`. */
  private cellRange(firstRow: number, from: number, to: number): IBufferRange {
    const cols = this.term.cols
    return {
      start: { x: (from % cols) + 1, y: firstRow + Math.floor(from / cols) + 1 },
      end: { x: (to % cols) + 1, y: firstRow + Math.floor(to / cols) + 1 }
    }
  }

  private emitLink(link: TerminalLink): void {
    for (const listener of [...this.linkListeners]) listener(link)
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
      rows: this.term.rows,
      atlasPages: this.webgl ? this.atlasPageWidths() : null,
      atlasResets: { ...atlasResets }
    }
  }

  private atlasPageWidths(): number[] | null {
    const pages = (this.term as unknown as AtlasInternals)._core?._renderService?._renderer?.value?._charAtlas?.pages
    return pages ? pages.map((page) => page.canvas.width) : null
  }

  /**
   * Test hook (e2e/webgl-cjk-stress.spec.ts). 'rebind' re-uploads every atlas page to the GPU and rebuilds the cell
   * model from the atlas as it is (a theme change does both), so it draws what the current atlas says without
   * resetting it; 'rebuild' clears the atlas and rasterizes the screen from scratch.
   */
  debugRedraw(mode: 'rebind' | 'rebuild'): void {
    if (this.disposed || !this.term.element) return
    if (mode === 'rebind') this.term.options.theme = { ...this.term.options.theme }
    else this.clearAtlas()
    this.term.refresh(0, this.term.rows - 1)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.linkListeners.clear()
    this.menuListeners.clear()
    this.pathResolver = null
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
