// IPC for the right panel's iOS 模拟器 view (PRD F17 · Figma 76C / 76D). Main owns everything that touches the system:
// simctl, the serve-sim helpers and their localhost connections. Frames reach the page over a MessagePort, one in
// flight at a time (newer frames replace an unsent one); every payload from the renderer is validated here.
import { app, BrowserWindow, ipcMain, MessageChannelMain, shell, type IpcMainEvent, type MessagePortMain, type WebContents } from 'electron'
import { join } from 'node:path'
import { SIM_FRAME_ACK, SIMULATOR_IPC, type SimFrameMessage, type SimulatorListing, type SimulatorScreen } from '@shared/simulator'
import { bootDevice, deviceHubHoldsInput, listDevices } from './devices'
import { RememberedDevice } from './remembered'
import { SimulatorHost, type SimViewer } from './session'
import { parseKeyPhase, parseScroll, parseTouch, parseUdid, parseUsage } from './validate'

/** Xcode's page in the Mac App Store (在 App Store 中打开). */
const XCODE_APP_STORE = 'macappstore://apps.apple.com/app/id497799835'
/** A helper stops this long after the last window stopped showing its device. */
const IDLE_STOP_MS = 60_000
/** A page that has not acknowledged a frame for this long gets the next one anyway. */
const ACK_TIMEOUT_MS = 2_000

/** serve-sim's CLI; packaged, it runs from app.asar.unpacked (electron-builder.yml asarUnpack) with its .node addon. */
function serveSimCli(): string {
  return join(app.getAppPath(), 'node_modules', 'serve-sim', 'dist', 'serve-sim.js').replace(/app\.asar(?=[/\\])/, 'app.asar.unpacked')
}

/** One app window's simulator view: its frame port and the frame (if any) waiting for the page to take the last one. */
class PortViewer implements SimViewer {
  private port: MessagePortMain | null = null
  private sentAt = 0
  private pending: Uint8Array | null = null

  constructor(private readonly contents: WebContents) {}

  /** A fresh port for the page (every show); the previous one is closed with whatever it had queued. */
  open(): void {
    this.close()
    const { port1, port2 } = new MessageChannelMain()
    port1.on('message', (event) => {
      if (event.data !== SIM_FRAME_ACK || this.port !== port1) return
      this.sentAt = 0
      const next = this.pending
      this.pending = null
      if (next) this.post(next)
    })
    port1.on('close', () => {
      if (this.port === port1) this.port = null
    })
    port1.start()
    this.port = port1
    this.contents.postMessage(SIMULATOR_IPC.port, null, [port2])
  }

  close(): void {
    this.port?.close()
    this.port = null
    this.sentAt = 0
    this.pending = null
  }

  screen(screen: SimulatorScreen | null): void {
    if (!this.contents.isDestroyed()) this.contents.send(SIMULATOR_IPC.screen, screen)
  }

  frame(jpeg: Uint8Array): void {
    if (!this.port) return
    if (this.sentAt !== 0 && Date.now() - this.sentAt < ACK_TIMEOUT_MS) {
      this.pending = jpeg
      return
    }
    this.post(jpeg)
  }

  private post(jpeg: Uint8Array): void {
    this.sentAt = Date.now()
    const message: SimFrameMessage = { jpeg }
    this.port?.postMessage(message)
  }
}

export function registerSimulatorHandlers(): void {
  const remembered = new RememberedDevice(join(app.getPath('userData'), 'simulator.json'))
  const host = new SimulatorHost({
    runtime: { execPath: process.execPath, cliPath: serveSimCli(), env: process.env },
    listDevices,
    boot: bootDevice,
    deviceHubHoldsInput,
    idleStopMs: IDLE_STOP_MS,
    log: (line) => console.log(line)
  })
  app.on('will-quit', () => void host.stopAll())

  const viewers = new WeakMap<WebContents, PortViewer>()
  /** The sending app window's viewer; null for anything else (a browser page, a closed window). */
  const viewerOf = (event: IpcMainEvent | Electron.IpcMainInvokeEvent): PortViewer | null => {
    const sender = event.sender
    const window = BrowserWindow.fromWebContents(sender)
    if (!window || window.isDestroyed() || window.webContents !== sender) return null
    let viewer = viewers.get(sender)
    if (!viewer) {
      const created = new PortViewer(sender)
      viewer = created
      viewers.set(sender, created)
      sender.once('destroyed', () => {
        host.hide(created)
        created.close()
      })
    }
    return viewer
  }

  /** Runs `action` for the sender's viewer; malformed payloads are dropped (logged), never acted on. */
  const on = (channel: string, action: (viewer: PortViewer, ...args: unknown[]) => void) => {
    ipcMain.on(channel, (event, ...args: unknown[]) => {
      const viewer = viewerOf(event)
      if (!viewer) return
      try {
        action(viewer, ...args)
      } catch (error) {
        console.error(`[simulator] ${channel}:`, error instanceof Error ? error.message : error)
      }
    })
  }

  ipcMain.handle(SIMULATOR_IPC.list, async (event): Promise<SimulatorListing> => {
    if (!viewerOf(event)) throw new Error('not an app window')
    const runtimes = await listDevices()
    return runtimes ? { kind: 'devices', runtimes, lastUdid: remembered.get() } : { kind: 'no-xcode' }
  })

  on(SIMULATOR_IPC.show, (viewer, udid) => {
    const key = parseUdid(udid)
    remembered.set(key)
    viewer.open()
    host.show(viewer, key)
  })
  on(SIMULATOR_IPC.hide, (viewer) => {
    host.hide(viewer)
    viewer.close()
    viewer.screen(null)
  })
  on(SIMULATOR_IPC.touch, (viewer, touch) => host.of(viewer)?.touch(parseTouch(touch)))
  on(SIMULATOR_IPC.scroll, (viewer, scroll) => host.of(viewer)?.scroll(parseScroll(scroll)))
  on(SIMULATOR_IPC.key, (viewer, phase, usage) => host.of(viewer)?.key(parseKeyPhase(phase), parseUsage(usage)))
  on(SIMULATOR_IPC.home, (viewer) => host.of(viewer)?.home())
  on(SIMULATOR_IPC.rotate, (viewer) => host.of(viewer)?.rotate())
  on(SIMULATOR_IPC.openXcodeInAppStore, () => void shell.openExternal(XCODE_APP_STORE))

  ipcMain.handle(SIMULATOR_IPC.repairInput, async (event): Promise<boolean> => {
    const viewer = viewerOf(event)
    const session = viewer ? host.of(viewer) : null
    return session ? session.repairInput() : false
  })
}
