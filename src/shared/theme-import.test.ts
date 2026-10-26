import { describe, expect, it } from 'vitest'
import { parseGhosttyTheme, parseItermColors, parseThemeFile } from './theme-import'

// A theme as Ghostty ships it (Monokai Pro).
const GHOSTTY = `palette = 0=#262427
palette = 1=#ff666d
palette = 2=#b3e03a
palette = 3=#ffc739
palette = 4=#00cde8
palette = 5=#a392e8
palette = 6=#9deaf6
palette = 7=#fcfcfa
palette = 8=#545452
palette = 9=#ff7e83
palette = 10=#bee55e
palette = 11=#ffd05e
palette = 12=#1bd5eb
palette = 13=#b0a3eb
palette = 14=#acedf8
palette = 15=#fcfcfa
background = #262427
foreground = #fcfcfa
cursor-color = #fcfcfa
cursor-text = #000000
selection-background = #fcfcfa
selection-foreground = #262427
`

const ANSI = ['#262427', '#ff666d', '#b3e03a', '#ffc739', '#00cde8', '#a392e8', '#9deaf6', '#fcfcfa', '#545452', '#ff7e83', '#bee55e', '#ffd05e', '#1bd5eb', '#b0a3eb', '#acedf8', '#fcfcfa']

function plistColor(name: string, [r, g, b]: [number, number, number]): string {
  return `<key>${name}</key>
	<dict>
		<key>Alpha Component</key>
		<real>1</real>
		<key>Blue Component</key>
		<real>${b}</real>
		<key>Color Space</key>
		<string>sRGB</string>
		<key>Green Component</key>
		<real>${g}</real>
		<key>Red Component</key>
		<real>${r}</real>
	</dict>`
}

function iterm(options: { skip?: string } = {}): string {
  const entries: Array<[string, [number, number, number]]> = [
    ...Array.from({ length: 16 }, (_, i): [string, [number, number, number]] => [`Ansi ${i} Color`, [i / 15, 0.5, 1 - i / 15]]),
    ['Background Color', [0, 0, 0]],
    ['Foreground Color', [1, 1, 1]],
    ['Cursor Color', [1, 0, 0]],
    ['Selection Color', [0, 0, 1]]
  ]
  const body = entries.filter(([name]) => name !== options.skip).map(([name, rgb]) => plistColor(name, rgb)).join('\n\t')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	${body}
</dict>
</plist>`
}

describe('parseGhosttyTheme', () => {
  it('reads the background, foreground, cursor, selection and 16 ANSI colors as they are', () => {
    const result = parseGhosttyTheme(GHOSTTY)
    expect(result).toEqual({
      ok: true,
      theme: {
        background: '#262427',
        colors: { foreground: '#fcfcfa', cursor: '#fcfcfa', selection: '#fcfcfa', ansi: ANSI }
      }
    })
  })

  it('ignores comments, blank lines and keys it does not use, and accepts colors without the #', () => {
    const text = `# Monokai\n\n${GHOSTTY.replace('background = #262427', 'background = 262427')}font-size = 14\nmouse-hide-while-typing = true\n`
    const result = parseGhosttyTheme(text)
    expect(result.ok && result.theme.background).toBe('#262427')
  })

  it('falls back to the foreground for the cursor and a blend for the selection', () => {
    const lines = GHOSTTY.split('\n').filter((line) => !line.startsWith('cursor-') && !line.startsWith('selection-'))
    const result = parseGhosttyTheme(lines.join('\n'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.theme.colors.cursor).toBe('#fcfcfa')
    // A quarter of the way from the background (#262427) to the foreground (#fcfcfa).
    expect(result.theme.colors.selection).toBe('#5c5a5c')
  })

  it('is incomplete without a background or without all 16 palette entries', () => {
    expect(parseGhosttyTheme(GHOSTTY.replace(/background = .*\n/, ''))).toEqual({ ok: false, reason: 'incomplete' })
    expect(parseGhosttyTheme(GHOSTTY.replace('palette = 9=#ff7e83\n', ''))).toEqual({ ok: false, reason: 'incomplete' })
    expect(parseGhosttyTheme(GHOSTTY.replace('palette = 9=#ff7e83', 'palette = 9=hotpink'))).toEqual({ ok: false, reason: 'incomplete' })
  })

  it('does not take palette entries beyond the 16 ANSI colors for them', () => {
    const result = parseGhosttyTheme(`${GHOSTTY}palette = 16=#ffffff\npalette = 99=#000000\n`)
    expect(result.ok && result.theme.colors.ansi).toEqual(ANSI)
  })

  it('is unsupported for a file with no settings in it', () => {
    expect(parseGhosttyTheme('just some prose\nwithout equals signs')).toEqual({ ok: false, reason: 'unsupported' })
    expect(parseGhosttyTheme('')).toEqual({ ok: false, reason: 'unsupported' })
  })
})

describe('parseItermColors', () => {
  it('turns 0–1 components into hex', () => {
    const result = parseItermColors(iterm())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.theme.background).toBe('#000000')
    expect(result.theme.colors.foreground).toBe('#ffffff')
    expect(result.theme.colors.cursor).toBe('#ff0000')
    expect(result.theme.colors.selection).toBe('#0000ff')
    expect(result.theme.colors.ansi).toHaveLength(16)
    expect(result.theme.colors.ansi[0]).toBe('#0080ff') // components 0, 0.5, 1
    expect(result.theme.colors.ansi[15]).toBe('#ff8000')
  })

  it('works without a cursor or selection color', () => {
    const text = iterm({ skip: 'Cursor Color' })
    const result = parseItermColors(text)
    expect(result.ok && result.theme.colors.cursor).toBe('#ffffff')
  })

  it('is incomplete when an ANSI color is missing', () => {
    expect(parseItermColors(iterm({ skip: 'Ansi 7 Color' }))).toEqual({ ok: false, reason: 'incomplete' })
  })

  it('does not read a binary plist or something that is not a plist', () => {
    expect(parseItermColors('bplist00\u0000\u0001')).toEqual({ ok: false, reason: 'unsupported' })
    expect(parseItermColors('background = #000000')).toEqual({ ok: false, reason: 'unsupported' })
  })
})

describe('parseThemeFile', () => {
  it('chooses the reader by what the file is', () => {
    expect(parseThemeFile(GHOSTTY).ok).toBe(true)
    expect(parseThemeFile(iterm()).ok).toBe(true)
    expect(parseThemeFile('bplist00xxxx')).toEqual({ ok: false, reason: 'unsupported' })
  })
})
