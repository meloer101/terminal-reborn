// The helper's two connections (PRD F17 · iOS 模拟器): its MJPEG stream, split into JPEG frames, and its input
// WebSocket, which takes [tag][JSON] frames and sends back the screen's size and orientation. No Electron imports.
import WebSocket from 'ws'
import { isSimOrientation, MjpegParser, type SimOrientation } from '@shared/simulator'

/** Reads `url` (multipart/x-mixed-replace) and hands each JPEG to `onFrame` until stopped or the body ends. */
export class FrameStream {
  private readonly abort = new AbortController()

  constructor(
    url: string,
    onFrame: (jpeg: Uint8Array) => void,
    /** The stream ended or failed on its own (not after stop()). */
    onEnd: (error: Error | null) => void
  ) {
    void this.read(url, onFrame).then(
      () => !this.abort.signal.aborted && onEnd(null),
      (error: unknown) => !this.abort.signal.aborted && onEnd(error instanceof Error ? error : new Error(String(error)))
    )
  }

  stop(): void {
    this.abort.abort()
  }

  private async read(url: string, onFrame: (jpeg: Uint8Array) => void): Promise<void> {
    const response = await fetch(url, { signal: this.abort.signal })
    if (!response.ok || !response.body) throw new Error(`stream answered ${response.status}`)
    const parser = new MjpegParser()
    const reader = response.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      for (const frame of parser.push(value)) onFrame(frame)
    }
  }
}

export interface ScreenConfig {
  width: number
  height: number
  orientation: SimOrientation
}

/** Input tags of serve-sim's /ws protocol (src/device-session.ts handleHidMessage). */
export const HID_TAG = {
  touch: 0x03,
  button: 0x04,
  key: 0x06,
  orientation: 0x07,
  scroll: 0x0b
} as const

/** The helper's /ws message carrying `{ width, height, orientation }`. */
const CONFIG_TAG = 0x82

export function parseConfigMessage(data: Uint8Array): ScreenConfig | null {
  if (data.length < 2 || data[0] !== CONFIG_TAG) return null
  try {
    const { width, height, orientation } = JSON.parse(new TextDecoder().decode(data.subarray(1))) as Record<string, unknown>
    if (typeof width !== 'number' || typeof height !== 'number' || !Number.isFinite(width) || !Number.isFinite(height)) return null
    return { width, height, orientation: isSimOrientation(orientation) ? orientation : 'portrait' }
  } catch {
    return null
  }
}

export function encodeHid(tag: number, payload: object): Uint8Array {
  const body = new TextEncoder().encode(JSON.stringify(payload))
  const out = new Uint8Array(body.length + 1)
  out[0] = tag
  out.set(body, 1)
  return out
}

/** The helper's input socket. Input sent before it opens, or after it closed, is dropped (a stale tap is worse). */
export class InputSocket {
  private readonly ws: WebSocket
  private closedByUs = false

  constructor(url: string, onConfig: (config: ScreenConfig) => void, onClose: () => void) {
    this.ws = new WebSocket(url, { perMessageDeflate: false })
    this.ws.binaryType = 'nodebuffer'
    this.ws.on('message', (data: Buffer, isBinary: boolean) => {
      if (!isBinary) return
      const config = parseConfigMessage(data)
      if (config) onConfig(config)
    })
    this.ws.on('error', () => {})
    this.ws.on('close', () => !this.closedByUs && onClose())
  }

  get open(): boolean {
    return this.ws.readyState === WebSocket.OPEN
  }

  send(tag: number, payload: object): void {
    if (this.open) this.ws.send(encodeHid(tag, payload))
  }

  close(): void {
    this.closedByUs = true
    this.ws.close()
  }
}
