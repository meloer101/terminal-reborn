// 设置 · 外观 · 导入主题…: pick a Ghostty / iTerm theme file, read it, and make its colors the terminal's (PRD F7).
import { dialog, ipcMain } from 'electron'
import { IPC, type ThemeImportOutcome } from '@shared/ipc'
import { hostWindowFor } from './app-windows'
import { updateSettings } from './settings'
import { readThemeFile, themeStartFolder, type ThemeFileFailure } from './theme-file'

const FAILURE_TEXT: Record<ThemeFileFailure, string> = {
  unsupported: '这不是 Ghostty 或 iTerm 的主题文件。',
  incomplete: '文件里缺少背景色、前景色，或 16 色调色板里的某几个颜色。',
  'too-large': '文件太大，不像是主题文件。',
  unreadable: '读不了这个文件。'
}

export function registerThemeImportHandler(): void {
  ipcMain.handle(IPC.settingsImportTheme, async (event): Promise<ThemeImportOutcome> => {
    const win = hostWindowFor(event.sender)
    const defaultPath = themeStartFolder()
    const options = {
      properties: ['openFile', 'treatPackageAsDirectory'] as Array<'openFile' | 'treatPackageAsDirectory'>,
      buttonLabel: '导入',
      ...(defaultPath ? { defaultPath } : {})
    }
    const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    const path = picked.canceled ? undefined : picked.filePaths[0]
    if (!path) return { status: 'canceled' }

    const result = await readThemeFile(path)
    if (!result.ok) {
      const box = { type: 'warning' as const, message: '无法导入这个主题', detail: FAILURE_TEXT[result.reason], buttons: ['好'] }
      if (win) await dialog.showMessageBox(win, box)
      else await dialog.showMessageBox(box)
      return { status: 'failed' }
    }
    await updateSettings({
      appearance: { terminalBackground: { mode: 'custom', color: result.theme.background }, terminalColors: result.theme.colors }
    })
    return { status: 'imported', name: result.name }
  })
}
