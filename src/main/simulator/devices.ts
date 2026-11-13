// Xcode's simulators through `xcrun simctl` (PRD F17 · iOS 模拟器): list, boot, and the Device Hub input check.
// No Electron imports, so the smoke script runs it in plain Node.
import { execFile } from 'node:child_process'
import { parseSimctlDevices, type SimRuntimeGroup } from '@shared/simulator'

const XCRUN = '/usr/bin/xcrun'
const XCODE_SELECT = '/usr/bin/xcode-select'
/** A cold boot of a new simulator can take a minute or two on a busy Mac. */
const BOOT_TIMEOUT_MS = 240_000
const DEVICE_HUB_KEY = 'com.apple.coredevice.dtuhidd.active'

function run(file: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => (error ? reject(error) : resolve(stdout)))
  })
}

/**
 * The available iOS simulators; null when there is no Xcode to ask. `xcode-select -p` goes first: with no developer
 * tools at all, /usr/bin/xcrun would put up the system's "install the command line tools" dialog every time.
 */
export async function listDevices(): Promise<SimRuntimeGroup[] | null> {
  try {
    await run(XCODE_SELECT, ['-p'], 5_000)
    const out = await run(XCRUN, ['simctl', 'list', 'devices', 'available', '-j'], 20_000)
    return parseSimctlDevices(JSON.parse(out))
  } catch {
    return null
  }
}

/** Boots the device (when it is not booted) and resolves once it has finished booting. Never shuts one down. */
export async function bootDevice(udid: string): Promise<void> {
  await run(XCRUN, ['simctl', 'bootstatus', udid, '-b'], BOOT_TIMEOUT_MS)
}

/**
 * Whether Xcode 27's Device Hub holds the device's input (taps and keys do not reach it): the guest's
 * `com.apple.coredevice.dtuhidd.active` flag. False when the runtime does not publish the flag (Xcode 26 and older).
 */
export async function deviceHubHoldsInput(udid: string): Promise<boolean> {
  try {
    const out = await run(XCRUN, ['simctl', 'spawn', udid, 'notifyutil', '-g', DEVICE_HUB_KEY], 5_000)
    return out.trim() === `${DEVICE_HUB_KEY} 1`
  } catch {
    return false
  }
}
