// Sample session shown in the settings preview (Figma 07, node 21:1447): a prompt, ANSI colours,
// and CJK / box-drawing lines that make 2-cell alignment visible at a glance.

const DIM = '\x1b[90m'
const GREEN = '\x1b[32m'
const BLUE = '\x1b[34m'
const ACCENT = '\x1b[38;2;224;138;94m'
const BOLD = '\x1b[1m'
const RESET = '\x1b[0m'

export const SAMPLE_LINES: readonly string[] = [
  `${DIM}> 把登录态迁移到 httpOnly cookie，过期后自动刷新${RESET}`,
  '',
  '● 我先看一下现在的会话是怎么存的。',
  `${GREEN}●${RESET} ${BOLD}Read${RESET}(src/auth/session.ts)`,
  `${DIM}  ⎿  Read 84 lines${RESET}`,
  '',
  `  中英混排 ${BLUE}abc${RESET} 对齐 ${GREEN}123${RESET} 检查`,
  `${DIM}  ┌──────────┬──────────┐${RESET}`,
  `${DIM}  │ 中文宽度 │ ASCII    │${RESET}`,
  `${DIM}  └──────────┴──────────┘${RESET}`,
  '',
  `${ACCENT}✻ Simmering… ${RESET}${DIM}(12s · esc to interrupt)${RESET}`
]

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g
const WIDE = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿豈-﫿＀-｠￠-￦]/

/** Terminal cells a string occupies: CJK and fullwidth forms take 2, everything else 1. */
export function cellWidth(text: string): number {
  let width = 0
  for (const char of text) width += WIDE.test(char) ? 2 : 1
  return width
}

/** Rows the sample occupies at `cols` columns, counting soft wraps. */
export function sampleRows(cols: number): number {
  const width = Math.max(1, Math.floor(cols))
  return SAMPLE_LINES.reduce((rows, line) => rows + Math.max(1, Math.ceil(cellWidth(line.replace(ANSI, '')) / width)), 0)
}

/** Full-reset + sample, so it can be replayed after a resize re-wraps the screen. */
export function sampleScreen(): string {
  // ESC c resets the terminal; ?25l hides the cursor.
  return `\x1bc\x1b[?25l${SAMPLE_LINES.join('\r\n')}`
}
