import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { buildFontStack, DEFAULT_APPEARANCE, readThemeFromDocument } from './appearance'
import { macKeyToBytes } from './keymap'
import { readBufferText } from './screen-text'
import type { Disposable, TerminalAppearance, TerminalSurface } from './surface'

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
      theme: readThemeFromDocument()
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
    this.openPromise = this.loadFonts().then(() => {
      if (this.disposed || !this.container) return
      this.term.open(this.container)
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
    if (this.visible && !this.webgl && !this.webglUnavailable) this.loadWebgl()
    else if (!this.visible && this.webgl) this.unloadWebgl()
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
    this.term.options.theme = readThemeFromDocument()
    this.term.clearTextureAtlas()
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
    this.appearance = { ...this.appearance, ...next }
    const { fontSize, lineHeight } = this.appearance
    this.term.options.fontFamily = buildFontStack(this.appearance)
    this.term.options.fontSize = fontSize
    this.term.options.lineHeight = lineHeight
    this.term.clearTextureAtlas()
    this.fit()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.themeObserver.disconnect()
    this.unloadWebgl()
    this.term.dispose()
  }
}
