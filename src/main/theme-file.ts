// Reading a terminal theme file from disk (设置 · 外观 · 导入主题…). No Electron imports, so it is unit tested.
import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, extname, join } from 'node:path'
import { MAX_THEME_FILE_BYTES, parseThemeFile, type ImportedTheme, type ThemeParseFailure } from '@shared/theme-import'

export type ThemeFileFailure = ThemeParseFailure | 'too-large' | 'unreadable'

export type ThemeFileResult = { ok: true; name: string; theme: ImportedTheme } | { ok: false; reason: ThemeFileFailure }

export async function readThemeFile(path: string): Promise<ThemeFileResult> {
  try {
    const info = await stat(path)
    if (!info.isFile()) return { ok: false, reason: 'unreadable' }
    if (info.size > MAX_THEME_FILE_BYTES) return { ok: false, reason: 'too-large' }
    const parsed = parseThemeFile(await readFile(path, 'utf8'))
    if (!parsed.ok) return parsed
    return { ok: true, name: basename(path, extname(path)), theme: parsed.theme }
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
}

/** Where the open panel starts: Ghostty's bundled themes, else the user's own Ghostty themes, else nothing. */
export function themeStartFolder(home: string = homedir(), exists: (path: string) => boolean = existsSync): string | undefined {
  const candidates = [
    '/Applications/Ghostty.app/Contents/Resources/ghostty/themes',
    join(home, '.config', 'ghostty', 'themes'),
    join(home, 'Library', 'Application Support', 'com.mitchellh.ghostty', 'themes')
  ]
  return candidates.find((folder) => exists(folder))
}
