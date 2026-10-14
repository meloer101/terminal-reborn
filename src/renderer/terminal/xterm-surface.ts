import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { whenAppearanceKnown } from './appearance-ready'
import { buildFontStack, DEFAULT_APPEARANCE, readThemeFromDocument, withAlpha } from './appearance'
import { macKeyToBytes } from './keymap'
import { findLigatureRanges } from './ligatures'
import { readBufferText } from './screen-text'
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
const FONT_LOAD_TIMEOUT_MS = 1500

/** xterm.js implementation of TerminalSurface (docs/PRD.md §6.3). */
export class XtermSurface implements TerminalSurface {
  private readonly term: Terminal
  private readonly fitAddon = new FitAddon()
  private webgl: WebglAddon | null = null
  private webglUnavailable = false
  private visible = true
  private disposed = false
  private appearance: TerminalAppearance = { ...DEFAULT_APPEARANCE }
  private readonly themeObserver: MutationObserver
  private ligatureJoinerId: number | null = null
  /** Bumped per setAppearance so a slow font load never overwrites a newer change. */
  private appearanceSeq = 0
  private openPromise: Promise<void> | null = null
  private container: HTMLElement | null = null

  constructor() {
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
    this.term.loadAddon(new Unicode11Addon())
    this.term.unicode.activeVersion = '11'
    // Plain clicks open links through window.open, which main routes to the default browser.
    this.term.loadAddon(new WebLinksAddon((_event, uri) => window.open(uri, '_blank')))
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
    this.syncRenderer()
    if (visible) {
      this.fit()
      this.term.clearTextureAtlas()
      this.term.refresh(0, this.term.rows - 1)
    }
  }

  private syncRenderer(): void {
    if (this.disposed || !this.term.element) return
    // WebGL paints italic/dim/underlined cells with an opaque background when the surface is
    // transparent (research §2.2, xterm #6116), so transparent terminals use the DOM renderer.
    const wantWebgl = this.visible && !this.webglUnavailable && !this.isTransparent()
    if (wantWebgl && !this.webgl) this.loadWebgl()
    else if (!wantWebgl && this.webgl) this.unloadWebgl()
  }

  private loadWebgl(): void {
    try {
      const addon = new WebglAddon()
      addon.onContextLoss(() => {
        // Per-terminal fallback: this terminal drops to the DOM renderer, others keep WebGL.
        this.webglUnavailable = true
        this.unloadWebgl()
      })
      this.term.loadAddon(addon)
      this.webgl = addon
    } catch {
      this.webglUnavailable = true
      this.webgl = null
    }
  }

  private unloadWebgl(): void {
    const addon = this.webgl
    this.webgl = null
    try {
      addon?.dispose()
    } catch {
      // Context already lost.
    }
  }

  private applyTheme(): void {
    this.term.options.theme = this.buildTheme()
    this.term.clearTextureAtlas()
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
    this.term.clearTextureAtlas()
    this.fit()
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
      return
    }

    const apply = (): void => {
      if (this.disposed || seq !== this.appearanceSeq) return
      this.term.options.fontFamily = buildFontStack(cur)
      this.term.options.fontSize = cur.fontSize
      this.term.options.lineHeight = cur.lineHeight
      this.term.options.allowTransparency = this.isTransparent()
      this.term.options.theme = this.buildTheme()
      this.syncLigatures()
      this.syncRenderer()
      // Glyph metrics changed: rebuild the atlas, then refit so cols/rows (and the PTY) follow.
      this.term.clearTextureAtlas()
      this.fit()
    }
    if (fontsChanged) void this.loadFonts().then(apply)
    else apply()
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
