// Native confirmation sheets (quit, close session, remove project).
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { IPC, type MenuEntry } from '@shared/ipc'
import type { ConfirmOptions } from '@shared/lifecycle'
import { getActivity } from './activity'
import { parseConfirmOptions } from './confirm-spec'

/**
 * End-to-end seam, only created when the launcher sets TR_E2E_DIALOGS=1. Dialogs are recorded in
 * `requests` and answered with `answer` instead of popping a native sheet (which tests cannot click).
 * Context menus likewise: recorded in `menus`, answered with the next queued `menuAnswers` id (null = dismissed).
 */
interface DialogHook {
  requests: ConfirmOptions[]
  answer: boolean
  menus: MenuEntry[][]
  menuAnswers: (string | null)[]
  activity(): { active: number }
}

const hook: DialogHook | null =
  process.env.TR_E2E_DIALOGS === '1' ? { requests: [], answer: true, menus: [], menuAnswers: [], activity: getActivity } : null
if (hook) (globalThis as { __trDialogs?: DialogHook }).__trDialogs = hook

/** End-to-end runs: the scripted answer to a context menu; undefined = show the real menu. */
export function scriptedMenuChoice(entries: MenuEntry[]): string | null | undefined {
  if (!hook) return undefined
  hook.menus.push(entries)
  return hook.menuAnswers.shift() ?? null
}

/** Shows the confirmation (as a sheet on `parent` when it is visible); true when the user confirmed. */
export async function confirm(options: ConfirmOptions, parent?: BrowserWindow | null): Promise<boolean> {
  if (hook) {
    hook.requests.push(options)
    return hook.answer
  }
  const buttons = [options.confirmLabel, options.cancelLabel ?? '取消']
  const messageOptions = {
    type: 'warning' as const,
    message: options.message,
    ...(options.detail ? { detail: options.detail } : {}),
    buttons,
    // Destructive: the safe choice is the default, so Return does not discard work.
    defaultId: options.destructive ? 1 : 0,
    cancelId: 1,
    noLink: true
  }
  const usable = parent && !parent.isDestroyed() && parent.isVisible() ? parent : null
  const result = usable ? await dialog.showMessageBox(usable, messageOptions) : await dialog.showMessageBox(messageOptions)
  return result.response === 0
}

export function registerConfirmHandlers(): void {
  ipcMain.handle(IPC.uiConfirm, (event, raw: unknown) => confirm(parseConfirmOptions(raw), BrowserWindow.fromWebContents(event.sender)))
}
