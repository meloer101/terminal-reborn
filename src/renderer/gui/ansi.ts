// A command's colors in a GUI session's tool output (PRD F23, Figma 59J): the SGR sequences it wrote for a terminal,
// read into spans the feed draws with the --term-* colors. Bold, dim and the eight colors (bright ones as the same
// names); every other escape is dropped, as plainOutput does for the text that is shown elsewhere and copied. Pure.

export type AnsiColor = 'black' | 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'white'

export interface AnsiSpan {
  text: string
  fg?: AnsiColor
  bold?: true
  dim?: true
}

const COLORS: readonly AnsiColor[] = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']

// Escape codes a command writes for a terminal (OSC titles and links, CSI colors and cursor moves, charset picks).
// eslint-disable-next-line no-control-regex -- matching ESC is the point
export const ESCAPES = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[()][0-9A-Za-z]|\x1b[@-Z\\-_]/g
/** The kept tail of a long output (`…` + the end) can start inside a CSI sequence whose ESC was cut off. */
export const CUT_ESCAPE = /^…\[[0-?]*[ -/]*[@-~]/
// eslint-disable-next-line no-control-regex -- matching ESC is the point
const SGR = /^\x1b\[([0-9;]*)m$/

interface Style {
  fg?: AnsiColor
  bold?: true
  dim?: true
}

/** The style after one SGR sequence's parameters (`1;32`; empty is a reset). */
function applySgr(style: Style, params: string): Style {
  const codes = params === '' ? [0] : params.split(';').map((p) => (p === '' ? 0 : Number(p)))
  let next: Style = { ...style }
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i]!
    if (code === 0) next = {}
    else if (code === 1) next.bold = true
    else if (code === 2) next.dim = true
    else if (code === 22) {
      delete next.bold
      delete next.dim
    } else if (code >= 30 && code <= 37) next.fg = COLORS[code - 30]!
    else if (code >= 90 && code <= 97) next.fg = COLORS[code - 90]!
    else if (code === 39) delete next.fg
    // 256 and true colors (foreground or background): their numbers are not codes.
    else if (code === 38 || code === 48) i += codes[i + 1] === 5 ? 2 : codes[i + 1] === 2 ? 4 : 0
  }
  return next
}

export function ansiSpans(raw: string): AnsiSpan[] {
  const spans: AnsiSpan[] = []
  let style: Style = {}
  const push = (text: string): void => {
    if (!text) return
    const last = spans[spans.length - 1]
    if (last && last.fg === style.fg && last.bold === style.bold && last.dim === style.dim) last.text += text
    else spans.push({ text, ...style })
  }
  const text = raw.replace(CUT_ESCAPE, '…')
  let at = 0
  for (const match of text.matchAll(ESCAPES)) {
    push(text.slice(at, match.index))
    at = match.index + match[0].length
    const sgr = SGR.exec(match[0])
    if (sgr) style = applySgr(style, sgr[1]!)
  }
  push(text.slice(at))
  return spans
}
