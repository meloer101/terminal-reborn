// Which app commands a keyboard shortcut just ran (B8). The app menu carries the same shortcuts; whichever of
// the two gets a key first runs the command, and a menu echo of a key the renderer already handled is dropped.
import type { MenuCommand } from '@shared/shortcuts'

/** A menu command this soon after the same command ran from the keyboard is the same keypress. */
export const ECHO_MS = 300

const ranByKey = new Map<MenuCommand, number>()

export function noteKeyCommand(command: MenuCommand, now = performance.now()): void {
  ranByKey.set(command, now)
}

/** Whether a menu command is the echo of a shortcut the renderer already handled. */
export function isKeyEcho(command: MenuCommand, now = performance.now()): boolean {
  const at = ranByKey.get(command)
  return at !== undefined && now - at < ECHO_MS
}
