// Native confirmation sheets (quit, close session, remove project).
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { hostWindowFor } from './app-windows'
import { IPC } from '@shared/ipc'
import type { ConfirmOptions } from '@shared/lifecycle'
import { getActivity } from './activity'
import { parseConfirmOptions } from './confirm-spec'

/**
 * End-to-end seam, only created when the launcher sets TR_E2E_DIALOGS=1. Dialogs are recorded in
 * `requests` and answered with `answer` instead of popping a native sheet (which tests cannot click).
 */
interface DialogHook {
  requests: ConfirmOptions[]
  answer: boolean
  activity(): { active: number }
}

const hook: DialogHook | null =
  process.env.TR_E2E_DIALOGS === '1' ? { requests: [], answer: true, activity: getActivity } : null
if (hook) (globalThis as { __trDialogs?: DialogHook }).__trDialogs = hook

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
  ipcMain.handle(IPC.uiConfirm, (event, raw: unknown) => confirm(parseConfirmOptions(raw), hostWindowFor(event.sender)))
}
