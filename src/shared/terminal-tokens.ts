// The `--term-*` design tokens of tokens.css (all but --term-bg), per tone. The terminal on a custom background
// (PRD F7 v1.71) takes its foreground and ANSI colors from the tone that matches the background's lightness, not
// from the app theme — a light background under the dark theme still gets dark text. `terminal-tokens.test.ts`
// fails when these drift from tokens.css.
export type TerminalTone = 'dark' | 'light'

export const TERMINAL_TOKENS: Record<TerminalTone, Record<string, string>> = {
  dark: {
    '--term-fg': '#e5e5e5',
    '--term-dim': '#808080',
    '--term-red': '#ff5c5c',
    '--term-green': '#3dd68c',
    '--term-yellow': '#e8c46a',
    '--term-blue': '#5ea1ff',
    '--term-violet': '#c79bff',
    '--term-cyan': '#6ccfd6',
    '--term-selection': '#5ea1ff47'
  },
  light: {
    '--term-fg': '#121212',
    '--term-dim': '#808080',
    '--term-red': '#d23b3b',
    '--term-green': '#1e8e5a',
    '--term-yellow': '#b86e00',
    '--term-blue': '#2f6fd6',
    '--term-violet': '#7c4dd6',
    '--term-cyan': '#1e8c93',
    '--term-selection': '#5ea1ff47'
  }
}
