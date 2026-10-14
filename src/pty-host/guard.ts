// One bad PTY must not take every terminal down with it: per-session operations run through here.

export type Logger = (message: string, error: unknown) => void

const defaultLog: Logger = (message, error) => console.error(`[pty-host] ${message}`, error)

/** Runs `fn`; a throw is logged and swallowed. Returns whether it completed. */
export function guarded(label: string, fn: () => void, log: Logger = defaultLog): boolean {
  try {
    fn()
    return true
  } catch (error) {
    log(label, error)
    return false
  }
}
