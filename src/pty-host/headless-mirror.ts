// A headless xterm fed with everything a session's PTY prints, so a client that (re)attaches gets the live
// screen at once: scrollback, the alternate screen of a full-screen agent, and the input modes it switched on.
//
// The mode rehydration (`modeSequences`) is adapted from Orca's terminal-mode-rehydrate-sequences.ts and the
// idea of a per-session headless emulator from its headless-emulator.ts
// (https://github.com/stablyai/orca @ 37beafdd, MIT, Copyright (c) 2026 Lovecast Inc.). See THIRD_PARTY_NOTICES.md.
import { SerializeAddon } from '@xterm/addon-serialize'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { Terminal, type ITerminalAddon } from '@xterm/headless'
import type { HostScreen } from './protocol'

/** Rows of scrollback kept; also the most a reattach replays (the cold-path snapshot uses the same steps). */
export const MIRROR_SCROLLBACK = 2000
const SCREEN_SCROLLBACK_STEPS = [MIRROR_SCROLLBACK, 500, 0] as const
export const SCREEN_MAX_CHARS = 2 * 1024 * 1024

export type MouseTracking = 'none' | 'x10' | 'vt200' | 'drag' | 'any'
export type MouseEncoding = 'DEFAULT' | 'SGR' | 'SGR_PIXELS' | 'URXVT' | 'UTF8'

export interface MirrorModes {
  applicationCursor: boolean
  applicationKeypad: boolean
  bracketedPaste: boolean
  focusEvents: boolean
  cursorHidden: boolean
  mouseTracking: MouseTracking
  /** Unknown when xterm's internals are not reachable. */
  mouseEncoding?: MouseEncoding
}

/** The parts of xterm's core we read for state the public API does not expose. */
interface CoreInternals {
  _core?: {
    coreService?: { isCursorHidden?: boolean }
    coreMouseService?: { activeEncoding?: string }
  }
}

/**
 * Escape sequences that switch the modes back on in a fresh terminal (the screen itself, including an active
 * alternate screen, comes from SerializeAddon). Only what differs from a fresh terminal is emitted.
 */
export function modeSequences(modes: MirrorModes): string {
  let out = ''
  if (modes.applicationCursor) out += '\x1b[?1h'
  if (modes.applicationKeypad) out += '\x1b='
  if (modes.bracketedPaste) out += '\x1b[?2004h'
  if (modes.focusEvents) out += '\x1b[?1004h'
  switch (modes.mouseTracking) {
    case 'x10':
      out += '\x1b[?9h'
      break
    case 'vt200':
      out += '\x1b[?1000h'
      break
    case 'drag':
      out += '\x1b[?1002h'
      break
    case 'any':
      out += '\x1b[?1003h'
      break
    case 'none':
      break
  }
  // The report encoding is a mode of its own. When it cannot be read, a program that tracks the mouse is
  // assumed to use SGR: every full-screen agent we host does, and the default encoding breaks past column 223.
  const encoding = modes.mouseEncoding ?? (modes.mouseTracking === 'none' ? 'DEFAULT' : 'SGR')
  if (encoding === 'SGR') out += '\x1b[?1006h'
  else if (encoding === 'SGR_PIXELS') out += '\x1b[?1016h'
  else if (encoding === 'URXVT') out += '\x1b[?1015h'
  else if (encoding === 'UTF8') out += '\x1b[?1005h'
  if (modes.cursorHidden) out += '\x1b[?25l'
  return out
}

export class HeadlessMirror {
  private readonly term: Terminal
  private readonly serializer = new SerializeAddon()
  private title: string | undefined
  /** UTF-16 units written so far: the stream position. */
  private written = 0
  private disposed = false

  constructor(cols: number, rows: number) {
    this.term = new Terminal({ cols, rows, scrollback: MIRROR_SCROLLBACK, allowProposedApi: true, logLevel: 'off' })
    // The addons are typed against @xterm/xterm's Terminal; the headless one has the same shape for what they use.
    this.term.loadAddon(this.serializer as unknown as ITerminalAddon)
    this.term.loadAddon(new Unicode11Addon() as unknown as ITerminalAddon)
    // Same cell widths as the renderer (CJK, emoji), or reattached rows would be cut differently.
    this.term.unicode.activeVersion = '11'
    this.term.onTitleChange((title) => {
      this.title = title
    })
  }

  get position(): number {
    return this.written
  }

  write(data: string): void {
    if (this.disposed || data.length === 0) return
    this.written += data.length
    this.term.write(data)
  }

  resize(cols: number, rows: number): void {
    if (this.disposed || (cols === this.term.cols && rows === this.term.rows)) return
    this.term.resize(cols, rows)
  }

  /**
   * The screen exactly as of everything written before this call. xterm parses asynchronously, but write
   * callbacks run in order right after their chunk, so an empty write's callback sees precisely this cut.
   */
  capture(): Promise<{ seq: number; screen: HostScreen }> {
    const seq = this.written
    return new Promise((resolve) => {
      if (this.disposed) {
        resolve({ seq, screen: { data: '', cols: this.term.cols, rows: this.term.rows, modes: '' } })
        return
      }
      this.term.write('', () => resolve({ seq, screen: this.screen() }))
    })
  }

  modes(): MirrorModes {
    const m = this.term.modes
    const core = (this.term as unknown as CoreInternals)._core
    const encoding = core?.coreMouseService?.activeEncoding
    return {
      applicationCursor: m.applicationCursorKeysMode,
      applicationKeypad: m.applicationKeypadMode,
      bracketedPaste: m.bracketedPasteMode,
      focusEvents: m.sendFocusMode,
      cursorHidden: core?.coreService?.isCursorHidden === true,
      mouseTracking: m.mouseTrackingMode,
      ...(isEncoding(encoding) ? { mouseEncoding: encoding } : {})
    }
  }

  private screen(): HostScreen {
    let data = ''
    for (const scrollback of SCREEN_SCROLLBACK_STEPS) {
      data = this.serializer.serialize({ scrollback, excludeModes: true })
      if (data.length <= SCREEN_MAX_CHARS) break
    }
    if (data.length > SCREEN_MAX_CHARS) data = ''
    return {
      data,
      cols: this.term.cols,
      rows: this.term.rows,
      modes: modeSequences(this.modes()),
      ...(this.title ? { title: this.title } : {})
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.term.dispose()
  }
}

function isEncoding(value: unknown): value is MouseEncoding {
  return value === 'DEFAULT' || value === 'SGR' || value === 'SGR_PIXELS' || value === 'URXVT' || value === 'UTF8'
}
