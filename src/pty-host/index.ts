// Entry for the Electron utilityProcess that owns the PTYs when the pty daemon is unavailable (fallback; the
// sessions then end with the app). Talks to src/main/pty over process.parentPort using the messages in ./protocol.
import { guarded } from './guard'
import type { HostRequest } from './protocol'
import { ensureSpawnHelperExecutable, SessionHost } from './session-host'

const host = new SessionHost({ emit: (event) => process.parentPort.postMessage(event), mirror: false })

// Last line of defence: log and keep serving the other terminals instead of dying with the first bug.
process.on('uncaughtException', (error) => console.error('[pty-host] uncaughtException', error))
process.on('unhandledRejection', (reason) => console.error('[pty-host] unhandledRejection', reason))

guarded('ensure spawn-helper', ensureSpawnHelperExecutable)
process.parentPort.on('message', (event) => guarded('message', () => host.handle(event.data as HostRequest)))
