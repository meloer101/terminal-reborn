// Terminal rendering abstraction (docs/PRD.md §6.3). xterm.js is the first implementation;
// keeping callers on this interface leaves room for a libghostty-backed surface later.

export interface Disposable {
  dispose(): void
}

export interface TerminalAppearance {
  /** Latin monospace font family. */
  fontFamily: string
  /** CJK fallback family, placed right after fontFamily in the stack. */
  cjkFontFamily: string
  fontSize: number
  lineHeight: number
  ligatures: boolean
}

export interface TerminalSurface extends Disposable {
  mount(container: HTMLElement): void
  /** Bytes from the PTY. */
  write(data: string): void
  /** Keystrokes typed directly into the terminal (to be forwarded to the PTY). */
  onInput(listener: (data: string) => void): Disposable
  /** Recompute cols/rows from the container; returns the new size. */
  fit(): { cols: number; rows: number }
  onResize(listener: (size: { cols: number; rows: number }) => void): Disposable
  focus(): void
  /** Visible viewport plus `scrollbackLines` of history, as plain text (for send confirmation and screen fallbacks). */
  readScreen(scrollbackLines?: number): string
  onTitleChange(listener: (title: string) => void): Disposable
  /** Subscribe to an OSC sequence by numeric identifier (e.g. 7, 133, 777). */
  onOsc(code: number, listener: (payload: string) => void): Disposable
  setAppearance(appearance: Partial<TerminalAppearance>): void
}
