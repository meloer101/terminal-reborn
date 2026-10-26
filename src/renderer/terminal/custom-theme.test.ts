import { describe, expect, it } from 'vitest'
import { buildCustomTheme } from './appearance'

const ANSI = ['#262427', '#ff666d', '#b3e03a', '#ffc739', '#00cde8', '#a392e8', '#9deaf6', '#fcfcfa', '#545452', '#ff7e83', '#bee55e', '#ffd05e', '#1bd5eb', '#b0a3eb', '#acedf8', '#fdfdfb']
const COLORS = { foreground: '#fcfcfa', cursor: '#ff00ff', selection: '#33334488', ansi: ANSI }

describe('buildCustomTheme', () => {
  it('shows exactly the background that was chosen', () => {
    expect(buildCustomTheme('#262427', null).background).toBe('#262427')
    expect(buildCustomTheme('#fdf6e3', null).background).toBe('#fdf6e3')
    expect(buildCustomTheme('#262427', COLORS).background).toBe('#262427')
  })

  it('takes dark text for a light background and light text for a dark one, whatever the app theme is', () => {
    expect(buildCustomTheme('#fdf6e3', null).foreground).toBe('#121212')
    expect(buildCustomTheme('#1e1e2e', null).foreground).toBe('#e5e5e5')
    // Cursor text sits on the background color.
    expect(buildCustomTheme('#fdf6e3', null).cursorAccent).toBe('#fdf6e3')
  })

  it('uses the imported colors as they are', () => {
    const theme = buildCustomTheme('#262427', COLORS)
    expect(theme.foreground).toBe('#fcfcfa')
    expect(theme.cursor).toBe('#ff00ff')
    expect(theme.selectionBackground).toBe('#33334488')
    expect(theme.selectionInactiveBackground).toBe('#33334488')
    const names = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'] as const
    names.forEach((name, i) => expect(theme[name], name).toBe(ANSI[i]))
  })
})
