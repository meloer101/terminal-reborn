// Terminal rendering abstraction (docs/PRD.md §6.3). xterm.js is the first implementation;
// keeping callers on this interface leaves room for a libghostty-backed surface later.
import type { PathResolver, TerminalLink } from './links'

export interface Disposable {
  dispose(): void
}

export interface TerminalAppearance {
  /** Latin monospace font family. */
  fontFamily: string
  /** CJK fallback family, placed right after fontFamily in the stack. */
  cjkFontFamily: string
  fontSize: number
  /** Multiple of the font's natural line height (xterm semantics); 1 = a normal terminal. */
  lineHeight: number
  ligatures: boolean
  /**
   * Alpha (0–1) of the default cell background; below 1 the surface turns transparent
   * (`allowTransparency`). Optional, defaults to 1 (opaque).
   */
  backgroundAlpha?: number
  /** xterm's screen reader mode: an accessible, live-announced copy of the output (B18). */
  screenReader?: boolean
}

export interface TerminalSurface extends Disposable {
  mount(container: HTMLElement): void
  /** Bytes from the PTY. `callback` fires once the data has been parsed (used for flow control). */
  write(data: string, callback?: () => void): void
  /** Keystrokes typed directly into the terminal (to be forwarded to the PTY). */
  onInput(listener: (data: string) => void): Disposable
  /** Recompute cols/rows from the container; returns the new size. */
  fit(): { cols: number; rows: number }
  onResize(listener: (size: { cols: number; rows: number }) => void): Disposable
  focus(): void
  /** Visible viewport plus `scrollbackLines` of history, as plain text (for send confirmation and screen fallbacks). */
  readScreen(scrollbackLines?: number): string
  /** Whether the program in the terminal turned on bracketed paste (`ESC[?2004h`). */
  bracketedPasteMode(): boolean
  onTitleChange(listener: (title: string) => void): Disposable
  /** Subscribe to an OSC sequence by numeric identifier (e.g. 7, 133, 777). */
  onOsc(code: number, listener: (payload: string) => void): Disposable
  setAppearance(appearance: Partial<TerminalAppearance>): void
  /** A link in the output was clicked or right-clicked (PRD F17). With no listener a click opens the system browser. */
  onLink(listener: (link: TerminalLink) => void): Disposable
  /** Lets file paths in the output become links: the resolver says which are files of the session (PRD F17). */
  setPathResolver(resolver: PathResolver | null): void
}
