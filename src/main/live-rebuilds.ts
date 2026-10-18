// Linked app only (src/main/source-checkout.ts): a new renderer build reloads the windows, a new main or preload
// build offers a restart. With the pty daemon both keep the terminals (the reloaded window reattaches them); with
// the fallback host they would end, so then the reload is asked first too.
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { confirm } from './confirm'
import { quitKeepsSessions } from './pty'
import { watchRebuilds, type BuildChange } from './rebuilds'
import { sourceRoot } from './source-checkout'
import { getMainWindow } from './windows'

function reloadWindows(): void {
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.reload()
}

function ask(change: BuildChange, keepsSessions: boolean): Promise<boolean> {
  const sessions = keepsSessions ? '终端会话会接回。' : '这次运行没有后台会话进程，正在运行的终端会结束。'
  return confirm(
    change.restartApp
      ? { message: `${app.name} 已重新构建，重启后生效。`, detail: sessions, confirmLabel: '立即重启', cancelLabel: '稍后', destructive: !keepsSessions }
      : { message: `${app.name} 的界面已重新构建。`, detail: sessions, confirmLabel: '重新载入', cancelLabel: '稍后', destructive: true },
    getMainWindow()
  )
}

export function registerLiveRebuilds(): void {
  const root = sourceRoot()
  if (!root) return
  let asking = false
  watchRebuilds(join(root, 'out'), (change) => {
    const keepsSessions = quitKeepsSessions()
    console.log(`[main] new build in ${root}/out:`, change.restartApp ? 'main/preload changed' : 'renderer changed')
    if (change.reloadRenderer && keepsSessions) {
      reloadWindows()
      return
    }
    if (asking) return
    asking = true
    void ask(change, keepsSessions)
      .catch(() => false)
      .then((ok) => {
        asking = false
        if (!ok) return
        if (change.restartApp) {
          app.relaunch()
          app.quit()
        } else {
          reloadWindows()
        }
      })
  })
}
