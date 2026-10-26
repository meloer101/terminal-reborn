import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MAX_THEME_FILE_BYTES } from '@shared/theme-import'
import { readThemeFile, themeStartFolder } from './theme-file'

const ANSI = Array.from({ length: 16 }, (_, i) => `palette = ${i}=#${(i * 16 + i).toString(16).padStart(2, '0').repeat(3)}`).join('\n')
const THEME = `${ANSI}\nbackground = #262427\nforeground = #fcfcfa\n`

let dir: string
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'wavi-theme-'))
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('readThemeFile', () => {
  it('reads a Ghostty theme file (no extension) and names it after the file', async () => {
    const path = join(dir, 'Monokai Pro')
    writeFileSync(path, THEME)
    const result = await readThemeFile(path)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.name).toBe('Monokai Pro')
    expect(result.theme.background).toBe('#262427')
    expect(result.theme.colors.ansi).toHaveLength(16)
  })

  it('explains a file that is not a theme, one that is incomplete, one that is too large, and one that is missing', async () => {
    const prose = join(dir, 'notes.txt')
    writeFileSync(prose, 'hello world')
    expect(await readThemeFile(prose)).toEqual({ ok: false, reason: 'unsupported' })

    const partial = join(dir, 'partial')
    writeFileSync(partial, 'background = #000000\nforeground = #ffffff\n')
    expect(await readThemeFile(partial)).toEqual({ ok: false, reason: 'incomplete' })

    const huge = join(dir, 'huge')
    writeFileSync(huge, 'a'.repeat(MAX_THEME_FILE_BYTES + 1))
    expect(await readThemeFile(huge)).toEqual({ ok: false, reason: 'too-large' })

    expect(await readThemeFile(join(dir, 'missing'))).toEqual({ ok: false, reason: 'unreadable' })
    expect(await readThemeFile(dir)).toEqual({ ok: false, reason: 'unreadable' })
  })
})

describe('themeStartFolder', () => {
  it('prefers Ghostty.app’s bundled themes, then the user’s own, and is undefined when neither exists', () => {
    const bundled = '/Applications/Ghostty.app/Contents/Resources/ghostty/themes'
    expect(themeStartFolder('/Users/x', (p) => p === bundled)).toBe(bundled)
    expect(themeStartFolder('/Users/x', (p) => p === '/Users/x/.config/ghostty/themes')).toBe('/Users/x/.config/ghostty/themes')
    expect(themeStartFolder('/Users/x', () => false)).toBeUndefined()
  })
})
